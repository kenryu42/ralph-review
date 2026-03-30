import { type ActiveSession, removeSessionState, updateSessionState } from "@/lib/session-state";
import { killSession, sendInterrupt } from "@/lib/tmux";

export const STOP_SESSION_GRACE_PERIOD_MS = 1_000;

interface StopActiveSessionDeps {
  updateSessionState: typeof updateSessionState;
  sendInterrupt: typeof sendInterrupt;
  sleep: (ms: number) => Promise<void>;
  killSession: typeof killSession;
  removeSessionState: typeof removeSessionState;
}

const DEFAULT_STOP_ACTIVE_SESSION_DEPS: StopActiveSessionDeps = {
  updateSessionState,
  sendInterrupt,
  sleep: (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    }),
  killSession,
  removeSessionState,
};

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
  await stopDeps.sleep(STOP_SESSION_GRACE_PERIOD_MS);
  await stopDeps.killSession(session.sessionName);
  await stopDeps.removeSessionState(undefined, session.projectPath, session.sessionId, {
    expectedSessionId: session.sessionId,
  });
}
