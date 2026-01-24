/**
 * Stop command - stop running review session
 */

import type { RunState } from "../lib/types";
import { STATE_PATH } from "../lib/config";
import { listRalphSessions, killSession, sendInterrupt } from "../lib/tmux";
import { removeLockfile } from "./run";

/**
 * Update state to stopped
 */
async function updateStateStopped(): Promise<void> {
  const file = Bun.file(STATE_PATH);
  if (await file.exists()) {
    try {
      const state = JSON.parse(await file.text()) as RunState;
      state.status = "stopped";
      await Bun.write(STATE_PATH, JSON.stringify(state, null, 2));
    } catch {
      // Ignore errors
    }
  }
}

/**
 * Main stop command handler
 */
export async function runStop(args: string[]): Promise<void> {
  const force = args.includes("--force") || args.includes("-f");
  
  // Find running ralph sessions
  const sessions = await listRalphSessions();
  
  if (sessions.length === 0) {
    // Clean up lockfile anyway
    await removeLockfile();
    console.log("No active review session found.");
    console.log("Cleaned up lockfile.");
    return;
  }
  
  const sessionName = sessions[sessions.length - 1]!;
  
  if (force) {
    // Force kill immediately
    console.log(`Force stopping session: ${sessionName}`);
    await killSession(sessionName);
  } else {
    // Send interrupt first, wait, then kill
    console.log(`Stopping session: ${sessionName}`);
    console.log("Sending interrupt signal...");
    
    await sendInterrupt(sessionName);
    
    // Wait a bit for graceful shutdown
    await new Promise((resolve) => setTimeout(resolve, 2000));
    
    // Check if still running
    const stillRunning = await listRalphSessions();
    if (stillRunning.includes(sessionName)) {
      console.log("Session still running, force killing...");
      await killSession(sessionName);
    }
  }
  
  // Clean up
  await removeLockfile();
  await updateStateStopped();
  
  console.log("✅ Review stopped.");
}
