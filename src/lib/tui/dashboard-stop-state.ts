import type { SessionState } from "@/lib/session-state";
import type { SessionStats } from "@/lib/types";

const STOPPING_SESSION_UI_SETTLE_MS = 2_000;

export interface StoppingSessionState {
  sessionId: string;
  sessionPath?: string;
  expiresAt: number;
}

export function createStoppingSessionState(
  session: Pick<SessionState, "sessionId" | "sessionPath">,
  now: number = Date.now()
): StoppingSessionState {
  return {
    sessionId: session.sessionId,
    sessionPath: session.sessionPath,
    expiresAt: now + STOPPING_SESSION_UI_SETTLE_MS,
  };
}

function matchesStoppingSessionState(
  marker: StoppingSessionState,
  sessionStats: SessionStats | null
): boolean {
  if (!sessionStats) {
    return false;
  }

  if (sessionStats.sessionId && sessionStats.sessionId === marker.sessionId) {
    return true;
  }

  return marker.sessionPath !== undefined && sessionStats.sessionPath === marker.sessionPath;
}

export function shouldSuppressLastSessionStats(
  marker: StoppingSessionState | null,
  sessionStats: SessionStats | null
): boolean {
  return marker !== null && matchesStoppingSessionState(marker, sessionStats);
}

export function shouldClearStoppingSessionState({
  marker,
  currentSession,
  lastSessionStats,
  now = Date.now(),
}: {
  marker: StoppingSessionState;
  currentSession: SessionState | null;
  lastSessionStats: SessionStats | null;
  now?: number;
}): boolean {
  if (now >= marker.expiresAt) {
    return true;
  }

  if (currentSession && currentSession.sessionId !== marker.sessionId) {
    return true;
  }

  if (!currentSession && !matchesStoppingSessionState(marker, lastSessionStats)) {
    return true;
  }

  return false;
}
