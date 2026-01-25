/**
 * Status command - show current review status
 */

import * as p from "@clack/prompts";
import { STATE_PATH } from "@/lib/config";
import { getSessionOutput, listRalphSessions } from "@/lib/tmux";
import type { RunState } from "@/lib/types";
import { lockfileExists } from "./run";

/**
 * Load run state from disk
 */
async function loadState(): Promise<RunState | null> {
  const file = Bun.file(STATE_PATH);
  if (!(await file.exists())) {
    return null;
  }
  try {
    return JSON.parse(await file.text()) as RunState;
  } catch {
    return null;
  }
}

/**
 * Format duration in human readable form
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Main status command handler
 */
export async function runStatus(): Promise<void> {
  // Check for running sessions
  const sessions = await listRalphSessions();
  const hasLockfile = await lockfileExists();
  const state = await loadState();

  if (sessions.length === 0 && !hasLockfile) {
    p.log.info("No active review session.");

    if (state) {
      p.log.message(`Last run: ${state.status}`);
      p.log.message(`Iterations: ${state.iteration}`);
    }

    p.log.message('Start a review with "rr run"');
    return;
  }

  p.intro("Review Status");

  const sessionName = sessions.at(-1);
  if (sessionName) {
    p.log.step(`Session: ${sessionName}`);
    p.log.success("Status: Running");

    if (state) {
      const elapsed = Date.now() - state.startTime;
      p.log.message(`Iteration: ${state.iteration}`);
      p.log.message(`Elapsed: ${formatDuration(elapsed)}`);

      // Get recent output
      const output = await getSessionOutput(sessionName, 10);
      if (output) {
        const recentLines = output.split("\n").slice(-5).join("\n");
        p.note(recentLines, "Recent output");
      }
    }

    p.note("rr attach  - View live progress\n" + "rr stop    - Stop the review", "Commands");
  } else if (hasLockfile) {
    p.log.warn("Lockfile exists but no session found");
    p.log.message('Run "rr stop" to clean up');
  }
}
