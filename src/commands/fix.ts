import * as p from "@clack/prompts";
import { CliError } from "@/lib/cli-parser";
import { CONFIG_DIR, loadEffectiveConfig } from "@/lib/config";
import { getTmuxInstallHint } from "@/lib/diagnostics/tmux-install";
import { formatHandoffNote } from "@/lib/handoff-note";
import { getGitBranch } from "@/lib/logger";
import { CLI_PATH } from "@/lib/paths";
import {
  formatPriorityList,
  getRepeatedPriorityFlagError,
  parsePriorityList,
} from "@/lib/priority-list";
import { loadFindingsArtifactBySessionId } from "@/lib/review-workflow/findings/artifact";
import type { FindingId, FindingsArtifact } from "@/lib/review-workflow/findings/types";
import { runFixSession } from "@/lib/review-workflow/remediation/run-fix-session";
import {
  createSessionState,
  HEARTBEAT_INTERVAL_MS,
  readSessionState,
  removeSessionState,
  type SessionState,
  touchSessionHeartbeat,
  updateSessionState,
} from "@/lib/session-state";
import { createSession, generateSessionName, isTmuxInstalled } from "@/lib/tmux";
import type { Priority } from "@/lib/types";

type IntervalHandle = ReturnType<typeof setInterval>;

export interface ParsedFixCommandOptions {
  sessionId: string;
  selector?: {
    all?: boolean;
    priorities?: Priority[];
    ids?: FindingId[];
  };
}

export interface FixCommandDeps {
  loadConfig: typeof loadEffectiveConfig;
  loadFindingsArtifactBySessionId: typeof loadFindingsArtifactBySessionId;
  promptForSelection: (artifact: FindingsArtifact) => Promise<FindingId[] | null>;
  runFixSession: typeof runFixSession;
  isTTY: () => boolean;
  isTmuxInstalled: () => boolean;
  getTmuxInstallHint: () => string;
  getGitBranch: typeof getGitBranch;
  createSession: typeof createSession;
  generateSessionName: typeof generateSessionName;
  createSessionState: typeof createSessionState;
  readSessionState: typeof readSessionState;
  removeSessionState: typeof removeSessionState;
  updateSessionState: typeof updateSessionState;
  touchSessionHeartbeat: typeof touchSessionHeartbeat;
  now: () => number;
  setInterval: (handler: () => void, ms: number) => IntervalHandle;
  clearInterval: (handle: IntervalHandle) => void;
  cwd: () => string;
  env: Record<string, string | undefined>;
  pid: number;
  execPath: string;
  logInfo: (message: string) => void;
  logSuccess: (message: string) => void;
  logWarn: (message: string) => void;
  logError: (message: string) => void;
  note: (message: string, title: string) => void;
  exit: (code: number) => void;
}

function defaultPromptForSelection(artifact: FindingsArtifact): Promise<FindingId[] | null> {
  return p
    .multiselect({
      message: "Choose findings to fix",
      options: artifact.findings.map((finding) => ({
        value: finding.id,
        label: `${finding.id} [${finding.priority}] ${finding.title}`,
        hint: `${finding.filePath}:${finding.startLine}-${finding.endLine}`,
      })),
      required: false,
    })
    .then((selection) => {
      if (p.isCancel(selection)) {
        return null;
      }

      return (selection as FindingId[]) ?? [];
    });
}

const DEFAULT_FIX_COMMAND_DEPS: FixCommandDeps = {
  loadConfig: loadEffectiveConfig,
  loadFindingsArtifactBySessionId,
  promptForSelection: defaultPromptForSelection,
  runFixSession,
  isTTY: () => process.stdout.isTTY === true,
  isTmuxInstalled,
  getTmuxInstallHint,
  getGitBranch,
  createSession,
  generateSessionName,
  createSessionState,
  readSessionState,
  removeSessionState,
  updateSessionState,
  touchSessionHeartbeat,
  now: () => Date.now(),
  setInterval: (handler, ms) => setInterval(handler, ms),
  clearInterval: (handle) => clearInterval(handle),
  cwd: () => process.cwd(),
  env: process.env,
  pid: process.pid,
  execPath: process.execPath,
  logInfo: (message: string) => p.log.info(message),
  logSuccess: (message: string) => p.log.success(message),
  logWarn: (message: string) => p.log.warn(message),
  logError: (message: string) => p.log.error(message),
  note: p.note,
  exit: (code: number) => process.exit(code),
};

function readOptionValue(args: string[], index: number, optionName: string): [string, number] {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`Option --${optionName} requires a value`);
  }
  return [value, index + 1];
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function isFindingId(value: string): value is FindingId {
  return /^F\d+$/u.test(value);
}

function shellEscape(str: string): string {
  return `'${str.replace(/'/g, "'\\''")}'`;
}

