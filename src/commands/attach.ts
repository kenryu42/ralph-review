/**
 * Attach command - attach to running review session
 */

import * as p from "@clack/prompts";
import { attachSession, listRalphSessions, sessionExists } from "@/lib/tmux";

/**
 * Main attach command handler
 */
export async function runAttach(): Promise<void> {
  // Find running ralph sessions
  const sessions = await listRalphSessions();

  if (sessions.length === 0) {
    p.log.warn("No active review session found.");
    p.log.message('Start a review with "rr run"');
    process.exit(1);
  }

  // Use the most recent session (last in list, usually highest timestamp)
  const sessionName = sessions.at(-1);
  if (!sessionName) {
    p.log.warn("No active review session found.");
    p.log.message('Start a review with "rr run"');
    process.exit(1);
  }

  if (!(await sessionExists(sessionName))) {
    p.log.error(`Session ${sessionName} no longer exists.`);
    process.exit(1);
  }

  p.log.step(`Attaching to session: ${sessionName}`);
  p.note("Detach with Ctrl-B d", "Tip");

  await attachSession(sessionName);
}
