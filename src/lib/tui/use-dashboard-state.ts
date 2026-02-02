/**
 * Hook for managing dashboard state with automatic refresh
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { loadConfig } from "@/lib/config";
import { ensureGitRepositoryAsync } from "@/lib/git";
import type { LockData } from "@/lib/lockfile";
import { listAllActiveSessions, readLockfile } from "@/lib/lockfile";
import {
  computeProjectStats,
  computeSessionStats,
  getLatestProjectLogSession,
  getProjectName,
  listProjectLogSessions,
  readLog,
} from "@/lib/logger";
import { getSessionOutput } from "@/lib/tmux";
import type {
  AgentRole,
  FixEntry,
  IterationEntry,
  ProjectStats,
  ReviewOptions,
  SessionStats,
  SkippedEntry,
  SystemEntry,
} from "@/lib/types";
import type { DashboardState } from "./types";

const DEFAULT_REFRESH_INTERVAL = 1000;
const TMUX_REFRESH_INTERVAL = 300;

export function getCurrentAgentFromLockData(lockData: LockData | null): AgentRole | null {
  return lockData?.currentAgent ?? null;
}

export function useDashboardState(
  projectPath: string,
  _branch?: string,
  refreshInterval: number = DEFAULT_REFRESH_INTERVAL
): DashboardState {
  const [state, setState] = useState<DashboardState>({
    sessions: [],
    currentSession: null,
    logEntries: [],
    fixes: [],
    skipped: [],
    tmuxOutput: "",
    elapsed: 0,
    maxIterations: 0,
    error: null,
    isLoading: true,
    lastSessionStats: null,
    projectStats: null,
    config: null,
    isGitRepo: true,
    currentAgent: null,
    reviewOptions: undefined,
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const isRefreshingRef = useRef(false);
  const lastTmuxCaptureRef = useRef(0);
  const lastTmuxOutputRef = useRef("");
  const lastTmuxSessionRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;

    try {
      const [isGitRepo, sessions, lockData, logSession, config] = await Promise.all([
        ensureGitRepositoryAsync(projectPath),
        listAllActiveSessions(),
        readLockfile(undefined, projectPath),
        getLatestProjectLogSession(undefined, projectPath),
        loadConfig().catch(() => null),
      ]);

      let logEntries = stateRef.current.logEntries;
      if (logSession) {
        logEntries = await readLog(logSession.path);
      }

      const fixes: FixEntry[] = [];
      const skipped: SkippedEntry[] = [];
      let maxIterations = 0;
      let reviewOptions: ReviewOptions | undefined;

      for (const entry of logEntries) {
        if (entry.type === "system") {
          const systemEntry = entry as SystemEntry;
          maxIterations = systemEntry.maxIterations;
          reviewOptions = systemEntry.reviewOptions;
        } else if (entry.type === "iteration") {
          const iterEntry = entry as IterationEntry;
          if (iterEntry.fixes) {
            fixes.push(...iterEntry.fixes.fixes);
            skipped.push(...iterEntry.fixes.skipped);
          }
        }
      }

      let tmuxOutput = lastTmuxOutputRef.current;
      const sessionName = lockData?.sessionName ?? null;
      const now = Date.now();

      if (!sessionName) {
        tmuxOutput = "";
        lastTmuxOutputRef.current = "";
        lastTmuxSessionRef.current = null;
        lastTmuxCaptureRef.current = 0;
      } else {
        const sessionChanged = sessionName !== lastTmuxSessionRef.current;
        const shouldCapture =
          sessionChanged || now - lastTmuxCaptureRef.current >= TMUX_REFRESH_INTERVAL;

        if (shouldCapture) {
          tmuxOutput = await getSessionOutput(sessionName, 100);
          lastTmuxOutputRef.current = tmuxOutput;
          lastTmuxSessionRef.current = sessionName;
          lastTmuxCaptureRef.current = now;
        }
      }

      const elapsed = lockData ? Date.now() - lockData.startTime : 0;

      let lastSessionStats: SessionStats | null = null;
      let projectStats: ProjectStats | null = null;

      if (!lockData) {
        const projectSessions = await listProjectLogSessions(undefined, projectPath);
        const latestSession = projectSessions[0];

        if (latestSession) {
          lastSessionStats = await computeSessionStats(latestSession);
          projectStats = await computeProjectStats(getProjectName(projectPath), projectSessions);
        }
      }

      const currentAgent = getCurrentAgentFromLockData(lockData);

      setState({
        sessions,
        currentSession: lockData,
        logEntries,
        fixes,
        skipped,
        tmuxOutput,
        elapsed,
        maxIterations,
        error: null,
        isLoading: false,
        lastSessionStats,
        projectStats,
        config,
        isGitRepo,
        currentAgent,
        reviewOptions,
      });
    } catch (error) {
      setState((prev: DashboardState) => ({
        ...prev,
        error: error instanceof Error ? error.message : "Unknown error",
        isLoading: false,
      }));
    } finally {
      isRefreshingRef.current = false;
    }
  }, [projectPath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const interval = setInterval(refresh, refreshInterval);
    return () => clearInterval(interval);
  }, [refresh, refreshInterval]);

  useEffect(() => {
    if (!state.currentSession) return;

    const startTime = state.currentSession.startTime;
    const interval = setInterval(() => {
      setState((prev: DashboardState) => ({
        ...prev,
        elapsed: Date.now() - startTime,
      }));
    }, 1000);

    return () => clearInterval(interval);
  }, [state.currentSession]);

  return state;
}
