import { useCallback, useRef, useState } from "react";
import type { LogSession } from "@/lib/logger";
import { computeSessionStats, deleteSessionFiles, listLogSessions } from "@/lib/logger";
import { listAllActiveSessions } from "@/lib/session-state";
import { getErrorMessage } from "@/lib/tui/shared/error-message";
import { useMountEffect } from "@/lib/tui/shared/use-mount-effect";
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

export function useSessionOverlayState(): SessionOverlayState {
  const [sessions, setSessions] = useState<LogSession[]>([]);
  const [selectedPath, setSelectedPathState] = useState<string | null>(null);
  const [selectedStats, setSelectedStats] = useState<SessionStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const selectedPathRef = useRef<string | null>(selectedPath);
  const statsRequestIdRef = useRef(0);

  selectedPathRef.current = selectedPath;

  const loadStatsForSession = useCallback(async (session: LogSession | null) => {
    const requestId = statsRequestIdRef.current + 1;
    statsRequestIdRef.current = requestId;

    if (!mountedRef.current) {
      return;
    }

    if (!session) {
      setSelectedStats(null);
      setStatsLoading(false);
      setStatsError(null);
      return;
    }

    setStatsLoading(true);
    setSelectedStats(null);
    setStatsError(null);

    try {
      const stats = await computeSessionStats(session);
      if (!mountedRef.current || statsRequestIdRef.current !== requestId) {
        return;
      }
      setSelectedStats(stats);
    } catch (error) {
      if (!mountedRef.current || statsRequestIdRef.current !== requestId) {
        return;
      }
      setStatsError(getErrorMessage(error));
    } finally {
      if (mountedRef.current && statsRequestIdRef.current === requestId) {
        setStatsLoading(false);
      }
    }
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      setIsLoading(true);
      setSessionsError(null);

      const loadedSessions = await listLogSessions();
      if (!mountedRef.current) {
        return;
      }

      setSessions(loadedSessions);
      const nextSelectedSession =
        (selectedPathRef.current
          ? loadedSessions.find((session) => session.path === selectedPathRef.current)
          : null) ??
        loadedSessions[0] ??
        null;

      setSelectedPathState(nextSelectedSession?.path ?? null);
      void loadStatsForSession(nextSelectedSession);
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }

      setSessions([]);
      setSelectedPathState(null);
      void loadStatsForSession(null);
      setSessionsError(getErrorMessage(error));
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [loadStatsForSession]);

  useMountEffect(() => {
    void loadSessions();

    return () => {
      mountedRef.current = false;
      statsRequestIdRef.current += 1;
    };
  });

  const setSelectedPath = useCallback(
    (path: string | null) => {
      setSelectedPathState(path);
      const session = path ? (sessions.find((entry) => entry.path === path) ?? null) : null;
      void loadStatsForSession(session);
    },
    [loadStatsForSession, sessions]
  );

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
      setSelectedPathState(nextSelectedSession?.path ?? null);
      void loadStatsForSession(nextSelectedSession);

      return { deleted: true };
    } catch (error) {
      setDeleteError(getErrorMessage(error));
      return { deleted: false };
    } finally {
      setIsDeleting(false);
    }
  }, [isDeleting, loadStatsForSession, selectedPath, sessions]);

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
