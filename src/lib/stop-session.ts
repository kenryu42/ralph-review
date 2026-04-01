import {
  type ActiveSession,
  readSessionState,
  removeSessionState,
  updateSessionState,
} from "@/lib/session-state";
import { killSession, sendInterrupt, sessionExists } from "@/lib/tmux";

export const STOP_SESSION_GRACE_PERIOD_MS = 30_000;
export const STOP_SESSION_POLL_INTERVAL_MS = 1_000;

interface SessionStopTarget {
  sessionName: string;
  projectPath?: string;
  sessionId?: string;
}

interface WaitForGracefulStopDeps {
  readSessionState: typeof readSessionState;
  sessionExists: typeof sessionExists;
  sleep: (ms: number) => Promise<void>;
}

interface StopActiveSessionDeps {
  updateSessionState: typeof updateSessionState;
  sendInterrupt: typeof sendInterrupt;
  readSessionState: typeof readSessionState;
  sessionExists: typeof sessionExists;
  sleep: (ms: number) => Promise<void>;
  killSession: typeof killSession;
  removeSessionState: typeof removeSessionState;
}

const DEFAULT_STOP_ACTIVE_SESSION_DEPS: StopActiveSessionDeps = {
  updateSessionState,
  sendInterrupt,
  readSessionState,
  sessionExists,
  sleep: (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    }),
  killSession,
  removeSessionState,
};

function isTerminalSessionState(state: ActiveSession["state"]): boolean {
  return (
    state === "completed" || state === "failed" || state === "interrupted" || state === "stopped"
  );
}

async function hasStoppedGracefully(
  target: SessionStopTarget,
  deps: WaitForGracefulStopDeps
): Promise<boolean> {
  if (target.projectPath && target.sessionId) {
    const sessionState = await deps.readSessionState(
      undefined,
      target.projectPath,
      target.sessionId
    );
    if (sessionState && isTerminalSessionState(sessionState.state)) {
      return true;
    }
    if (!sessionState) {
      return !(await deps.sessionExists(target.sessionName));
    }
  }

  return !(await deps.sessionExists(target.sessionName));
}

async function waitForGracefulStop(
  target: SessionStopTarget,
  deps: Partial<WaitForGracefulStopDeps> = {}
): Promise<boolean> {
  const waitDeps = { ...DEFAULT_STOP_ACTIVE_SESSION_DEPS, ...deps };

  if (await hasStoppedGracefully(target, waitDeps)) {
    return true;
  }

  let remainingMs = STOP_SESSION_GRACE_PERIOD_MS;
  while (remainingMs > 0) {
    const sleepMs = Math.min(STOP_SESSION_POLL_INTERVAL_MS, remainingMs);
    await waitDeps.sleep(sleepMs);
    remainingMs -= sleepMs;

    if (await hasStoppedGracefully(target, waitDeps)) {
      return true;
    }
  }

  return false;
}

export async function stopActiveSession(
  session: ActiveSession,
  deps: Partial<StopActiveSessionDeps> = {}
): Promise<void> {
  const stopDeps = { ...DEFAULT_STOP_ACTIVE_SESSION_DEPS, ...deps };

  await stopDeps.updateSessionState(
    undefined,
    session.projectPath,
    session.sessionId,
    {
      state: "stopping",
      lastHeartbeat: Date.now(),
    },
    {
      expectedSessionId: session.sessionId,
    }
  );

  await stopDeps.sendInterrupt(session.sessionName);
  const stoppedGracefully = await waitForGracefulStop(
    {
      sessionName: session.sessionName,
      projectPath: session.projectPath,
      sessionId: session.sessionId,
    },
    stopDeps
  );
  if (!stoppedGracefully) {
    await stopDeps.killSession(session.sessionName);
  }
  await stopDeps.removeSessionState(undefined, session.projectPath, session.sessionId, {
    expectedSessionId: session.sessionId,
  });
}
