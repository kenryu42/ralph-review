/**
 * Run command for ralph-review
 * Starts the review cycle in background or foreground
 */

import * as p from "@clack/prompts";
import { $ } from "bun";
import { isAgentAvailable } from "@/lib/agents";
import { configExists, ensureConfigDir, LOCK_PATH, loadConfig, STATE_PATH } from "@/lib/config";
import { runReviewCycle } from "@/lib/engine";
import {
  attachSession,
  createSession,
  generateSessionName,
  isInsideTmux,
  isTmuxInstalled,
  listRalphSessions,
} from "@/lib/tmux";
import type { Config, RunState } from "@/lib/types";

/**
 * Options parsed from run command arguments
 */
export interface RunOptions {
  background: boolean;
  list: boolean;
  maxIterations?: number;
}

/**
 * Parse run command options from arguments
 * @throws Error if conflicting flags are provided
 */
export function parseRunOptions(args: string[]): RunOptions {
  let background = false;
  let list = false;
  let maxIterations: number | undefined;

  for (const arg of args) {
    if (arg === "--background" || arg === "-b") {
      background = true;
    } else if (arg === "--list" || arg === "-ls") {
      list = true;
    } else if (arg.startsWith("--max=")) {
      const value = parseInt(arg.split("=")[1] ?? "", 10);
      if (!Number.isNaN(value) && value > 0) {
        maxIterations = value;
      }
    }
  }

  // Check for conflicting flags
  if (background && list) {
    throw new Error("Cannot use --background and --list together");
  }

  return { background, list, maxIterations };
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
 * Check if lockfile exists
 */
export async function lockfileExists(path: string = LOCK_PATH): Promise<boolean> {
  return await Bun.file(path).exists();
}

/**
 * Create lockfile with session info
 */
export async function createLockfile(path: string = LOCK_PATH, sessionName: string): Promise<void> {
  const lockData = {
    sessionName,
    startTime: Date.now(),
    pid: process.pid,
  };
  await ensureConfigDir();
  await Bun.write(path, JSON.stringify(lockData, null, 2));
}

/**
 * Remove lockfile
 */
export async function removeLockfile(path: string = LOCK_PATH): Promise<void> {
  try {
    await Bun.file(path).delete();
  } catch {
    // Ignore if doesn't exist
  }
}

/**
 * Save run state
 */
async function saveState(state: RunState, path: string = STATE_PATH): Promise<void> {
  await ensureConfigDir();
  await Bun.write(path, JSON.stringify(state, null, 2));
}

/**
 * Validate all prerequisites for running
 * Returns array of error messages (empty if all good)
 */
export async function validatePrerequisites(): Promise<string[]> {
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

  // Check uncommitted changes
  if (!(await hasUncommittedChanges())) {
    errors.push("No uncommitted changes to review.");
  }

  // Check reviewer agent is available
  if (!isAgentAvailable(config.reviewer.agent)) {
    errors.push(
      `Reviewer agent "${config.reviewer.agent}" is not installed. Install it and try again.`
    );
  }

  // Check fixer agent is available
  if (!isAgentAvailable(config.fixer.agent)) {
    errors.push(`Fixer agent "${config.fixer.agent}" is not installed. Install it and try again.`);
  }

  // Check lockfile (review already in progress)
  if (await lockfileExists()) {
    errors.push('Review already in progress. Use "rr status" to check or "rr stop" to terminate.');
  }

  return errors;
}

/**
 * Parse --max=N option from args
 * Returns the value or undefined if not provided
 */
function parseMaxIterations(args: string[]): number | undefined {
  for (const arg of args) {
    if (arg.startsWith("--max=")) {
      const value = parseInt(arg.split("=")[1] ?? "", 10);
      if (!Number.isNaN(value) && value > 0) {
        return value;
      }
    }
  }
  return undefined;
}

/**
 * List all running ralph-review sessions
 */
async function listActiveSessions(): Promise<void> {
  const sessions = await listRalphSessions();
  if (sessions.length === 0) {
    p.log.info("No active review sessions.");
  } else {
    p.log.info("Active review sessions:");
    for (const session of sessions) {
      console.log(session);
    }
  }
}

/**
 * Run full review cycle in tmux background
 */
async function runInBackground(_config: Config, maxIterations?: number): Promise<void> {
  // Check tmux is installed
  if (!isTmuxInstalled()) {
    p.log.error("tmux is not installed. Install with: brew install tmux");
    process.exit(1);
  }

  const sessionName = generateSessionName();

  // Create lockfile
  await createLockfile(LOCK_PATH, sessionName);

  // Save initial state
  const state: RunState = {
    sessionName,
    startTime: Date.now(),
    iteration: 0,
    status: "running",
  };
  await saveState(state);

  // Build the command to run in tmux
  // We need to run the CLI with an internal flag
  const cliPath = process.argv[1]; // Path to current CLI
  const maxIterArg = maxIterations ? ` --max=${maxIterations}` : "";
  const command = `${process.execPath} ${cliPath} _run-foreground${maxIterArg}`;

  try {
    await createSession(sessionName, command);
    p.log.success(`Review started in background session: ${sessionName}`);
    p.note(
      "rr attach  - View live progress\n" +
        "rr status  - Check status\n" +
        "rr stop    - Stop the review\n" +
        "rr logs    - View logs in browser",
      "Commands"
    );
  } catch (error) {
    await removeLockfile();
    p.log.error(`Failed to start background session: ${error}`);
    process.exit(1);
  }
}

/**
 * Run full review cycle in tmux and immediately attach (interactive mode)
 */
async function runInteractive(_config: Config, maxIterations?: number): Promise<void> {
  // Check tmux is installed
  if (!isTmuxInstalled()) {
    p.log.error("tmux is not installed. Install with: brew install tmux");
    process.exit(1);
  }

  const sessionName = generateSessionName();

  // Create lockfile
  await createLockfile(LOCK_PATH, sessionName);

  // Save initial state
  const state: RunState = {
    sessionName,
    startTime: Date.now(),
    iteration: 0,
    status: "running",
  };
  await saveState(state);

  // Build the command to run in tmux
  const cliPath = process.argv[1]; // Path to current CLI
  const maxIterArg = maxIterations ? ` --max=${maxIterations}` : "";
  const command = `${process.execPath} ${cliPath} _run-foreground${maxIterArg}`;

  try {
    await createSession(sessionName, command);
    p.log.success(`Review started: ${sessionName}`);

    // Show detach hint BEFORE attaching
    p.note("Detach with: Ctrl-B d", "tmux tip");

    // Immediately attach to the session
    await attachSession(sessionName);
  } catch (error) {
    await removeLockfile();
    p.log.error(`Failed to start session: ${error}`);
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

  // Apply --max override if provided
  const maxIterations = parseMaxIterations(args);
  if (maxIterations !== undefined) {
    config.maxIterations = maxIterations;
  }

  p.intro("ralph-review cycle");

  try {
    const result = await runReviewCycle(config, (iteration, _role, iterResult) => {
      // Update state on each iteration
      const state: RunState = {
        sessionName: "",
        startTime: Date.now(),
        iteration,
        status: "running",
        lastOutput: iterResult.output.slice(-500),
      };
      saveState(state).catch(() => {});
    });

    console.log(`\n${"=".repeat(50)}`);
    if (result.success) {
      p.log.success(`Review cycle complete! (${result.iterations} iterations)`);
    } else {
      p.log.error(`Review stopped: ${result.reason} (${result.iterations} iterations)`);
    }
    console.log(`${"=".repeat(50)}\n`);

    // Update final state
    const finalState: RunState = {
      sessionName: "",
      startTime: Date.now(),
      iteration: result.iterations,
      status: result.success ? "completed" : "failed",
    };
    await saveState(finalState);
  } finally {
    // Clean up lockfile
    await removeLockfile();
  }
}

/**
 * Main run command handler
 */
export async function runRun(args: string[]): Promise<void> {
  // Parse options
  let options: RunOptions;
  try {
    options = parseRunOptions(args);
  } catch (error) {
    p.log.error(`${error}`);
    process.exit(1);
  }

  // Handle --list flag (no prerequisites needed)
  if (options.list) {
    await listActiveSessions();
    return;
  }

  // Validate prerequisites
  const errors = await validatePrerequisites();

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

  // Check if inside tmux - force background mode with warning
  if (isInsideTmux() && !options.background) {
    p.log.warn("Running inside tmux session. Using background mode to avoid nesting.");
    options.background = true;
  }

  // Run in background or interactive mode based on flag
  if (options.background) {
    await runInBackground(config, options.maxIterations);
  } else {
    await runInteractive(config, options.maxIterations);
  }
}
