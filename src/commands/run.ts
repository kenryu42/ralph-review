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
import { createSession, generateSessionName, isInsideTmux, isTmuxInstalled } from "@/lib/tmux";
import { type Config, isAgentType } from "@/lib/types";

export interface RunOptions {
  max?: number;
  force?: boolean;
  base?: string;
  uncommitted?: boolean;
  commit?: string;
  custom?: string;
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

function shellEscape(str: string): string {
  return `'${str.replace(/'/g, "'\\''")}'`;
}

async function runInBackground(
  _config: Config,
  maxIterations?: number,
  baseBranch?: string,
  commitSha?: string,
  customInstructions?: string,
  force?: boolean
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

  // Use main cli.ts to ensure consistent entry point regardless of how rr was invoked
  const cliPath = `${import.meta.dir}/../cli.ts`;
  const maxIterArg = maxIterations ? ` --max ${maxIterations}` : "";
  const forceArg = force ? " --force" : "";
  const baseBranchEnv = baseBranch ? ` RR_BASE_BRANCH=${shellEscape(baseBranch)}` : "";
  const commitShaEnv = commitSha ? ` RR_COMMIT_SHA=${shellEscape(commitSha)}` : "";
  const customPromptEnv = customInstructions
    ? ` RR_CUSTOM_PROMPT=${shellEscape(customInstructions)}`
    : "";
  const envVars = `RR_PROJECT_PATH=${shellEscape(projectPath)} RR_GIT_BRANCH=${shellEscape(branch ?? "")}${baseBranchEnv}${commitShaEnv}${customPromptEnv}`;
  const command = `${envVars} ${process.execPath} ${cliPath} _run-foreground${maxIterArg}${forceArg}`;

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
  let forceMaxIterations = false;

  // Parse --max option using the _run-foreground command def
  const foregroundDef = getCommandDef("_run-foreground");
  if (foregroundDef) {
    try {
      const { values } = parseCommand<{ max?: number; force?: boolean }>(foregroundDef, args);
      if (values.max !== undefined) {
        config.maxIterations = values.max;
      }
      if (values.force) {
        forceMaxIterations = true;
      }
    } catch {
      // Ignore parse errors for internal command
    }
  }

  // Update from "pending" (launcher) to "running" with actual PID
  await updateLockfile(undefined, projectPath, {
    pid: process.pid,
    status: "running",
    currentAgent: "reviewer",
  });

  p.intro("Ralph Review Loop");

  try {
    const result = await runReviewCycle(
      config,
      (iteration, _role, _iterResult) => {
        // Update lockfile with iteration progress
        updateLockfile(undefined, projectPath, { iteration }).catch(() => {});
      },
      { baseBranch, commitSha, customInstructions, forceMaxIterations }
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
    options.force
  );
}
