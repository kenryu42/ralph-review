import * as p from "@clack/prompts";
import { getCommandDef } from "@/cli";
import { getAgentDisplayInfo } from "@/lib/agents/display";
import { parseCommand } from "@/lib/cli-parser";
import { loadConfig } from "@/lib/config";
import { collectIssueItems, runDiagnostics } from "@/lib/diagnostics";
import { getTmuxInstallHint } from "@/lib/diagnostics/tmux-install";
import type { DiagnosticsReport } from "@/lib/diagnostics/types";
import { type CycleResult, runReviewCycle } from "@/lib/engine";
import { formatReviewType } from "@/lib/format";
import {
  createLockfile,
  createSessionId,
  HEARTBEAT_INTERVAL_MS,
  readLockfile,
  removeLockfile,
  touchHeartbeat,
  updateLockfile,
} from "@/lib/lockfile";
import { getGitBranch } from "@/lib/logger";
import { playCompletionSound, resolveSoundEnabled, type SoundOverride } from "@/lib/notify/sound";
import { CLI_PATH } from "@/lib/paths";
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
    `Fixer:      ${fixer.agentName} (${fixer.modelName}, reasoning: ${fixer.reasoning})`,
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
  loadConfig: typeof loadConfig;
  runDiagnostics: typeof runDiagnostics;
  collectIssueItems: typeof collectIssueItems;
  getTmuxInstallHint: typeof getTmuxInstallHint;
  runReviewCycle: typeof runReviewCycle;
  lockfile: {
    createLockfile: typeof createLockfile;
    createSessionId: typeof createSessionId;
    readLockfile: typeof readLockfile;
    removeLockfile: typeof removeLockfile;
    touchHeartbeat: typeof touchHeartbeat;
    updateLockfile: typeof updateLockfile;
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
    exit: (code: number) => void;
  };
  timer: {
    now: () => number;
    setInterval: (handler: () => void, ms: number) => IntervalHandle;
    clearInterval: (handle: IntervalHandle) => void;
  };
  consoleLog: (...args: unknown[]) => void;
}

interface RunPromptOverrides {
  log?: Partial<RunRuntime["prompt"]["log"]>;
  note?: RunRuntime["prompt"]["note"];
  spinner?: RunRuntime["prompt"]["spinner"];
}