function buildSelectorArgs(selector: ParsedFixCommandOptions["selector"]): string[] {
  if (!selector) {
    return [];
  }

  if (selector.all) {
    return ["--all"];
  }

  if (selector.priorities && selector.priorities.length > 0) {
    return ["--priority", formatPriorityList(selector.priorities)];
  }

  if (selector.ids && selector.ids.length > 0) {
    return selector.ids.flatMap((findingId) => ["--id", findingId]);
  }

  return [];
}

async function resolveLauncherSelector(
  parsed: ParsedFixCommandOptions,
  artifact: FindingsArtifact,
  deps: FixCommandDeps
): Promise<
  | { kind: "ready"; selector: ParsedFixCommandOptions["selector"] }
  | { kind: "info"; message: string }
  | { kind: "error"; message: string }
> {
  if (parsed.selector) {
    return { kind: "ready", selector: parsed.selector };
  }

  if (!deps.isTTY()) {
    return {
      kind: "error",
      message:
        "No selector was provided. Re-run with one of --all, --priority, or --id, or use an interactive terminal.",
    };
  }

  const promptSelection = await deps.promptForSelection(artifact);
  if (promptSelection === null) {
    return {
      kind: "info",
      message: "Selection cancelled. Findings remain pending.",
    };
  }

  const selectedIds = [...promptSelection]
    .filter((findingId): findingId is FindingId => isFindingId(findingId))
    .sort((left, right) => left.localeCompare(right));
  if (selectedIds.length === 0) {
    return {
      kind: "info",
      message: "No findings were selected. Findings remain pending.",
    };
  }

  return {
    kind: "ready",
    selector: {
      ids: unique(selectedIds),
    },
  };
}

function toTerminalSessionState(
  sessionStatus: "running" | "pending-user" | "completed" | "failed" | "interrupted"
): "completed" | "failed" | "interrupted" {
  if (sessionStatus === "failed") {
    return "failed";
  }

  if (sessionStatus === "interrupted") {
    return "interrupted";
  }

  return "completed";
}

async function pushFixSessionStateUpdate(
  deps: FixCommandDeps,
  projectPath: string,
  sessionId: string,
  updates: Partial<SessionState>
): Promise<void> {
  await deps
    .updateSessionState(undefined, projectPath, sessionId, updates, {
      expectedSessionId: sessionId,
    })
    .catch(() => {});
}

export function parseFixCommandOptions(args: string[]): ParsedFixCommandOptions {
  let sessionId: string | undefined;
  let all = false;
  const priorities: Priority[] = [];
  const ids: FindingId[] = [];
  let priorityFlagSeen = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }

    if (arg === "--session" || arg === "-s") {
      const [value, nextIndex] = readOptionValue(args, index, "session");
      sessionId = value.trim();
      index = nextIndex;
      continue;
    }

    if (arg.startsWith("--session=")) {
      sessionId = arg.slice("--session=".length).trim();
      continue;
    }

    if (arg === "--all") {
      all = true;
      continue;
    }

    if (arg === "--priority") {
      if (priorityFlagSeen) {
        throw new Error(getRepeatedPriorityFlagError());
      }
      const [value, nextIndex] = readOptionValue(args, index, "priority");
      priorities.push(...parsePriorityList(value));
      priorityFlagSeen = true;
      index = nextIndex;
      continue;
    }

    if (arg.startsWith("--priority=")) {
      if (priorityFlagSeen) {
        throw new Error(getRepeatedPriorityFlagError());
      }
      const value = arg.slice("--priority=".length);
      priorities.push(...parsePriorityList(value));
      priorityFlagSeen = true;
      continue;
    }

    if (arg === "--id") {
      const [value, nextIndex] = readOptionValue(args, index, "id");
      if (!isFindingId(value)) {
        throw new Error(`Invalid finding ID: ${value}`);
      }
      ids.push(value);
      index = nextIndex;
      continue;
    }

    if (arg.startsWith("--id=")) {
      const value = arg.slice("--id=".length);
      if (!isFindingId(value)) {
        throw new Error(`Invalid finding ID: ${value}`);
      }
      ids.push(value);
      continue;
    }

    throw new CliError("fix", "unknown_option", arg, ["--session", "--all", "--priority", "--id"]);
  }

  if (!sessionId) {
    throw new CliError("fix", "missing_required", "session");
  }

  const selectorModeCount =
    (all ? 1 : 0) + (priorities.length > 0 ? 1 : 0) + (ids.length > 0 ? 1 : 0);
  if (selectorModeCount > 1) {
    throw new Error(
      "Selector modes are mutually exclusive. Use only one of --all, --priority, or --id."
    );
  }

  const selector =
    all || priorities.length > 0 || ids.length > 0
      ? {
          all: all || undefined,
          priorities: priorities.length > 0 ? unique(priorities) : undefined,
          ids: ids.length > 0 ? unique(ids) : undefined,
        }
      : undefined;

  return {
    sessionId,
    selector,
  };
}

