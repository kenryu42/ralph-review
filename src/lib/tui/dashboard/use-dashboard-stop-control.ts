import { useCallback, useEffect, useState } from "react";
import type { ActiveSession, SessionState } from "@/lib/session-state";
import { stopActiveSession } from "@/lib/stop-session";
import {
  createStoppingSessionState,
  type StoppingSessionState,
  settleStoppingSessionState,
  shouldClearStoppingSessionState,
} from "@/lib/tui/dashboard/dashboard-stop-state";
import { getErrorMessage } from "@/lib/tui/shared/error-message";
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
  const [isStoppingRun, setIsStoppingRun] = useState(false);
  const [stoppingSession, setStoppingSession] = useState<StoppingSessionState | null>(null);

  useEffect(() => {
    if (!stoppingSession) {
      return;
    }

    if (
      shouldClearStoppingSessionState({
        marker: stoppingSession,
        currentSession,
      })
    ) {
      setStoppingSession(null);
      setIsStoppingRun(false);
      return;
    }

    if (stoppingSession.phase !== "settling" || stoppingSession.expiresAt === undefined) {
      return;
    }

    const timeoutMs = Math.max(0, stoppingSession.expiresAt - Date.now());
    const timeout = setTimeout(() => {
      setStoppingSession(null);
      setIsStoppingRun(false);
    }, timeoutMs);

    return () => {
      clearTimeout(timeout);
    };
  }, [currentSession, stoppingSession]);

  const stopSelectedSession = useCallback(
    async (session: ActiveSession) => {
      setIsStoppingRun(true);
      setStoppingSession(createStoppingSessionState(session));

      try {
        await stopSelectedDashboardSession(session, {
          setShowStopPicker,
          stopActiveSession,
        });

        setStoppingSession((current) => {
          if (!current || current.sessionId !== session.sessionId) {
            return current;
          }

          return settleStoppingSessionState(current);
        });
      } catch (error) {
        setStoppingSession(null);
        setIsStoppingRun(false);
        onError(getErrorMessage(error));
      }
    },
    [onError, setShowStopPicker]
  );

  return {
    isStoppingRun,
    stopSelectedSession,
  };
}
