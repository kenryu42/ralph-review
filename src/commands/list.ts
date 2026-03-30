import * as p from "@clack/prompts";
import { listAllActiveSessions } from "@/lib/session-state";
import { listRalphSessions } from "@/lib/tmux";

function formatRelativeStart(startTime: number): string {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startTime) / 1000));

  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s ago`;
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  return `${elapsedHours}h ago`;
}

export async function runList(): Promise<void> {
  const [activeSessions, tmuxSessions] = await Promise.all([
    listAllActiveSessions(),
    listRalphSessions(),
  ]);
  const trackedTmuxSessions = new Set(activeSessions.map((session) => session.sessionName));
  const untrackedTmuxSessions = tmuxSessions.filter(
    (sessionName) => !trackedTmuxSessions.has(sessionName)
  );

  if (activeSessions.length === 0 && untrackedTmuxSessions.length === 0) {
    p.log.info("No active review sessions.");
  } else {
    p.log.info("Active review sessions:");
    for (const session of activeSessions) {
      const worktree = session.worktreeBranch ? ` ${session.worktreeBranch}` : "";
      console.log(
        `${session.sessionId.slice(0, 8)} ${session.sessionName} ${session.projectPath}${worktree} ${formatRelativeStart(session.startTime)}`
      );
    }
    for (const sessionName of untrackedTmuxSessions) {
      console.log(`${sessionName} (tmux only)`);
    }
  }
}
