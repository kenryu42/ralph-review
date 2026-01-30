/**
 * Run command for ralph-review
 * Starts the review cycle in background or foreground
 */

import { resolve } from "node:path";
import * as p from "@clack/prompts";
import { $ } from "bun";
import { getCommandDef } from "@/cli";
import { AGENTS, isAgentAvailable } from "@/lib/agents";
import { parseCommand } from "@/lib/cli-parser";
import { configExists, loadConfig } from "@/lib/config";
import { runReviewCycle } from "@/lib/engine";
import {
  cleanupStaleLockfile,
  createLockfile,
  lockfileExists,
  removeLockfile,
  updateLockfile,
} from "@/lib/lockfile";
import { getGitBranch } from "@/lib/logger";
import { defaultReviewPrompt } from "@/lib/prompts";
import { createSession, generateSessionName, isInsideTmux, isTmuxInstalled } from "@/lib/tmux";
import { type Config, isAgentType } from "@/lib/types";

/**
 * Options parsed from run command arguments
 */
export interface RunOptions {
  max?: number;
  base?: string;
  file?: string;
  uncommitted?: boolean;
}

/**
 * Check if current directory is a git repository
 */
export async function isGitRepo(): Promise<boolean> {
  try {
    const result = await $`git rev-parse --git-dir 2>/dev/null`.quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Check if there are uncommitted changes
 */
export async function hasUncommittedChanges(): Promise<boolean> {
  try {
    // Check for staged, unstaged, or untracked files
    const result = await $`git status --porcelain`.quiet();
    return result.text().trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Validate all prerequisites for running
 * Returns array of error messages (empty if all good)
 * @param baseBranch - If provided, skip uncommitted changes check (reviewing against branch instead)
 */
export async function validatePrerequisites(baseBranch?: string): Promise<string[]> {
  const errors: string[] = [];

  // Check config exists
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

  // Check uncommitted changes (only when reviewing uncommitted, not base branch)
  if (!baseBranch && !(await hasUncommittedChanges())) {
    errors.push("No uncommitted changes to review.");
  }

  // Check reviewer agent is available
  if (!isAgentType(config.reviewer.agent)) {
    errors.push(`Unknown reviewer agent: "${config.reviewer.agent}"`);
  } else {
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

/**
 * Run full review cycle in tmux background
 */
async function runInBackground(
  _config: Config,
  maxIterations?: number,
  baseBranch?: string,
  basePrompt?: string
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

  // Build the command to run in tmux
  // Pass project path and branch via environment variables
  // Pass base prompt as base64 to handle special characters and newlines
  // Always use main cli.ts, not whatever entry point was used (e.g., cli-rrr.ts)
  const cliPath = `${import.meta.dir}/../cli.ts`;
  const maxIterArg = maxIterations ? ` --max ${maxIterations}` : "";
  const baseBranchEnv = baseBranch ? ` RR_BASE_BRANCH="${baseBranch}"` : "";
  const promptToEncode = basePrompt ?? defaultReviewPrompt;
  const basePromptB64 = Buffer.from(promptToEncode).toString("base64");
  const envVars = `RR_PROJECT_PATH="${projectPath}" RR_GIT_BRANCH="${branch ?? ""}"${baseBranchEnv} RR_BASE_PROMPT_B64="${basePromptB64}"`;
  const command = `${envVars} ${process.execPath} ${cliPath} _run-foreground${maxIterArg}`;

  try {
    await createSession(sessionName, command);
    p.log.success(`Review started in background session: ${sessionName}`);
    p.note("rr status  - Check status\n" + "rr stop    - Stop the review", "Commands");
  } catch (error) {
    await removeLockfile(undefined, projectPath);
    p.log.error(`Failed to start background session: ${error}`);
    process.exit(1);
  }
}

/**
 * Internal: Run review cycle in foreground (called from tmux)
 */
export async function runForeground(args: string[] = []): Promise<void> {
  const config = await loadConfig();
  if (!config) {
    p.log.error("Failed to load config");
    process.exit(1);
  }

  // Get project path from environment variable (set by parent process)
  const projectPath = process.env.RR_PROJECT_PATH || process.cwd();

  // Get base branch from environment variable (set by parent process for --base mode)
  const baseBranch = process.env.RR_BASE_BRANCH || undefined;

  // Get base prompt from environment variable (base64 encoded)
  const basePrompt = process.env.RR_BASE_PROMPT_B64
    ? Buffer.from(process.env.RR_BASE_PROMPT_B64, "base64").toString("utf-8")
    : defaultReviewPrompt;

  // Parse --max option using the _run-foreground command def
  const foregroundDef = getCommandDef("_run-foreground");
  if (foregroundDef) {
    try {
      const { values } = parseCommand<{ max?: number }>(foregroundDef, args);
      if (values.max !== undefined) {
        config.maxIterations = values.max;
      }
    } catch {
      // Ignore parse errors for internal command
    }
  }

  // Update lockfile with this foreground process's PID and "running" status
  // so it's not seen as stale (the launcher set status to "pending")
  await updateLockfile(undefined, projectPath, { pid: process.pid, status: "running" });

  p.intro("Ralph Review Loop");

  try {
    const result = await runReviewCycle(
      config,
      (iteration, _role, _iterResult) => {
        // Update lockfile with iteration progress
        updateLockfile(undefined, projectPath, { iteration }).catch(() => {});
      },
      { baseBranch, basePrompt }
    );

    console.log(`\n${"=".repeat(50)}`);
    if (result.success) {
      p.log.success(`Review cycle complete! (${result.iterations} iterations)`);
    } else {
      p.log.error(`Review stopped: ${result.reason} (${result.iterations} iterations)`);
    }
    console.log(`${"=".repeat(50)}\n`);
  } finally {
    // Clean up lockfile for this project
    await removeLockfile(undefined, projectPath);
  }
}

/**
 * Main run command handler
 */
export async function runRun(args: string[]): Promise<void> {
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

  // Validate mutual exclusivity of --base and --uncommitted
  if (options.base && options.uncommitted) {
    p.log.error("Cannot use --base and --uncommitted together");
    process.exit(1);
  }

  // Validate and load custom prompt file if provided
  let basePrompt: string | undefined;
  if (options.file) {
    const resolved = resolve(process.cwd(), options.file);
    const file = Bun.file(resolved);
    if (!(await file.exists())) {
      p.log.error(`Prompt file not found: ${resolved}`);
      process.exit(1);
    }
    basePrompt = await file.text();
  }

  // Validate prerequisites
  const errors = await validatePrerequisites(options.base);

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

  await runInBackground(config, options.max, options.base, basePrompt);
}
