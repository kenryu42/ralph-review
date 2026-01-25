/**
 * Stop command - stop running review session
 */

import * as p from "@clack/prompts";
import { STATE_PATH } from "@/lib/config";
import { killSession, listRalphSessions, sendInterrupt } from "@/lib/tmux";
import type { RunState } from "@/lib/types";
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
    } catch (error) {
      p.log.error(`Failed to update state: ${error}`);
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
    p.log.info("No active review session found.");
    p.log.message("Cleaned up lockfile.");
    return;
  }

  const sessionName = sessions.at(-1);
  if (!sessionName) {
    p.log.error("Unexpected: session list empty after length check");
    return;
  }

  if (force) {
    // Force kill immediately
    p.log.step(`Force stopping session: ${sessionName}`);
    await killSession(sessionName);
  } else {
    // Send interrupt first, wait, then kill
    p.log.step(`Stopping session: ${sessionName}`);

    const s = p.spinner();
    s.start("Sending interrupt signal...");

    await sendInterrupt(sessionName);

    // Wait a bit for graceful shutdown
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Check if still running
    const stillRunning = await listRalphSessions();
    if (stillRunning.includes(sessionName)) {
      s.message("Session still running, force killing...");
      await killSession(sessionName);
    }

    s.stop("Session terminated");
  }

  // Clean up
  await removeLockfile();
  await updateStateStopped();

  p.log.success("Review stopped.");
}