export interface RunRuntimeOverrides
  extends Partial<
    Omit<RunRuntime, "prompt" | "lockfile" | "sound" | "tmux" | "process" | "timer">
  > {
  prompt?: RunPromptOverrides;
  lockfile?: Partial<RunRuntime["lockfile"]>;
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
    loadConfig,
    runDiagnostics,
    collectIssueItems,
    getTmuxInstallHint,
    runReviewCycle,
    lockfile: {
      createLockfile,
      createSessionId,
      readLockfile,
      removeLockfile,
      touchHeartbeat,
      updateLockfile,
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
      exit: (code: number) => {
        process.exit(code);
      },
    },
    timer: {
      now: () => Date.now(),
      setInterval: (handler, ms) => setInterval(handler, ms),
      clearInterval: (handle) => clearInterval(handle),
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
    lockfile: {
      ...defaults.lockfile,
      ...(overrides.lockfile ?? {}),
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

  const projectPath = runtime.process.cwd();
  const branch = await runtime.getGitBranch(projectPath);
  const sessionName = runtime.tmux.generateSessionName();
  const sessionId = runtime.lockfile.createSessionId();

  // Create lockfile for this project
  await runtime.lockfile.createLockfile(undefined, projectPath, sessionName, {
    branch,
    sessionId,
    state: "pending",
    mode: "background",
    lastHeartbeat: runtime.timer.now(),
  });

  const envParts = [
    `RR_PROJECT_PATH=${shellEscape(projectPath)}`,
    `RR_GIT_BRANCH=${shellEscape(branch ?? "")}`,
    `RR_SESSION_ID=${shellEscape(sessionId)}`,
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
    runtime.prompt.note("rr status  - Check status\n" + "rr stop    - Stop the review", "Commands");
  } catch (error) {
    await runtime.lockfile.removeLockfile(undefined, projectPath, { expectedSessionId: sessionId });
    runtime.prompt.log.error(`Failed to start background session: ${error}`);
    runtime.process.exit(1);
  }
}

export async function runForeground(
  args: string[] = [],
  overrides: RunRuntimeOverrides = {}
): Promise<void> {
  const runtime = createRunRuntime(overrides);
  const config = await runtime.loadConfig();
  if (!config) {
    runtime.prompt.log.error("Failed to load config");
    runtime.process.exit(1);
    return;
  }

  const projectPath = runtime.process.env.RR_PROJECT_PATH || runtime.process.cwd();

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
  const lockData = await runtime.lockfile.readLockfile(undefined, projectPath);
  if (!sessionId) {
    sessionId = lockData?.sessionId ?? runtime.lockfile.createSessionId();
  }

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

  // Update from "pending" (launcher) to "running" with actual PID
  await runtime.lockfile.updateLockfile(
    undefined,
    projectPath,
    {
      pid: runtime.process.pid,
      state: "running",
      mode: "foreground",
      lastHeartbeat: runtime.timer.now(),
      currentAgent: runSimplifier ? "code-simplifier" : "reviewer",
    },
    {
      expectedSessionId: expectedSessionId ?? lockData?.sessionId ?? sessionId,
    }
  );

  const heartbeatTimer = runtime.timer.setInterval(() => {
    void runtime.lockfile.touchHeartbeat(undefined, projectPath, sessionId).catch(() => {
      // Ignore heartbeat failures (lock may have been removed).
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
      }
    );

    completionState = classifyRunCompletion(cycleResult);
    runtime.consoleLog(`\n${"=".repeat(50)}`);
    if (completionState === "success") {
      runtime.prompt.log.success(`Review cycle complete! (${cycleResult.iterations} iterations)`);
    } else if (completionState === "warning") {
      runtime.prompt.log.warn(
        `Review cycle complete with warnings: ${cycleResult.reason} (${cycleResult.iterations} iterations)`
      );
    } else {
      runtime.prompt.log.error(
        `Review stopped: ${cycleResult.reason} (${cycleResult.iterations} iterations)`
      );
    }
    runtime.consoleLog(`${"=".repeat(50)}\n`);
  } finally {
    runtime.timer.clearInterval(heartbeatTimer);

    if (cycleResult) {
      await runtime.lockfile.updateLockfile(
        undefined,
        projectPath,
        {
          state: cycleResult.finalStatus,
          endTime: runtime.timer.now(),
          reason: cycleResult.reason,
          currentAgent: null,
          lastHeartbeat: runtime.timer.now(),
        },
        {
          expectedSessionId: sessionId,
        }
      );
    } else {
      await runtime.lockfile.updateLockfile(
        undefined,
        projectPath,
        {
          state: "failed",
          endTime: runtime.timer.now(),
          reason: "Review exited unexpectedly",
          currentAgent: null,
          lastHeartbeat: runtime.timer.now(),
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

    // Clean up lockfile for this project
    await runtime.lockfile.removeLockfile(undefined, projectPath, {
      expectedSessionId: sessionId,
    });
  }
}

export async function startReview(
  args: string[],
  overrides: RunRuntimeOverrides = {}
): Promise<void> {
  const runtime = createRunRuntime(overrides);
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

  const loadedConfig = await runtime.loadConfig();

  const hasExplicitMode = options.base || options.uncommitted || options.commit || options.custom;
  if (!hasExplicitMode) {
    if (loadedConfig?.defaultReview?.type === "base") {
      options.base = loadedConfig.defaultReview.branch;
    }
    // else: defaults to uncommitted behavior (no base flag)
  }

  const modeOptions = [
    options.base && "--base",
    options.uncommitted && "--uncommitted",
    options.commit && "--commit",
    options.custom && "--custom",
  ].filter(Boolean);

  if (modeOptions.length > 1) {
    runtime.prompt.log.error(`Cannot use ${modeOptions.join(" and ")} together`);
    runtime.process.exit(1);
    return;
  }

  const preflightSpinner = runtime.prompt.spinner();
  preflightSpinner.start("Running preflight checks...");
  let diagnostics: DiagnosticsReport;
  try {
    diagnostics = await runtime.runDiagnostics("run", {
      projectPath: runtime.process.cwd(),
      baseBranch: options.base,
      commitSha: options.commit,
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

  const config = diagnostics.config ?? (await runtime.loadConfig());
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
