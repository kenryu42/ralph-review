import * as p from "@clack/prompts";
import { getCommandDef } from "@/cli";
import { getAgentDisplayInfo } from "@/lib/agents/display";
import { parseCommand } from "@/lib/cli-parser";
import { loadEffectiveConfig } from "@/lib/config";
import { collectIssueItems, runDiagnostics } from "@/lib/diagnostics";
import { getTmuxInstallHint } from "@/lib/diagnostics/tmux-install";
import type { DiagnosticsReport } from "@/lib/diagnostics/types";
import { type CycleResult, runReviewCycle } from "@/lib/engine";
import { formatReviewType } from "@/lib/format";
import { formatHandoffNote } from "@/lib/handoff-note";
import { createLogSession, getGitBranch } from "@/lib/logger";
import { playCompletionSound, resolveSoundEnabled, type SoundOverride } from "@/lib/notify/sound";
import { CLI_PATH } from "@/lib/paths";
import {
  createSessionId,
  createSessionState,
  HEARTBEAT_INTERVAL_MS,
  readSessionState,
  removeSessionState,
  touchSessionHeartbeat,
  updateSessionState,
} from "@/lib/session-state";
import { createSession, generateSessionName, isInsideTmux, isTmuxInstalled } from "@/lib/tmux";
import type { AgentType, Config, ReviewOptions } from "@/lib/types";

type IntervalHandle = ReturnType<typeof setInterval>;

export interface RunOptions {
  max?: number;
  force?: boolean;
  base?: string;
  uncommitted?: boolean;
  commit?: string;
  custom?: string;
  simplifier?: boolean;
  sound?: boolean;
  "no-sound"?: boolean;
}

export function classifyRunCompletion(result: CycleResult): "success" | "warning" | "error" {
  if (result.success) {
    return "success";
  }

  if (result.finalStatus === "completed" || result.finalStatus === "interrupted") {
    return "warning";
  }

  return "error";
}

function shellEscape(str: string): string {
  return `'${str.replace(/'/g, "'\\''")}'`;
}

export function parseSoundOverride(value: string | undefined): SoundOverride | undefined {
  if (value === "on" || value === "off") {
    return value;
  }
  return undefined;
}

export function resolveRunSoundOverride(options: RunOptions): SoundOverride | undefined {
  if (options.sound && options["no-sound"]) {
    throw new Error("Cannot use --sound and --no-sound together");
  }

  if (options.sound) {
    return "on";
  }

  if (options["no-sound"]) {
    return "off";
  }

  return undefined;
}

export function resolveRunSimplifierEnabled(options: RunOptions, config: Config | null): boolean {
  return options.simplifier === true || config?.run?.simplifier === true;
}

export function formatRunAgentsNote(config: Config, reviewOptions: ReviewOptions): string {
  const reviewer = getAgentDisplayInfo(config.reviewer);
  const fixer = getAgentDisplayInfo(config.fixer);
  const lines = [
    `Reviewer:   ${reviewer.agentName} (${reviewer.modelName}, reasoning: ${reviewer.reasoning})`,
    `Fixer:      ${fixer.agentName} (${fixer.modelName}, reasoning: ${fixer.reasoning}) (used by rr fix)`,
  ];

  if (reviewOptions.simplifier) {
    const simplifierSettings = config["code-simplifier"] ?? config.reviewer;
    const simplifier = getAgentDisplayInfo(simplifierSettings);
    lines.push(
      `Simplifier: ${simplifier.agentName} (${simplifier.modelName}, reasoning: ${simplifier.reasoning})`
    );
  }

  lines.push(`Review:     ${formatReviewType(reviewOptions)}`);
  return lines.join("\n");
}

export function getDynamicProbeAgents(config: Config | null): AgentType[] {
  if (!config) {
    return [];
  }

  const probeAgents = new Set<AgentType>();
  const settings: (Config["reviewer"] | Config["fixer"] | Config["code-simplifier"] | undefined)[] =
    [config.reviewer, config.fixer, config["code-simplifier"]];

  for (const entry of settings) {
    const agent = entry?.agent;
    if (agent === "opencode" || agent === "pi") {
      probeAgents.add(agent);
    }
  }

  return probeAgents.size > 0 ? [...probeAgents] : [];
}

