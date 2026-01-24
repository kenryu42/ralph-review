/**
 * Status command - show current review status
 */

import type { RunState } from "../lib/types";
import { STATE_PATH, LOCK_PATH } from "../lib/config";
import { listRalphSessions, getSessionOutput, sessionExists } from "../lib/tmux";
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
    console.log("No active review session.");
    
    if (state) {
      console.log(`\nLast run: ${state.status}`);
      console.log(`Iterations: ${state.iteration}`);
    }
    
    console.log('\nStart a review with "rr run"');
    return;
  }
  
  console.log("📊 Review Status\n");
  
  if (sessions.length > 0) {
    const sessionName = sessions[sessions.length - 1]!;
    console.log(`Session: ${sessionName}`);
    console.log(`Status: 🟢 Running`);
    
    if (state) {
      const elapsed = Date.now() - state.startTime;
      console.log(`Iteration: ${state.iteration}`);
      console.log(`Elapsed: ${formatDuration(elapsed)}`);
      
      // Get recent output
      const output = await getSessionOutput(sessionName, 10);
      if (output) {
        console.log("\nRecent output:");
        console.log("─".repeat(40));
        console.log(output.split("\n").slice(-5).join("\n"));
        console.log("─".repeat(40));
      }
    }
    
    console.log('\nCommands:');
    console.log('  rr attach  - View live progress');
    console.log('  rr stop    - Stop the review');
  } else if (hasLockfile) {
    console.log("Status: ⚠️  Lockfile exists but no session found");
    console.log('Run "rr stop" to clean up');
  }
}
