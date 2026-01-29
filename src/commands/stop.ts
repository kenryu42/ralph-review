/**
 * Stop command - stop running review session
 */

import * as p from "@clack/prompts";
import { getCommandDef } from "@/cli";
import { parseCommand } from "@/lib/cli-parser";
import {
  listAllActiveSessions,
  readLockfile,
  removeAllLockfiles,
  removeLockfile,
} from "@/lib/lockfile";
import { killSession, listRalphSessions, sendInterrupt } from "@/lib/tmux";

/**
 * Options for stop command
 */
interface StopOptions {
  all: boolean;
}

/**
 * Main stop command handler
 */
export async function runStop(args: string[]): Promise<void> {
  // Parse options
  const stopDef = getCommandDef("stop");
  if (!stopDef) {
    p.log.error("Internal error: stop command definition not found");
    process.exit(1);
  }

  let options: StopOptions;
  try {
    const { values } = parseCommand<StopOptions>(stopDef, args);
    options = values;
  } catch (error) {
    p.log.error(`${error}`);
    process.exit(1);
  }

  if (options.all) {
    // Stop all ralph sessions
    await stopAllSessions();
  } else {
    // Stop session for current project+branch
    await stopCurrentSession();
  }
}

/**
 * Stop all ralph-review sessions
 */
async function stopAllSessions(): Promise<void> {
  const sessions = await listRalphSessions();

  if (sessions.length === 0) {
    p.log.info("No active review sessions.");
    // Clean up any orphaned lockfiles
    await removeAllLockfiles();
    return;
  }

  p.log.step(`Stopping ${sessions.length} session(s)...`);

  for (const sessionName of sessions) {
    // Send SIGINT first for graceful shutdown
    await sendInterrupt(sessionName);
  }

  // Wait briefly for graceful shutdown
  await new Promise((resolve) => setTimeout(resolve, 1000));

  for (const sessionName of sessions) {
    await killSession(sessionName);
    p.log.message(`  Stopped: ${sessionName}`);
  }

  // Clean up all lockfiles
  await removeAllLockfiles();

  p.log.success(`Stopped ${sessions.length} session(s).`);
}

/**
 * Stop session for current project
 */
async function stopCurrentSession(): Promise<void> {
  const projectPath = process.cwd();

  // Read lockfile to get session name
  const lockData = await readLockfile(undefined, projectPath);

  if (!lockData) {
    p.log.info(`No active review session for this project.`);

    // Show hint if there are other sessions running
    const allSessions = await listAllActiveSessions();
    if (allSessions.length > 0) {
      p.log.message(`\nThere are ${allSessions.length} other session(s) running.`);
      p.log.message(
        'Use "rr stop --all" to stop all running review sessions, or "rr status" to see details.'
      );
    }
    return;
  }

  p.log.step(`Stopping session: ${lockData.sessionName}`);

  // Send SIGINT first for graceful shutdown
  await sendInterrupt(lockData.sessionName);

  // Wait briefly for graceful shutdown
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Kill the tmux session
  await killSession(lockData.sessionName);

  // Remove the lockfile
  await removeLockfile(undefined, projectPath);

  p.log.success("Review stopped.");
}