export async function runFix(
  args: string[] = [],
  deps: Partial<FixCommandDeps> = {}
): Promise<void> {
  const commandDeps = { ...DEFAULT_FIX_COMMAND_DEPS, ...deps };

  let parsed: ParsedFixCommandOptions;
  try {
    parsed = parseFixCommandOptions(args);
  } catch (error) {
    commandDeps.logError(`${error}`);
    commandDeps.exit(1);
    return;
  }

  const artifact = await commandDeps.loadFindingsArtifactBySessionId(CONFIG_DIR, parsed.sessionId);
  if (!artifact) {
    commandDeps.logError(`Findings artifact not found for session ${parsed.sessionId}`);
    commandDeps.exit(1);
    return;
  }

  if (!(await commandDeps.loadConfig(artifact.projectPath))) {
    commandDeps.logError("Failed to load configuration");
    commandDeps.exit(1);
    return;
  }

  if (!commandDeps.isTmuxInstalled()) {
    commandDeps.logError(
      `tmux is not installed. Install with: ${commandDeps.getTmuxInstallHint()}`
    );
    commandDeps.exit(1);
    return;
  }

  const resolvedSelector = await resolveLauncherSelector(parsed, artifact, commandDeps);
  if (resolvedSelector.kind === "info") {
    commandDeps.logInfo(resolvedSelector.message);
    return;
  }

  if (resolvedSelector.kind === "error") {
    commandDeps.logError(resolvedSelector.message);
    commandDeps.exit(1);
    return;
  }

  const branch = await commandDeps.getGitBranch(artifact.projectPath);
  const sessionName = commandDeps.generateSessionName();
  const sessionId = artifact.sessionId;

  await commandDeps.createSessionState(undefined, artifact.projectPath, sessionName, {
    branch: branch ?? undefined,
    sessionId,
    state: "pending",
    mode: "background",
    lastHeartbeat: commandDeps.now(),
    sessionPath: artifact.logPath,
    currentPhase: "selection",
    phase: "selection",
    sessionStatus: "running",
    selectedFindingIds: resolvedSelector.selector?.ids,
  });

  const envParts = [
    `RR_PROJECT_PATH=${shellEscape(artifact.projectPath)}`,
    `RR_GIT_BRANCH=${shellEscape(branch ?? "")}`,
    `RR_SESSION_ID=${shellEscape(sessionId)}`,
    `RR_SESSION_PATH=${shellEscape(artifact.logPath)}`,
  ];
  const commandArgs = [
    "_fix-foreground",
    "--session",
    sessionId,
    ...buildSelectorArgs(resolvedSelector.selector),
  ];
  const command = `${envParts.join(" ")} ${commandDeps.execPath} ${CLI_PATH} ${commandArgs.join(" ")}`;

  try {
    await commandDeps.createSession(sessionName, command);
    commandDeps.logSuccess(`Fix started in background session: ${sessionName}`);
  } catch (error) {
    await commandDeps.removeSessionState(undefined, artifact.projectPath, sessionId, {
      expectedSessionId: sessionId,
    });
    commandDeps.logError(`Failed to start background fixer session: ${error}`);
    commandDeps.exit(1);
  }
}

