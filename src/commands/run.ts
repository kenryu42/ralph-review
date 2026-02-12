import * as p from "@clack/prompts";
import { $ } from "bun";
import { getCommandDef } from "@/cli";
import { AGENTS, isAgentAvailable } from "@/lib/agents";
import { getAgentDisplayInfo } from "@/lib/agents/display";
import { parseCommand } from "@/lib/cli-parser";
import { configExists, loadConfig } from "@/lib/config";
import { type CycleResult, runReviewCycle } from "@/lib/engine";
import { formatReviewType } from "@/lib/format";
import {
  cleanupStaleLockfile,
  createLockfile,
  lockfileExists,
  removeLockfile,
  updateLockfile,
} from "@/lib/lockfile";
import { getGitBranch } from "@/lib/logger";
import { playCompletionSound, resolveSoundEnabled, type SoundOverride } from "@/lib/notify/sound";
import { CLI_PATH } from "@/lib/paths";
import { createSession, generateSessionName, isInsideTmux, isTmuxInstalled } from "@/lib/tmux";
import { type Config, isAgentType, type ReviewOptions } from "@/lib/types";

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

export async function isGitRepo(): Promise<boolean> {
  try {
    const result = await $`git rev-parse --git-dir 2>/dev/null`.quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function hasUncommittedChanges(): Promise<boolean> {
  try {
    const result = await $`git status --porcelain`.quiet();
    return result.text().trim().length > 0;
  } catch {
    return false;
  }
}

export async function validatePrerequisites(
  baseBranch?: string,
  commitSha?: string
): Promise<string[]> {
  const errors: string[] = [];

  if (!(await configExists())) {
    errors.push('Configuration not found. Run "rr init" first.');
    return errors; // Can't continue without config
  }

  const config = await loadConfig();
  if (!config) {
    errors.push("Failed to load configuration.");
    return errors;
  }

  // Check git repo
  if (!(await isGitRepo())) {
    errors.push("Not a git repository. Run this command from a git repo.");
  }

  // Check uncommitted changes (only when reviewing uncommitted, not base branch or commit)
  if (!baseBranch && !commitSha && !(await hasUncommittedChanges())) {
    errors.push("No uncommitted changes to review.");
  }

  // Check reviewer agent is available
  if (!isAgentType(config.reviewer.agent)) {
    errors.push(`Unknown reviewer agent: "${config.reviewer.agent}"`);
  } else {
    if (
      config.reviewer.agent === "pi" &&
      (!config.reviewer.provider?.trim() || !config.reviewer.model?.trim())
    ) {
      errors.push(
        'Reviewer agent "pi" requires provider and model. Run "rr init" to update config.'
      );
    }

    const reviewerCommand = AGENTS[config.reviewer.agent].config.command;
    if (!isAgentAvailable(reviewerCommand)) {
      errors.push(
        `Reviewer agent "${config.reviewer.agent}" (command: ${reviewerCommand}) is not installed. Install it and try again.`
      );
    }
  }

  // Check fixer agent is available
  if (!isAgentType(config.fixer.agent)) {
    errors.push(`Unknown fixer agent: "${config.fixer.agent}"`);
  } else {
    if (
      config.fixer.agent === "pi" &&
      (!config.fixer.provider?.trim() || !config.fixer.model?.trim())
    ) {
      errors.push('Fixer agent "pi" requires provider and model. Run "rr init" to update config.');
    }

    const fixerCommand = AGENTS[config.fixer.agent].config.command;
    if (!isAgentAvailable(fixerCommand)) {
      errors.push(
        `Fixer agent "${config.fixer.agent}" (command: ${fixerCommand}) is not installed. Install it and try again.`
      );
    }
  }

  // Get project path for lockfile check
  const projectPath = process.cwd();

  // Clean up stale lockfile if exists (PID dead)
  await cleanupStaleLockfile(undefined, projectPath);

  // Check lockfile (review already in progress for this project)
  if (await lockfileExists(undefined, projectPath)) {
    errors.push(
      `Review already in progress for current working directory. Use "rr status" to check or "rr stop" to terminate.`
    );
  }

  return errors;
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

  // Create lockfile for this project
  await createLockfile(undefined, projectPath, sessionName, branch);

  const envParts = [
    `RR_PROJECT_PATH=${shellEscape(projectPath)}`,
    `RR_GIT_BRANCH=${shellEscape(branch ?? "")}`,
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
    await removeLockfile(undefined, projectPath);
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
  const soundOverride = parseSoundOverride(process.env.RR_SOUND_OVERRIDE);
  let forceMaxIterations = false;
  let runSimplifier = false;
  let completionState: "success" | "warning" | "error" = "error";
  const soundEnabled = resolveSoundEnabled(config, soundOverride);

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
  await updateLockfile(undefined, projectPath, {
    pid: process.pid,
    status: "running",
    currentAgent: runSimplifier ? "code-simplifier" : "reviewer",
  });

  try {
    const result = await runReviewCycle(config, undefined, {
      baseBranch,
      commitSha,
      customInstructions,
      simplifier: runSimplifier,
      forceMaxIterations,
    });

    completionState = classifyRunCompletion(result);
    console.log(`\n${"=".repeat(50)}`);
    if (completionState === "success") {
      p.log.success(`Review cycle complete! (${result.iterations} iterations)`);
    } else if (completionState === "warning") {
      p.log.warn(
        `Review cycle complete with warnings: ${result.reason} (${result.iterations} iterations)`
      );
    } else {
      p.log.error(`Review stopped: ${result.reason} (${result.iterations} iterations)`);
    }
    console.log(`${"=".repeat(50)}\n`);
  } finally {
    if (soundEnabled) {
      const soundResult = await playCompletionSound(completionState);
      if (!soundResult.played && soundResult.reason) {
        p.log.warn(`Could not play completion sound: ${soundResult.reason}`);
      }
    }

    // Clean up lockfile for this project
    await removeLockfile(undefined, projectPath);
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

  const hasExplicitMode = options.base || options.uncommitted || options.commit || options.custom;
  if (!hasExplicitMode) {
    const config = await loadConfig();
    if (config?.defaultReview?.type === "base") {
      options.base = config.defaultReview.branch;
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

  // Validate prerequisites
  const errors = await validatePrerequisites(options.base, options.commit);

  if (errors.length > 0) {
    p.log.error("Cannot run review:");
    errors.forEach((e) => {
      p.log.message(`  ${e}`);
    });
    process.exit(1);
  }

  const config = await loadConfig();
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
