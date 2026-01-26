/**
 * Attach command - attach to running review session
 */

import * as p from "@clack/prompts";
import { getCommandDef } from "@/cli";
import { parseCommand } from "@/lib/cli-parser";
import { attachSession, listRalphSessions, sessionExists } from "@/lib/tmux";

/**
 * Main attach command handler
 * @param args - Optional array containing session name to attach to
 */
export async function runAttach(args: string[] = []): Promise<void> {
  // Parse options (attach has no flags, only positional)
  const attachDef = getCommandDef("attach");
  if (!attachDef) {
    p.log.error("Internal error: attach command definition not found");
    process.exit(1);
  }

  let positional: string[];
  try {
    const result = parseCommand(attachDef, args);
    positional = result.positional;
  } catch (error) {
    p.log.error(`${error}`);
    process.exit(1);
  }

  // Check if a specific session name was provided
  const targetSession = positional[0];

  if (targetSession) {
    // Attach to specific session
    if (!(await sessionExists(targetSession))) {
      p.log.error(`Session '${targetSession}' not found.`);
      p.log.message('Use "rr run --list" to see active sessions.');
      process.exit(1);
    }

    p.log.step(`Attaching to session: ${targetSession}`);
    p.note("Detach with: Ctrl-B d", "tmux tip");
    await attachSession(targetSession);
    return;
  }

  // Find running ralph sessions (default behavior - most recent)
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
  p.note("Detach with: Ctrl-B d", "tmux tip");

  await attachSession(sessionName);
}
