/**
 * Run command for ralph-review
 * Starts the review cycle in background or foreground
 */

import { $ } from "bun";
import { rm } from "fs/promises";
import type { Config, RunState } from "../lib/types";
import { loadConfig, configExists, ensureConfigDir, LOCK_PATH, STATE_PATH, CONFIG_DIR } from "../lib/config";
import { isAgentAvailable } from "../lib/agents";
import { runReviewCycle } from "../lib/engine";
import { isTmuxInstalled, generateSessionName, createSession, sessionExists } from "../lib/tmux";

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
    await rm(path);
  } catch {
    // Ignore if doesn't exist
  }
}

/**
 * Save run state
 */
export async function saveState(state: RunState, path: string = STATE_PATH): Promise<void> {
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

  // Check implementor agent is available
  if (!isAgentAvailable(config.implementor.agent)) {
    errors.push(
      `Implementor agent "${config.implementor.agent}" is not installed. Install it and try again.`
    );
  }

  // Check lockfile (review already in progress)
  if (await lockfileExists()) {
    errors.push(
      'Review already in progress. Use "rr status" to check or "rr stop" to terminate.'
    );
  }

  return errors;
}

/**
 * Run review-only mode (foreground, single review)
 */
async function runReviewOnly(config: Config): Promise<void> {
  console.log("🔍 Running single review (no implementation)...\n");

  const { runAgent } = await import("../lib/agents");
  const result = await runAgent("reviewer", config);

  console.log(result.output);

  if (result.hasIssues) {
    console.log("\n⚠️  Issues found. Run 'rr run' for full review cycle.");
  } else {
    console.log("\n✅ No issues found.");
  }

  process.exit(result.success ? 0 : 1);
}

/**
 * Run full review cycle in tmux background
 */
async function runInBackground(config: Config): Promise<void> {
  // Check tmux is installed
  if (!isTmuxInstalled()) {
    console.error("❌ tmux is not installed. Install with: brew install tmux");
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
  const command = `${process.execPath} ${cliPath} _run-foreground`;

  try {
    await createSession(sessionName, command);
    console.log(`\n🚀 Review started in background session: ${sessionName}`);
    console.log("\nCommands:");
    console.log("  rr attach  - View live progress");
    console.log("  rr status  - Check status");
    console.log("  rr stop    - Stop the review");
    console.log("  rr logs    - View logs in browser\n");
  } catch (error) {
    await removeLockfile();
    console.error("❌ Failed to start background session:", error);
    process.exit(1);
  }
}

/**
 * Internal: Run review cycle in foreground (called from tmux)
 */
export async function runForeground(): Promise<void> {
  const config = await loadConfig();
  if (!config) {
    console.error("Failed to load config");
    process.exit(1);
  }

  console.log("\n🔄 Starting review cycle...\n");

  try {
    const result = await runReviewCycle(config, (iteration, role, iterResult) => {
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
    console.log(`Review cycle complete!`);
    console.log(`Iterations: ${result.iterations}`);
    console.log(`Result: ${result.success ? "✅ Success" : "❌ " + result.reason}`);
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
  const reviewOnly = args.includes("--review-only");

  // Validate prerequisites
  const errors = await validatePrerequisites();

  // For review-only, we don't need lockfile check
  if (reviewOnly) {
    const filteredErrors = errors.filter(
      (e) => !e.includes("already in progress")
    );
    if (filteredErrors.length > 0) {
      console.error("❌ Cannot run review:\n");
      filteredErrors.forEach((e) => console.error(`  • ${e}`));
      process.exit(1);
    }

    const config = await loadConfig();
    if (!config) {
      console.error("Failed to load configuration");
      process.exit(1);
    }

    await runReviewOnly(config);
    return;
  }

  // Full mode - all errors apply
  if (errors.length > 0) {
    console.error("❌ Cannot run review:\n");
    errors.forEach((e) => console.error(`  • ${e}`));
    process.exit(1);
  }

  const config = await loadConfig();
  if (!config) {
    console.error("Failed to load configuration");
    process.exit(1);
  }

  await runInBackground(config);
}
