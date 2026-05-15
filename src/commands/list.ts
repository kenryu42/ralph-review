import * as p from "@clack/prompts";
import { listAllActiveSessions } from "@/lib/session-state";
import { listRalphSessions } from "@/lib/tmux";

interface ListDeps {
  listAllActiveSessions: typeof listAllActiveSessions;
  listRalphSessions: typeof listRalphSessions;
  logInfo: (message: string) => void;
  print: (...args: unknown[]) => void;
}

const DEFAULT_LIST_DEPS: ListDeps = {
  listAllActiveSessions,
  listRalphSessions,
  logInfo: p.log.info,
  print: (...args) => console.log(...args),
};

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

export async function runList(deps: Partial<ListDeps> = {}): Promise<void> {
  const listDeps = { ...DEFAULT_LIST_DEPS, ...deps };
  const [activeSessions, tmuxSessions] = await Promise.all([
    listDeps.listAllActiveSessions(),
    listDeps.listRalphSessions(),
  ]);
  const trackedTmuxSessions = new Set(activeSessions.map((session) => session.sessionName));
  const untrackedTmuxSessions = tmuxSessions.filter(
    (sessionName) => !trackedTmuxSessions.has(sessionName)
  );

  if (activeSessions.length === 0 && untrackedTmuxSessions.length === 0) {
    listDeps.logInfo("No active review sessions.");
  } else {
    listDeps.logInfo("Active review sessions:");
    for (const session of activeSessions) {
      const worktree = session.worktreeBranch ? ` ${session.worktreeBranch}` : "";
      listDeps.print(
        `${session.sessionId.slice(0, 8)} ${session.sessionName} ${session.projectPath}${worktree} ${formatRelativeStart(session.startTime)}`
      );
    }
    for (const sessionName of untrackedTmuxSessions) {
      listDeps.print(`${sessionName} (tmux only)`);
    }
  }
}

export type { ListDeps };
