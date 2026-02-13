import * as p from "@clack/prompts";
import { getCommandDef } from "@/cli";
import { getAgentDisplayInfo } from "@/lib/agents/display";
import { parseCommand } from "@/lib/cli-parser";
import { loadConfig } from "@/lib/config";
import { collectIssueItems, runDiagnostics } from "@/lib/diagnostics";
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

function parseSoundOverride(value: string | undefined): SoundOverride | undefined {
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

function getDynamicProbeAgents(config: Config | null): AgentType[] {
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

async function runInBackground(
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
  if (!isTmuxInstalled()) {
    p.log.error("tmux is not installed. Install with: brew install tmux");
    process.exit(1);
  }

  const projectPath = process.cwd();
  const branch = await getGitBranch(projectPath);
  const sessionName = generateSessionName();
  const sessionId = createSessionId();

  // Create lockfile for this project
  await createLockfile(undefined, projectPath, sessionName, {
    branch,
    sessionId,
    state: "pending",
    mode: "background",
    lastHeartbeat: Date.now(),
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
  const command = `${envVars} ${process.execPath} ${CLI_PATH} ${commandArgs.join(" ")}`;

  try {
    await createSession(sessionName, command);
    p.log.success(`Review started in background session: ${sessionName}`);
    const reviewer = getAgentDisplayInfo(config.reviewer);
    const fixer = getAgentDisplayInfo(config.fixer);
    const reviewOptions: ReviewOptions = { baseBranch, commitSha, customInstructions, simplifier };
    p.note(
      `Reviewer: ${reviewer.agentName} (${reviewer.modelName}, reasoning: ${reviewer.reasoning})\n` +
        `Fixer:    ${fixer.agentName} (${fixer.modelName}, reasoning: ${fixer.reasoning})\n` +
        `Review:   ${formatReviewType(reviewOptions)}`,
      "Agents"
    );
    p.note("rr status  - Check status\n" + "rr stop    - Stop the review", "Commands");
  } catch (error) {
    await removeLockfile(undefined, projectPath, { expectedSessionId: sessionId });
    p.log.error(`Failed to start background session: ${error}`);
    process.exit(1);
  }
}

export async function runForeground(args: string[] = []): Promise<void> {
  const config = await loadConfig();
  if (!config) {
    p.log.error("Failed to load config");
    process.exit(1);
  }

  const projectPath = process.env.RR_PROJECT_PATH || process.cwd();

  const baseBranch = process.env.RR_BASE_BRANCH || undefined;
  const commitSha = process.env.RR_COMMIT_SHA || undefined;
  const customInstructions = process.env.RR_CUSTOM_PROMPT || undefined;
  const expectedSessionId = process.env.RR_SESSION_ID || undefined;
  const soundOverride = parseSoundOverride(process.env.RR_SOUND_OVERRIDE);
  let forceMaxIterations = false;
  let runSimplifier = false;
  let completionState: "success" | "warning" | "error" = "error";
  const soundEnabled = resolveSoundEnabled(config, soundOverride);
  let cycleResult: CycleResult | undefined;
  let sessionId = expectedSessionId;
  const lockData = await readLockfile(undefined, projectPath);
  if (!sessionId) {
    sessionId = lockData?.sessionId ?? createSessionId();
  }

  // Parse --max option using the _run-foreground command def
  const foregroundDef = getCommandDef("_run-foreground");
  if (foregroundDef) {
    try {
      const { values } = parseCommand<{ max?: number; force?: boolean; simplifier?: boolean }>(
        foregroundDef,
        args
      );
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
  await updateLockfile(
    undefined,
    projectPath,
    {
      pid: process.pid,
      state: "running",
      mode: "foreground",
      lastHeartbeat: Date.now(),
      currentAgent: runSimplifier ? "code-simplifier" : "reviewer",
    },
    {
      expectedSessionId: expectedSessionId ?? lockData?.sessionId ?? sessionId,
    }
  );

  const heartbeatTimer = setInterval(() => {
    void touchHeartbeat(undefined, projectPath, sessionId).catch(() => {
      // Ignore heartbeat failures (lock may have been removed).
    });
  }, HEARTBEAT_INTERVAL_MS);

  try {
    cycleResult = await runReviewCycle(
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
    console.log(`\n${"=".repeat(50)}`);
    if (completionState === "success") {
      p.log.success(`Review cycle complete! (${cycleResult.iterations} iterations)`);
    } else if (completionState === "warning") {
      p.log.warn(
        `Review cycle complete with warnings: ${cycleResult.reason} (${cycleResult.iterations} iterations)`
      );
    } else {
      p.log.error(`Review stopped: ${cycleResult.reason} (${cycleResult.iterations} iterations)`);
    }
    console.log(`${"=".repeat(50)}\n`);
  } finally {
    clearInterval(heartbeatTimer);

    if (cycleResult) {
      await updateLockfile(
        undefined,
        projectPath,
        {
          state: cycleResult.finalStatus,
          endTime: Date.now(),
          reason: cycleResult.reason,
          currentAgent: null,
          lastHeartbeat: Date.now(),
        },
        {
          expectedSessionId: sessionId,
        }
      );
    } else {
      await updateLockfile(
        undefined,
        projectPath,
        {
          state: "failed",
          endTime: Date.now(),
          reason: "Review exited unexpectedly",
          currentAgent: null,
          lastHeartbeat: Date.now(),
        },
        {
          expectedSessionId: sessionId,
        }
      );
    }

    if (soundEnabled) {
      const soundResult = await playCompletionSound(completionState);
      if (!soundResult.played && soundResult.reason) {
        p.log.warn(`Could not play completion sound: ${soundResult.reason}`);
      }
    }

    // Clean up lockfile for this project
    await removeLockfile(undefined, projectPath, {
      expectedSessionId: sessionId,
    });
  }
}

export async function startReview(args: string[]): Promise<void> {
  // Parse options using command definition
  const runDef = getCommandDef("run");
  if (!runDef) {
    p.log.error("Internal error: run command definition not found");
    process.exit(1);
  }

  let options: RunOptions;
  try {
    const { values } = parseCommand<RunOptions>(runDef, args);
    options = values;
  } catch (error) {
    p.log.error(`${error}`);
    process.exit(1);
  }

  // Validate max iterations if provided
  if (options.max !== undefined && options.max <= 0) {
    p.log.error("--max must be a positive number");
    process.exit(1);
  }
  let soundOverride: SoundOverride | undefined;
  try {
    soundOverride = resolveRunSoundOverride(options);
  } catch (error) {
    p.log.error(`${error}`);
    process.exit(1);
  }

  const loadedConfig = await loadConfig();

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
    p.log.error(`Cannot use ${modeOptions.join(" and ")} together`);
    process.exit(1);
  }

  const preflightSpinner = p.spinner();
  preflightSpinner.start("Running preflight checks...");
  let diagnostics: DiagnosticsReport;
  try {
    diagnostics = await runDiagnostics("run", {
      projectPath: process.cwd(),
      baseBranch: options.base,
      commitSha: options.commit,
      capabilityDiscoveryOptions: {
        probeAgents: getDynamicProbeAgents(loadedConfig),
      },
    });
  } finally {
    preflightSpinner.stop("Preflight checks complete.");
  }
  const issues = collectIssueItems(diagnostics);
  const errors = issues.filter((item) => item.severity === "error");
  const warnings = issues.filter((item) => item.severity === "warning");

  if (errors.length > 0) {
    p.log.error("Cannot run review:");
    for (const item of errors) {
      p.log.message(`  ${item.summary}`);
      item.remediation.forEach((remediation) => {
        p.log.message(`    -> ${remediation}`);
      });
    }
    process.exit(1);
  }

  if (warnings.length > 0) {
    p.log.warn("Preflight warnings:");
    for (const item of warnings) {
      p.log.message(`  ${item.summary}`);
      item.remediation.forEach((remediation) => {
        p.log.message(`    -> ${remediation}`);
      });
    }
  }

  const config = diagnostics.config ?? (await loadConfig());
  if (!config) {
    p.log.error("Failed to load configuration");
    process.exit(1);
  }

  // Check if inside tmux - warn about nesting
  if (isInsideTmux()) {
    p.log.warn("Running inside tmux session. Review will start in a nested session.");
  }

  await runInBackground(
    config,
    options.max,
    options.base,
    options.commit,
    options.custom,
    options.force,
    options.simplifier,
    soundOverride
  );
}
