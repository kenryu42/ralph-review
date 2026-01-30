/** List active tmux review sessions */

import * as p from "@clack/prompts";
import { listRalphSessions } from "@/lib/tmux";

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
