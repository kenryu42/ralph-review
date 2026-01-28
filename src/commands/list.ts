/**
 * List command - list active review sessions
 */

import * as p from "@clack/prompts";
import { listRalphSessions } from "@/lib/tmux";

/**
 * List all running ralph-review sessions
 */
export async function runList(): Promise<void> {
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
