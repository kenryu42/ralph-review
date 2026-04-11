import { useCallback, useEffect, useRef, useState } from "react";
import type { LogSession } from "@/lib/logger";
import { computeSessionStats, deleteSessionFiles, listLogSessions } from "@/lib/logger";
import { listAllActiveSessions } from "@/lib/session-state";
import type { SessionStats } from "@/lib/types";

interface DeleteSelectionResult {
  deleted: boolean;
}

export interface SessionOverlayState {
  sessions: LogSession[];
  selectedPath: string | null;
  selectedStats: SessionStats | null;
  isLoading: boolean;
  sessionsError: string | null;
  statsLoading: boolean;
  statsError: string | null;
  isDeleting: boolean;
  deleteError: string | null;
  setSelectedPath: (path: string | null) => void;
  clearDeleteError: () => void;
  deleteSelectedSession: () => Promise<DeleteSelectionResult>;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useSessionOverlayState(): SessionOverlayState {
  const [sessions, setSessions] = useState<LogSession[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedStats, setSelectedStats] = useState<SessionStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const statsRequestIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        setIsLoading(true);
        setSessionsError(null);
        const loadedSessions = await listLogSessions();
        if (cancelled) {
          return;
        }
        setSessions(loadedSessions);
        setSelectedPath((current) => {
          if (current && loadedSessions.some((session) => session.path === current)) {
            return current;
          }
          return loadedSessions[0]?.path ?? null;
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        setSessions([]);
        setSelectedPath(null);
        setSessionsError(toErrorMessage(error));
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const session = selectedPath
      ? (sessions.find((entry) => entry.path === selectedPath) ?? null)
      : null;
    const requestId = statsRequestIdRef.current + 1;
    statsRequestIdRef.current = requestId;

    if (!session) {
      setSelectedStats(null);
      setStatsLoading(false);
      setStatsError(null);
      return;
    }

    setStatsLoading(true);
    setSelectedStats(null);
    setStatsError(null);

    void computeSessionStats(session)
      .then((stats) => {
        if (statsRequestIdRef.current !== requestId) {
          return;
        }
        setSelectedStats(stats);
      })
      .catch((error) => {
        if (statsRequestIdRef.current !== requestId) {
          return;
        }
        setStatsError(toErrorMessage(error));
      })
      .finally(() => {
        if (statsRequestIdRef.current !== requestId) {
          return;
        }
        setStatsLoading(false);
      });
  }, [sessions, selectedPath]);

  const clearDeleteError = useCallback(() => {
    setDeleteError(null);
  }, []);

  const deleteSelectedSession = useCallback(async (): Promise<DeleteSelectionResult> => {
    if (!selectedPath || isDeleting) {
      return { deleted: false };
    }

    setIsDeleting(true);
    setDeleteError(null);

    try {
      const activeSessions = await listAllActiveSessions();
      if (activeSessions.some((session) => session.sessionPath === selectedPath)) {
        setDeleteError("Cannot delete a running session");
        return { deleted: false };
      }

      await deleteSessionFiles(selectedPath);

      const removedIndex = sessions.findIndex((session) => session.path === selectedPath);
      const remainingSessions = sessions.filter((session) => session.path !== selectedPath);
      const nextSelectedSession =
        removedIndex >= 0
          ? (remainingSessions[removedIndex] ??
            remainingSessions[Math.max(removedIndex - 1, 0)] ??
            null)
          : (remainingSessions[0] ?? null);

      setSessions(remainingSessions);
      setSelectedPath(nextSelectedSession?.path ?? null);
      setSelectedStats(null);
      setStatsLoading(false);
      setStatsError(null);

      return { deleted: true };
    } catch (error) {
      setDeleteError(toErrorMessage(error));
      return { deleted: false };
    } finally {
      setIsDeleting(false);
    }
  }, [isDeleting, selectedPath, sessions]);

  return {
    sessions,
    selectedPath,
    selectedStats,
    isLoading,
    sessionsError,
    statsLoading,
    statsError,
    isDeleting,
    deleteError,
    setSelectedPath,
    clearDeleteError,
    deleteSelectedSession,
  };
}