export interface RunRuntime {
  prompt: {
    log: {
      error: (message: string) => void;
      warn: (message: string) => void;
      success: (message: string) => void;
      message: (message: string) => void;
    };
    note: (message: string, title: string) => void;
    spinner: () => {
      start: (message: string) => void;
      stop: (message: string) => void;
    };
  };
  getCommandDef: typeof getCommandDef;
  parseCommand: typeof parseCommand;
  loadConfig: typeof loadEffectiveConfig;
  runDiagnostics: typeof runDiagnostics;
  collectIssueItems: typeof collectIssueItems;
  getTmuxInstallHint: typeof getTmuxInstallHint;
  runReviewCycle: typeof runReviewCycle;
  createLogSession: typeof createLogSession;
  sessionState: {
    createSessionState: typeof createSessionState;
    createSessionId: typeof createSessionId;
    readSessionState: typeof readSessionState;
    removeSessionState: typeof removeSessionState;
    touchSessionHeartbeat: typeof touchSessionHeartbeat;
    updateSessionState: typeof updateSessionState;
  };
  getGitBranch: typeof getGitBranch;
  sound: {
    playCompletionSound: typeof playCompletionSound;
    resolveSoundEnabled: typeof resolveSoundEnabled;
  };
  tmux: {
    createSession: typeof createSession;
    generateSessionName: typeof generateSessionName;
    isInsideTmux: typeof isInsideTmux;
    isTmuxInstalled: typeof isTmuxInstalled;
  };
  process: {
    cwd: () => string;
    env: Record<string, string | undefined>;
    pid: number;
    execPath: string;
    stdoutIsTTY: boolean;
    exit: (code: number) => void;
  };
  timer: {
    now: () => number;
    setInterval: (handler: () => void, ms: number) => IntervalHandle;
    clearInterval: (handle: IntervalHandle) => void;
  };
  openSessionPanel: (projectPath: string, branch?: string) => Promise<void>;
  consoleLog: (...args: unknown[]) => void;
}

interface RunPromptOverrides {
  log?: Partial<RunRuntime["prompt"]["log"]>;
  note?: RunRuntime["prompt"]["note"];
  spinner?: RunRuntime["prompt"]["spinner"];
}

export interface RunRuntimeOverrides
  extends Partial<
    Omit<RunRuntime, "prompt" | "sessionState" | "sound" | "tmux" | "process" | "timer">
  > {
  prompt?: RunPromptOverrides;
  sessionState?: Partial<RunRuntime["sessionState"]>;
  sound?: Partial<RunRuntime["sound"]>;
  tmux?: Partial<RunRuntime["tmux"]>;
  process?: Partial<RunRuntime["process"]>;
  timer?: Partial<RunRuntime["timer"]>;
}

export function createRunRuntime(overrides: RunRuntimeOverrides = {}): RunRuntime {
  const defaults: RunRuntime = {
    prompt: {
      log: {
        error: p.log.error,
        warn: p.log.warn,
        success: p.log.success,
        message: p.log.message,
      },
      note: p.note,
      spinner: p.spinner,
    },
    getCommandDef,
    parseCommand,
    loadConfig: loadEffectiveConfig,
    runDiagnostics,
    collectIssueItems,
    getTmuxInstallHint,
    runReviewCycle,
    createLogSession,
    sessionState: {
      createSessionState,
      createSessionId,
      readSessionState,
      removeSessionState,
      touchSessionHeartbeat,
      updateSessionState,
    },
    getGitBranch,
    sound: {
      playCompletionSound,
      resolveSoundEnabled,
    },
    tmux: {
      createSession,
      generateSessionName,
      isInsideTmux,
      isTmuxInstalled,
    },
    process: {
      cwd: () => process.cwd(),
      env: process.env,
      pid: process.pid,
      execPath: process.execPath,
      stdoutIsTTY: process.stdout.isTTY === true,
      exit: (code: number) => {
        process.exit(code);
      },
    },
    timer: {
      now: () => Date.now(),
      setInterval: (handler, ms) => setInterval(handler, ms),
      clearInterval: (handle) => clearInterval(handle),
    },
    openSessionPanel: async (projectPath, branch) => {
      const { renderDashboard } = await import("@/lib/tui/index");
      await renderDashboard({ projectPath, branch });
    },
    consoleLog: (...args: unknown[]) => console.log(...args),
  };

  return {
    ...defaults,
    ...overrides,
    prompt: {
      log: {
        ...defaults.prompt.log,
        ...(overrides.prompt?.log ?? {}),
      },
      note: overrides.prompt?.note ?? defaults.prompt.note,
      spinner: overrides.prompt?.spinner ?? defaults.prompt.spinner,
    },
    sessionState: {
      ...defaults.sessionState,
      ...(overrides.sessionState ?? {}),
    },
    sound: {
      ...defaults.sound,
      ...(overrides.sound ?? {}),
    },
    tmux: {
      ...defaults.tmux,
      ...(overrides.tmux ?? {}),
    },
    process: {
      ...defaults.process,
      ...(overrides.process ?? {}),
    },
    timer: {
      ...defaults.timer,
      ...(overrides.timer ?? {}),
    },
  };
}

