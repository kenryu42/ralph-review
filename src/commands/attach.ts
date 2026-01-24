/**
 * Attach command - attach to running review session
 */

import { listRalphSessions, attachSession, sessionExists } from "../lib/tmux";

/**
 * Main attach command handler
 */
export async function runAttach(): Promise<void> {
  // Find running ralph sessions
  const sessions = await listRalphSessions();
  
  if (sessions.length === 0) {
    console.log("No active review session found.");
    console.log('Start a review with "rr run"');
    process.exit(1);
  }
  
  // Use the most recent session (last in list, usually highest timestamp)
  const sessionName = sessions[sessions.length - 1]!;
  
  if (!(await sessionExists(sessionName))) {
    console.log(`Session ${sessionName} no longer exists.`);
    process.exit(1);
  }
  
  console.log(`Attaching to session: ${sessionName}`);
  console.log("(Detach with Ctrl-B d)\n");
  
  await attachSession(sessionName);
}
