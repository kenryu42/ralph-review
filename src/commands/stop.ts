import * as p from "@clack/prompts";
import { getCommandDef } from "@/cli";
import { parseCommand } from "@/lib/cli-parser";
import {
  type ActiveSession,
  listAllActiveSessions,
  listProjectActiveSessions,
  readSessionState,
  removeAllSessionStates,
  removeSessionState,
  updateSessionState,
} from "@/lib/session-state";
import { stopActiveSession } from "@/lib/stop-session";
import { killSession, listRalphSessions, sendInterrupt, sessionExists } from "@/lib/tmux";

interface StopOptions {
  all: boolean;
  session?: string;
}

interface StopDeps {
  getCommandDef: typeof getCommandDef;
  logError: (message: string) => void;
  exit: (code: number) => void;
  isTTY: () => boolean;
}

const DEFAULT_STOP_DEPS: StopDeps = {
  getCommandDef,
  logError: (message: string) => p.log.error(message),
  exit: (code: number) => process.exit(code),
  isTTY: () => process.stdout.isTTY === true,
};

function getCurrentProjectSessions(
  sessions: ActiveSession[],
  projectPath: string
): ActiveSession[] {
  return sessions
    .filter((session) => session.projectPath === projectPath)
    .sort((left, right) => {
      if (left.startTime !== right.startTime) {
        return right.startTime - left.startTime;
      }

      return right.sessionId.localeCompare(left.sessionId);
    });
}

function formatSessionSelectorLabel(session: ActiveSession): string {
  return `${session.sessionName} (${session.sessionId.slice(0, 8)})`;
}

function formatSessionSelectorHint(session: ActiveSession): string {
  return session.worktreeProjectPath ?? branchOrProjectHint(session);
}

function branchOrProjectHint(session: ActiveSession): string {
  return session.worktreeBranch ?? session.branch ?? session.projectPath;
}

function findSessionBySelector(
  sessions: ActiveSession[],
  selector: string
): { session: ActiveSession | null; error?: string } {
  const normalizedSelector = selector.trim();
  if (normalizedSelector.length === 0) {
    return { session: null, error: "Session selector cannot be empty." };
  }

  const exactMatches = sessions.filter(
    (session) =>
      session.sessionId === normalizedSelector || session.sessionName === normalizedSelector
  );
  if (exactMatches.length === 1) {
    return { session: exactMatches[0] ?? null };
  }

  const prefixMatches = sessions.filter((session) =>
    session.sessionId.startsWith(normalizedSelector)
  );
  if (prefixMatches.length === 1) {
    return { session: prefixMatches[0] ?? null };
  }

  if (prefixMatches.length > 1) {
    return {
      session: null,
      error: `Session selector "${normalizedSelector}" is ambiguous for the current project.`,
    };
  }

  return {
    session: null,
    error: `No active review session matches "${normalizedSelector}" in the current project.`,
  };
}

async function chooseProjectSession(
  projectSessions: ActiveSession[]
): Promise<ActiveSession | null> {
  const selection = await p.select({
    message: "Choose a review session to stop",
    options: projectSessions.map((session) => ({
      value: session.sessionId,
      label: formatSessionSelectorLabel(session),
      hint: formatSessionSelectorHint(session),
    })),
  });

  if (p.isCancel(selection)) {
    return null;
  }

  return projectSessions.find((session) => session.sessionId === selection) ?? null;
}

async function stopSession(session: ActiveSession): Promise<void> {
  p.log.step(`Stopping session: ${session.sessionName}`);
  await stopActiveSession(session, {
    updateSessionState,
    sendInterrupt,
    readSessionState,
    sessionExists,
    killSession,
    removeSessionState,
  });
  p.log.success("Review stopped.");
}

async function stopAllSessions(): Promise<void> {
  const orphanStopGracePeriod = 1_000;
  const activeSessions = await listAllActiveSessions();
  const tmuxSessions = await listRalphSessions();
  const sessionNames = [
    ...new Set([...tmuxSessions, ...activeSessions.map((session) => session.sessionName)]),
  ];

  if (sessionNames.length === 0) {
    p.log.info("No active review sessions.");
    await removeAllSessionStates();
    return;
  }

  p.log.step(`Stopping ${sessionNames.length} session(s)...`);

  const activeSessionsByName = new Map(
    activeSessions.map((session) => [session.sessionName, session] as const)
  );
  const orphanSessionNames = sessionNames.filter(
    (sessionName) => !activeSessionsByName.has(sessionName)
  );
  const activeStopPromise = Promise.all(
    activeSessions.map((session) =>
      stopActiveSession(session, {
        updateSessionState,
        sendInterrupt,
        readSessionState,
        sessionExists,
        killSession,
        removeSessionState,
      })
    )
  );

  for (const sessionName of orphanSessionNames) {
    await sendInterrupt(sessionName);
  }

  await activeStopPromise;

  if (orphanSessionNames.length > 0) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, orphanStopGracePeriod);
    });
  }

  for (const sessionName of orphanSessionNames) {
    await killSession(sessionName);
  }

  for (const sessionName of sessionNames) {
    p.log.message(`  Stopped: ${sessionName}`);
  }

  await removeAllSessionStates();
  p.log.success(`Stopped ${sessionNames.length} session(s).`);
}

async function stopCurrentProjectSession(
  projectPath: string,
  selector: string | undefined,
  deps: StopDeps
): Promise<void> {
  const projectSessions = getCurrentProjectSessions(
    await listProjectActiveSessions(undefined, projectPath),
    projectPath
  );

  if (selector) {
    const match = findSessionBySelector(projectSessions, selector);
    if (!match.session) {
      deps.logError(match.error ?? "No matching session found.");
      deps.exit(1);
      return;
    }

    await stopSession(match.session);
    return;
  }

  if (projectSessions.length === 0) {
    p.log.info("No active review session for current working directory.");

    const allSessions = await listAllActiveSessions();
    if (allSessions.length > 0) {
      p.log.message(`\nThere are ${allSessions.length} other session(s) running.`);
      p.log.message(
        'Use "rr stop --all" to stop all running review sessions, or "rr" to see details.'
      );
    }
    return;
  }

  if (projectSessions.length === 1) {
    const onlySession = projectSessions[0];
    if (onlySession) {
      await stopSession(onlySession);
    }
    return;
  }

  if (!deps.isTTY()) {
    deps.logError(
      "Multiple review sessions are running for this project. Re-run with --session <id|name>."
    );
    deps.exit(1);
    return;
  }

  const selectedSession = await chooseProjectSession(projectSessions);
  if (!selectedSession) {
    return;
  }

  await stopSession(selectedSession);
}

export async function runStop(args: string[], deps: Partial<StopDeps> = {}): Promise<void> {
  const stopDeps = { ...DEFAULT_STOP_DEPS, ...deps };

  const stopDef = stopDeps.getCommandDef("stop");
  if (!stopDef) {
    stopDeps.logError("Internal error: stop command definition not found");
    stopDeps.exit(1);
    return;
  }

  let options: StopOptions;
  try {
    const { values } = parseCommand<StopOptions>(stopDef, args);
    options = values;
  } catch (error) {
    stopDeps.logError(`${error}`);
    stopDeps.exit(1);
    return;
  }

  if (options.all) {
    await stopAllSessions();
    return;
  }

  await stopCurrentProjectSession(process.cwd(), options.session, stopDeps);
}