async function runInBackground(
  runtime: RunRuntime,
  projectPath: string,
  config: Config,
  maxIterations?: number,
  baseBranch?: string,
  commitSha?: string,
  customInstructions?: string,
  force?: boolean,
  simplifier?: boolean,
  soundOverride?: SoundOverride
): Promise<void> {
  // Check tmux is installed
  if (!runtime.tmux.isTmuxInstalled()) {
    runtime.prompt.log.error(
      `tmux is not installed. Install with: ${runtime.getTmuxInstallHint()}`
    );
    runtime.process.exit(1);
    return;
  }

  const branch = await runtime.getGitBranch(projectPath);
  const sessionName = runtime.tmux.generateSessionName();
  const sessionId = runtime.sessionState.createSessionId();
  const sessionPath = await runtime.createLogSession(undefined, projectPath, branch ?? undefined);

  await runtime.sessionState.createSessionState(undefined, projectPath, sessionName, {
    branch,
    sessionId,
    state: "pending",
    mode: "background",
    lastHeartbeat: runtime.timer.now(),
    sessionPath,
  });

  const envParts = [
    `RR_PROJECT_PATH=${shellEscape(projectPath)}`,
    `RR_GIT_BRANCH=${shellEscape(branch ?? "")}`,
    `RR_SESSION_ID=${shellEscape(sessionId)}`,
    `RR_SESSION_PATH=${shellEscape(sessionPath)}`,
  ];
  if (baseBranch) {
    envParts.push(`RR_BASE_BRANCH=${shellEscape(baseBranch)}`);
  }
  if (commitSha) {
    envParts.push(`RR_COMMIT_SHA=${shellEscape(commitSha)}`);
  }
  if (customInstructions) {
    envParts.push(`RR_CUSTOM_PROMPT=${shellEscape(customInstructions)}`);
  }
  if (soundOverride) {
    envParts.push(`RR_SOUND_OVERRIDE=${shellEscape(soundOverride)}`);
  }

  const commandArgs: string[] = ["_run-foreground"];
  if (maxIterations) {
    commandArgs.push("--max", String(maxIterations));
  }
  if (force) {
    commandArgs.push("--force");
  }
  if (simplifier) {
    commandArgs.push("--simplifier");
  }

  const envVars = envParts.join(" ");
  const command = `${envVars} ${runtime.process.execPath} ${CLI_PATH} ${commandArgs.join(" ")}`;

  try {
    await runtime.tmux.createSession(sessionName, command);
    runtime.prompt.log.success(`Review started in background session: ${sessionName}`);
    const reviewOptions: ReviewOptions = { baseBranch, commitSha, customInstructions, simplifier };
    runtime.prompt.note(formatRunAgentsNote(config, reviewOptions), "Agents");
    runtime.prompt.note(
      "rr         - Open Interactive Mode\n" +
        "rr stop    - Stop the review\n" +
        `rr fix --session ${sessionId} - Fix selected findings after discovery`,
      "Commands"
    );
  } catch (error) {
    await runtime.sessionState.removeSessionState(undefined, projectPath, sessionId, {
      expectedSessionId: sessionId,
    });
    runtime.prompt.log.error(`Failed to start background session: ${error}`);
    runtime.process.exit(1);
  }
}

