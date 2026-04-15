import type { SessionState } from "@/lib/session-state";

const STOPPING_SESSION_UI_SETTLE_MS = 2_000;

type StoppingSessionPhase = "stopping" | "settling";

export interface StoppingSessionState {
  sessionId: string;
  sessionPath?: string;
  phase: StoppingSessionPhase;
  expiresAt?: number;
}

export function createStoppingSessionState(
  session: Pick<SessionState, "sessionId" | "sessionPath">
): StoppingSessionState {
  return {
    sessionId: session.sessionId,
    sessionPath: session.sessionPath,
    phase: "stopping",
  };
}

export function settleStoppingSessionState(
  marker: StoppingSessionState,
  now: number = Date.now()
): StoppingSessionState {
  return {
    ...marker,
    phase: "settling",
    expiresAt: now + STOPPING_SESSION_UI_SETTLE_MS,
  };
}

export function shouldSuppressLastSessionStats(marker: StoppingSessionState | null): boolean {
  return marker !== null;
}

export function shouldClearStoppingSessionState({
  marker,
  currentSession,
  now = Date.now(),
}: {
  marker: StoppingSessionState;
  currentSession: SessionState | null;
  now?: number;
}): boolean {
  if (currentSession && currentSession.sessionId !== marker.sessionId) {
    return true;
  }

  if (marker.phase === "stopping") {
    return false;
  }

  return now >= (marker.expiresAt ?? now);
}