export async function runFixForeground(
  args: string[] = [],
  deps: Partial<FixCommandDeps> = {}
): Promise<void> {
  const commandDeps = { ...DEFAULT_FIX_COMMAND_DEPS, ...deps };

  let parsed: ParsedFixCommandOptions;
  try {
    parsed = parseFixCommandOptions(args);
  } catch (error) {
    commandDeps.logError(`${error}`);
    commandDeps.exit(1);
    return;
  }

  const artifact = await commandDeps.loadFindingsArtifactBySessionId(CONFIG_DIR, parsed.sessionId);
  if (!artifact) {
    commandDeps.logError(`Findings artifact not found for session ${parsed.sessionId}`);
    commandDeps.exit(1);
    return;
  }

  const projectPath = commandDeps.env.RR_PROJECT_PATH || artifact.projectPath || commandDeps.cwd();
  const config = await commandDeps.loadConfig(projectPath);
  if (!config) {
    commandDeps.logError("Failed to load configuration");
    commandDeps.exit(1);
    return;
  }

  const sessionId = parsed.sessionId;
  let sessionState = await commandDeps.readSessionState(undefined, projectPath, sessionId);
  const sessionPath =
    sessionState?.sessionPath || commandDeps.env.RR_SESSION_PATH || artifact.logPath;
  const branch =
    commandDeps.env.RR_GIT_BRANCH ||
    sessionState?.branch ||
    (await commandDeps.getGitBranch(projectPath)) ||
    undefined;

  if (!sessionState) {
    const sessionName = commandDeps.generateSessionName();
    await commandDeps.createSessionState(undefined, projectPath, sessionName, {
      branch,
      sessionId,
      state: "running",
      mode: "foreground",
      pid: commandDeps.pid,
      lastHeartbeat: commandDeps.now(),
      sessionPath,
      currentPhase: "selection",
      phase: "selection",
      sessionStatus: "running",
      selectedFindingIds: parsed.selector?.ids,
    });
    sessionState = await commandDeps.readSessionState(undefined, projectPath, sessionId);
  }

  await pushFixSessionStateUpdate(commandDeps, projectPath, sessionId, {
    pid: commandDeps.pid,
    state: "running",
    mode: "foreground",
    lastHeartbeat: commandDeps.now(),
    currentPhase: "selection",
    phase: "selection",
    sessionStatus: "running",
    currentAgent: null,
    branch: branch ?? sessionState?.branch,
    sessionPath,
    selectedFindingIds: parsed.selector?.ids,
  });

  const heartbeatTimer = commandDeps.setInterval(() => {
    void commandDeps.touchSessionHeartbeat(undefined, projectPath, sessionId).catch(() => {
      // Ignore heartbeat failures if the session state was removed mid-shutdown.
    });
  }, HEARTBEAT_INTERVAL_MS);

  let result: Awaited<ReturnType<typeof runFixSession>> | undefined;

  try {
    result = await commandDeps.runFixSession(config, {
      sessionId,
      selector: parsed.selector,
      isTTY: false,
      onProgress: async (updates) => {
        await pushFixSessionStateUpdate(commandDeps, projectPath, sessionId, updates);
      },
    });

    if (result.sessionStatus === "failed") {
      commandDeps.logError(result.reason);
    } else if (result.reviewOutcome === "findings-pending") {
      commandDeps.logInfo(result.reason);
    } else if (result.reviewOutcome === "fixed-selected") {
      commandDeps.logSuccess(result.reason);
    } else {
      commandDeps.logWarn(result.reason);
    }

    const handoffNote = formatHandoffNote({
      handoffStatus: result.handoffStatus,
      commitSha: result.commitSha,
      applyCommand: result.artifact
        ? `Apply: rr apply --session ${result.artifact.sessionId}`
        : undefined,
      discardCommand: result.artifact
        ? `Discard: rr discard --session ${result.artifact.sessionId}`
        : undefined,
    });
    if (handoffNote) {
      commandDeps.note(handoffNote, "Handoff");
    } else if (result.retainedWorktree) {
      commandDeps.note(
        `Retained worktree for review:\n` +
          `Path: ${result.retainedWorktree.worktreeProjectPath}\n` +
          `Branch: ${result.retainedWorktree.worktreeBranch}`,
        "Worktree"
      );
    }
  } finally {
    commandDeps.clearInterval(heartbeatTimer);

    if (result) {
      await pushFixSessionStateUpdate(commandDeps, projectPath, sessionId, {
        state: toTerminalSessionState(result.sessionStatus),
        endTime: commandDeps.now(),
        reason: result.reason,
        currentPhase: result.phase,
        phase: result.phase,
        sessionStatus: result.sessionStatus,
        currentAgent: null,
        lastHeartbeat: commandDeps.now(),
        worktreeProjectPath: result.retainedWorktree?.worktreeProjectPath,
        worktreeBranch: result.retainedWorktree?.worktreeBranch,
        worktreeMergeReady: result.retainedWorktree?.mergeReady,
        worktreeCommitSha: result.retainedWorktree?.commitSha,
        reviewOutcome: result.reviewOutcome,
        handoffStatus: result.handoffStatus,
        handoffUpdatedAt: result.handoffUpdatedAt,
        commitSha: result.commitSha,
        selectedFindingIds: result.selection.selectedFindingIds,
      });
    } else {
      await pushFixSessionStateUpdate(commandDeps, projectPath, sessionId, {
        state: "failed",
        endTime: commandDeps.now(),
        reason: "Fix exited unexpectedly",
        currentPhase: undefined,
        phase: undefined,
        sessionStatus: undefined,
        currentAgent: null,
        lastHeartbeat: commandDeps.now(),
        worktreeProjectPath: undefined,
        worktreeBranch: undefined,
        worktreeMergeReady: undefined,
        worktreeCommitSha: undefined,
        reviewOutcome: undefined,
        handoffStatus: undefined,
        handoffUpdatedAt: undefined,
        commitSha: undefined,
        selectedFindingIds: undefined,
      });
    }

    await commandDeps.removeSessionState(undefined, projectPath, sessionId, {
      expectedSessionId: sessionId,
    });
  }
}