export async function runForeground(
  args: string[] = [],
  overrides: RunRuntimeOverrides = {}
): Promise<void> {
  const runtime = createRunRuntime(overrides);
  const projectPath = runtime.process.env.RR_PROJECT_PATH || runtime.process.cwd();
  const config = await runtime.loadConfig(projectPath);
  if (!config) {
    runtime.prompt.log.error("Failed to load config");
    runtime.process.exit(1);
    return;
  }

  const baseBranch = runtime.process.env.RR_BASE_BRANCH || undefined;
  const commitSha = runtime.process.env.RR_COMMIT_SHA || undefined;
  const customInstructions = runtime.process.env.RR_CUSTOM_PROMPT || undefined;
  const expectedSessionId = runtime.process.env.RR_SESSION_ID || undefined;
  const soundOverride = parseSoundOverride(runtime.process.env.RR_SOUND_OVERRIDE);
  let forceMaxIterations = false;
  let runSimplifier = false;
  let completionState: "success" | "warning" | "error" = "error";
  const soundEnabled = runtime.sound.resolveSoundEnabled(config, soundOverride);
  let cycleResult: CycleResult | undefined;
  let sessionId = expectedSessionId;

  // Parse --max option using the _run-foreground command def
  const foregroundDef = runtime.getCommandDef("_run-foreground");
  if (foregroundDef) {
    try {
      const { values } = runtime.parseCommand<{
        max?: number;
        force?: boolean;
        simplifier?: boolean;
      }>(foregroundDef, args);
      if (values.max !== undefined) {
        config.maxIterations = values.max;
      }
      forceMaxIterations = values.force === true;
      runSimplifier = values.simplifier === true;
    } catch {
      // Ignore parse errors for internal command
    }
  }

  const branch = await runtime.getGitBranch(projectPath);
  let sessionState = sessionId
    ? await runtime.sessionState.readSessionState(undefined, projectPath, sessionId)
    : null;
  const sessionPath =
    sessionState?.sessionPath ||
    runtime.process.env.RR_SESSION_PATH ||
    (await runtime.createLogSession(undefined, projectPath, branch ?? sessionState?.branch));

  if (!sessionId) {
    sessionId = runtime.sessionState.createSessionId();
    const sessionName = runtime.tmux.generateSessionName();
    await runtime.sessionState.createSessionState(undefined, projectPath, sessionName, {
      branch,
      sessionId,
      state: "running",
      mode: "foreground",
      pid: runtime.process.pid,
      lastHeartbeat: runtime.timer.now(),
      sessionPath,
    });
    sessionState = await runtime.sessionState.readSessionState(undefined, projectPath, sessionId);
  }

  await runtime.sessionState.updateSessionState(
    undefined,
    projectPath,
    sessionId,
    {
      pid: runtime.process.pid,
      state: "running",
      mode: "foreground",
      lastHeartbeat: runtime.timer.now(),
      currentAgent: null,
      branch: branch ?? sessionState?.branch,
      sessionPath,
    },
    {
      expectedSessionId: sessionId,
    }
  );

  const heartbeatTimer = runtime.timer.setInterval(() => {
    void runtime.sessionState.touchSessionHeartbeat(undefined, projectPath, sessionId).catch(() => {
      // Ignore heartbeat failures if the session state was removed mid-shutdown.
    });
  }, HEARTBEAT_INTERVAL_MS);

  try {
    cycleResult = await runtime.runReviewCycle(
      config,
      undefined,
      {
        baseBranch,
        commitSha,
        customInstructions,
        simplifier: runSimplifier,
        forceMaxIterations,
      },
      {
        projectPath,
        sessionId,
        sessionPath,
      }
    );

    completionState = classifyRunCompletion(cycleResult);
    runtime.consoleLog(`\n${"=".repeat(50)}`);
    if (completionState === "success") {
      if (cycleResult.reviewOutcome === "findings-pending") {
        runtime.prompt.log.success(
          `Discovery complete! Findings are ready for selection (${cycleResult.iterations} iterations)`
        );
      } else if (cycleResult.reviewOutcome === "clean") {
        runtime.prompt.log.success(
          `Discovery complete! No actionable findings (${cycleResult.iterations} iterations)`
        );
      } else {
        runtime.prompt.log.success(`Review cycle complete! (${cycleResult.iterations} iterations)`);
      }
    } else if (completionState === "warning") {
      runtime.prompt.log.warn(
        `Review cycle complete with warnings: ${cycleResult.reason} (${cycleResult.iterations} iterations)`
      );
    } else {
      runtime.prompt.log.error(
        `Review stopped: ${cycleResult.reason} (${cycleResult.iterations} iterations)`
      );
    }

    if (cycleResult.reviewOutcome === "findings-pending" && sessionId) {
      runtime.prompt.note(
        `Fix selected findings with:\nrr fix --session ${sessionId}`,
        "Next Step"
      );
    }

    const handoffNote = formatHandoffNote({
      handoffStatus: cycleResult.handoffStatus,
      commitSha: cycleResult.commitSha,
      applyCommand: sessionId ? `Apply: rr apply --session ${sessionId}` : undefined,
      discardCommand: sessionId ? `Discard: rr discard --session ${sessionId}` : undefined,
    });
    if (handoffNote) {
      runtime.prompt.note(handoffNote, "Handoff");
    } else if (cycleResult.retainedWorktree) {
      runtime.prompt.note(
        `Retained worktree for review:\n` +
          `Path: ${cycleResult.retainedWorktree.worktreeProjectPath}\n` +
          `Branch: ${cycleResult.retainedWorktree.worktreeBranch}`,
        "Worktree"
      );
    }

    runtime.consoleLog(`${"=".repeat(50)}\n`);
  } finally {
    runtime.timer.clearInterval(heartbeatTimer);

    if (cycleResult) {
      await runtime.sessionState.updateSessionState(
        undefined,
        projectPath,
        sessionId,
        {
          state: cycleResult.finalStatus,
          endTime: runtime.timer.now(),
          reason: cycleResult.reason,
          phase: cycleResult.phase,
          currentAgent: null,
          lastHeartbeat: runtime.timer.now(),
          worktreeProjectPath: cycleResult.retainedWorktree?.worktreeProjectPath,
          worktreeBranch: cycleResult.retainedWorktree?.worktreeBranch,
          worktreeMergeReady: cycleResult.retainedWorktree?.mergeReady,
          worktreeCommitSha: cycleResult.retainedWorktree?.commitSha,
          artifactPath: cycleResult.artifactPath,
          reviewOutcome: cycleResult.reviewOutcome,
          handoffStatus: cycleResult.handoffStatus,
          handoffUpdatedAt: cycleResult.handoffUpdatedAt,
          commitSha: cycleResult.commitSha,
        },
        {
          expectedSessionId: sessionId,
        }
      );
    } else {
      await runtime.sessionState.updateSessionState(
        undefined,
        projectPath,
        sessionId,
        {
          state: "failed",
          endTime: runtime.timer.now(),
          reason: "Review exited unexpectedly",
          phase: undefined,
          currentAgent: null,
          lastHeartbeat: runtime.timer.now(),
          worktreeProjectPath: undefined,
          worktreeBranch: undefined,
          worktreeMergeReady: undefined,
          worktreeCommitSha: undefined,
          artifactPath: undefined,
          reviewOutcome: undefined,
          handoffStatus: undefined,
          handoffUpdatedAt: undefined,
          commitSha: undefined,
        },
        {
          expectedSessionId: sessionId,
        }
      );
    }

    if (soundEnabled) {
      const soundResult = await runtime.sound.playCompletionSound(completionState);
      if (!soundResult.played && soundResult.reason) {
        runtime.prompt.log.warn(`Could not play completion sound: ${soundResult.reason}`);
      }
    }

    await runtime.sessionState.removeSessionState(undefined, projectPath, sessionId, {
      expectedSessionId: sessionId,
    });
  }
}

