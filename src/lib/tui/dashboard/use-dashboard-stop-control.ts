import { useCallback, useMemo, useRef, useState } from "react";
import type { ActiveSession, SessionState } from "@/lib/session-state";
import { stopActiveSession } from "@/lib/stop-session";
import {
  createStoppingSessionState,
  type StoppingSessionState,
  settleStoppingSessionState,
  shouldClearStoppingSessionState,
} from "@/lib/tui/dashboard/dashboard-stop-state";
import { getErrorMessage } from "@/lib/tui/shared/error-message";
import { useMountEffect } from "@/lib/tui/shared/use-mount-effect";
import { stopSelectedDashboardSession } from "./dashboard-stop";

interface DashboardStopControlOptions {
  currentSession: SessionState | null;
  setShowStopPicker: (value: boolean) => void;
  onError: (message: string) => void;
}

export interface DashboardStopControl {
  isStoppingRun: boolean;
  stopSelectedSession: (session: ActiveSession) => Promise<void>;
}

export function useDashboardStopControl({
  currentSession,
  setShowStopPicker,
  onError,
}: DashboardStopControlOptions): DashboardStopControl {
  const [stoppingSession, setStoppingSession] = useState<StoppingSessionState | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSettleTimer = useMemo(
    () => () => {
      if (settleTimerRef.current !== null) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
    },
    []
  );

  if (
    stoppingSession &&
    shouldClearStoppingSessionState({ marker: stoppingSession, currentSession })
  ) {
    clearSettleTimer();
    setStoppingSession(null);
  }

  useMountEffect(() => () => clearSettleTimer());

  const stopSelectedSession = useCallback(
    async (session: ActiveSession) => {
      clearSettleTimer();
      setStoppingSession(createStoppingSessionState(session));

      try {
        await stopSelectedDashboardSession(session, {
          setShowStopPicker,
          stopActiveSession,
        });

        const settled = settleStoppingSessionState(createStoppingSessionState(session));
        setStoppingSession((current) =>
          current && current.sessionId === session.sessionId ? settled : current
        );

        const delay = Math.max(0, (settled.expiresAt ?? Date.now()) - Date.now());
        settleTimerRef.current = setTimeout(() => {
          settleTimerRef.current = null;
          setStoppingSession((current) =>
            current && current.sessionId === session.sessionId && current.phase === "settling"
              ? null
              : current
          );
        }, delay);
      } catch (error) {
        clearSettleTimer();
        setStoppingSession(null);
        onError(getErrorMessage(error));
      }
    },
    [clearSettleTimer, onError, setShowStopPicker]
  );

  return {
    isStoppingRun: stoppingSession !== null,
    stopSelectedSession,
  };
}