export async function startReview(
  args: string[],
  overrides: RunRuntimeOverrides = {}
): Promise<void> {
  const runtime = createRunRuntime(overrides);
  const projectPath = runtime.process.env.RR_PROJECT_PATH || runtime.process.cwd();
  // Parse options using command definition
  const runDef = runtime.getCommandDef("run");
  if (!runDef) {
    runtime.prompt.log.error("Internal error: run command definition not found");
    runtime.process.exit(1);
    return;
  }

  let options: RunOptions;
  try {
    const { values } = runtime.parseCommand<RunOptions>(runDef, args);
    options = values;
  } catch (error) {
    runtime.prompt.log.error(`${error}`);
    runtime.process.exit(1);
    return;
  }

  // Validate max iterations if provided
  if (options.max !== undefined && options.max <= 0) {
    runtime.prompt.log.error("--max must be a positive number");
    runtime.process.exit(1);
    return;
  }
  let soundOverride: SoundOverride | undefined;
  try {
    soundOverride = resolveRunSoundOverride(options);
  } catch (error) {
    runtime.prompt.log.error(`${error}`);
    runtime.process.exit(1);
    return;
  }

  const loadedConfig = await runtime.loadConfig(projectPath);

  if (options.custom !== undefined && options.custom.trim().length === 0) {
    runtime.prompt.log.error("--custom cannot be empty");
    runtime.process.exit(1);
    return;
  }

  if (options.commit !== undefined) {
    options.commit = options.commit.trim();
    if (options.commit.length === 0) {
      runtime.prompt.log.error("--commit cannot be empty");
      runtime.process.exit(1);
      return;
    }
  }

  const hasExplicitMode =
    options.base !== undefined ||
    options.uncommitted === true ||
    options.commit !== undefined ||
    options.custom !== undefined;
  if (!hasExplicitMode) {
    if (loadedConfig?.defaultReview?.type === "base") {
      options.base = loadedConfig.defaultReview.branch;
    }
    // else: defaults to uncommitted behavior (no base flag)
  }

  if (options.base !== undefined) {
    options.base = options.base.trim();
    if (options.base.length === 0) {
      runtime.prompt.log.error("--base cannot be empty");
      runtime.process.exit(1);
      return;
    }
  }

  if (options.base !== undefined && options.commit !== undefined) {
    runtime.prompt.log.error("Cannot use --base and --commit together");
    runtime.process.exit(1);
    return;
  }

  if (options.uncommitted && options.base !== undefined) {
    runtime.prompt.log.error("Cannot use --uncommitted and --base together");
    runtime.process.exit(1);
    return;
  }

  if (options.uncommitted && options.commit !== undefined) {
    runtime.prompt.log.error("Cannot use --uncommitted and --commit together");
    runtime.process.exit(1);
    return;
  }

  if (options.uncommitted && options.custom !== undefined) {
    runtime.prompt.log.error("Cannot use --uncommitted and --custom together");
    runtime.process.exit(1);
    return;
  }

  const preflightSpinner = runtime.prompt.spinner();
  preflightSpinner.start("Running preflight checks...");
  let diagnostics: DiagnosticsReport;
  try {
    diagnostics = await runtime.runDiagnostics("run", {
      projectPath,
      baseBranch: options.base,
      commitSha: options.commit,
      customInstructions: options.custom,
      capabilityDiscoveryOptions: {
        probeAgents: getDynamicProbeAgents(loadedConfig),
      },
    });
  } finally {
    preflightSpinner.stop("Preflight checks complete.");
  }
  const issues = runtime.collectIssueItems(diagnostics);
  const errors = issues.filter((item) => item.severity === "error");
  const warnings = issues.filter((item) => item.severity === "warning");

  if (errors.length > 0) {
    runtime.prompt.log.error("Cannot run review:");
    for (const item of errors) {
      runtime.prompt.log.message(`  ${item.summary}`);
      item.remediation.forEach((remediation) => {
        runtime.prompt.log.message(`    -> ${remediation}`);
      });
    }
    runtime.process.exit(1);
    return;
  }

  if (warnings.length > 0) {
    runtime.prompt.log.warn("Preflight warnings:");
    for (const item of warnings) {
      runtime.prompt.log.message(`  ${item.summary}`);
      item.remediation.forEach((remediation) => {
        runtime.prompt.log.message(`    -> ${remediation}`);
      });
    }
  }

  const config = diagnostics.config ?? (await runtime.loadConfig(projectPath));
  if (!config) {
    runtime.prompt.log.error("Failed to load configuration");
    runtime.process.exit(1);
    return;
  }

  const runSimplifier = resolveRunSimplifierEnabled(options, config);

  // Check if inside tmux - warn about nesting
  if (runtime.tmux.isInsideTmux()) {
    runtime.prompt.log.warn("Running inside tmux session. Review will start in a nested session.");
  }

  await runInBackground(
    runtime,
    projectPath,
    config,
    options.max,
    options.base,
    options.commit,
    options.custom,
    options.force,
    runSimplifier,
    soundOverride
  );
}
