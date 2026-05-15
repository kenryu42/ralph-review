import { basename } from "node:path";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadEffectiveConfig } from "@/lib/config";
import { ensureGitRepositoryAsync } from "@/lib/git";
import type { LogIncrementalState, LogSession } from "@/lib/logger";
import {
  computeProjectStats,
  computeSessionStats,
  getLatestProjectLogSession,
  getProjectName,
  listProjectLogSessions,
  readLogIncremental,
} from "@/lib/logger";
import type { ActiveSession, SessionState } from "@/lib/session-state";
import {
  getLatestProjectActiveSession,
  listAllActiveSessions,
  listProjectActiveSessions,
} from "@/lib/session-state";
import {
  computeNextTmuxCaptureInterval,
  getSessionOutput,
  shouldCaptureTmux,
  TMUX_CAPTURE_MIN_INTERVAL_MS,
} from "@/lib/tmux";
import type { ProjectStats, SessionStats } from "@/lib/types";
import { deriveWorkspaceLogData, loadWorkspaceConfigSafe } from "./workspace-log-state";
import {
  getLiveRefreshMeta,
  hasLiveMetaChanged,
  type LiveRefreshMeta,
  mergeHeavyRefreshState,
  mergeIncrementalLogEntries,
} from "./workspace-refresh-utils";
import type { SessionGroupData, WorkspaceState } from "./workspace-types";

const DEFAULT_REFRESH_INTERVAL = 1000;

export interface WorkspaceStateDeps {
  loadEffectiveConfig: typeof loadEffectiveConfig;
  ensureGitRepositoryAsync: typeof ensureGitRepositoryAsync;
  listAllActiveSessions: typeof listAllActiveSessions;
  listProjectActiveSessions: typeof listProjectActiveSessions;
  getLatestProjectActiveSession: (
    storageRoot: string | undefined,
    projectPath: string
  ) => Promise<SessionState | null>;
  getLatestProjectLogSession: (
    storageRoot: string | undefined,
    projectPath: string
  ) => Promise<LogSession | null>;
  readLogIncremental: typeof readLogIncremental;
  listProjectLogSessions: typeof listProjectLogSessions;
  computeSessionStats: typeof computeSessionStats;
  computeProjectStats: typeof computeProjectStats;
  getProjectName: typeof getProjectName;
  shouldCaptureTmux: typeof shouldCaptureTmux;
  getSessionOutput: (sessionName: string, lines: number) => Promise<string>;
  computeNextTmuxCaptureInterval: typeof computeNextTmuxCaptureInterval;
  tmuxCaptureMinIntervalMs: number;
}

const defaultWorkspaceStateDeps: WorkspaceStateDeps = {
  loadEffectiveConfig,
  ensureGitRepositoryAsync,
  listAllActiveSessions,
  listProjectActiveSessions,
  getLatestProjectActiveSession,
  getLatestProjectLogSession,
  readLogIncremental,
  listProjectLogSessions,
  computeSessionStats,
  computeProjectStats,
  getProjectName,
  shouldCaptureTmux,
  getSessionOutput,
  computeNextTmuxCaptureInterval,
  tmuxCaptureMinIntervalMs: TMUX_CAPTURE_MIN_INTERVAL_MS,
};

export function createInitialWorkspaceState(
  overrides: Partial<WorkspaceState> = {}
): WorkspaceState {
  return {
    sessionGroups: [],
    allSessions: [],
    projectSessions: [],
    selectedSessionId: null,
    currentSession: null,
    logEntries: [],
    fixes: [],
    skipped: [],
    findings: [],
    storedFindings: [],
    selectedFindingIds: [],
    selectedFindings: [],
    unselectedFindings: [],
    fixResults: [],
    unresolvedSelectedFindings: [],
    auditRegressionFindings: [],
    iterationFixes: [],
    iterationSkipped: [],
    iterationFindings: [],
    latestReviewIteration: null,
    codexReviewText: null,
    tmuxOutput: "",
    elapsed: 0,
    maxIterations: 0,
    error: null,
    liveRefreshError: null,
    isLoading: true,
    lastSessionStats: null,
    projectStats: null,
    config: null,
    configWarning: null,
    isGitRepo: true,
    currentAgent: null,
    reviewOptions: undefined,
    outputVisible: false,
    ...overrides,
  };
}

function buildSessionGroups(
  allSessions: ActiveSession[],
  currentProjectPath: string
): SessionGroupData[] {
  const groupMap = new Map<string, SessionGroupData>();

  const currentProjectName = basename(currentProjectPath);
  groupMap.set(currentProjectPath, {
    projectPath: currentProjectPath,
    projectName: currentProjectName,
    isCurrentProject: true,
    sessions: [],
  });

  for (const session of allSessions) {
    let group = groupMap.get(session.projectPath);
    if (!group) {
      group = {
        projectPath: session.projectPath,
        projectName: basename(session.projectPath),
        isCurrentProject: false,
        sessions: [],
      };
      groupMap.set(session.projectPath, group);
    }
    group.sessions.push(session);
  }

  const groups = [...groupMap.values()];
  groups.sort((a, b) => {
    if (a.isCurrentProject) return -1;
    if (b.isCurrentProject) return 1;
    return a.projectName.localeCompare(b.projectName);
  });

  return groups;
}

export function useWorkspaceState(
  projectPath: string,
  _branch?: string,
  refreshInterval: number = DEFAULT_REFRESH_INTERVAL,
  deps: WorkspaceStateDeps = defaultWorkspaceStateDeps
): WorkspaceState {
  const [state, setState] = useState<WorkspaceState>(() => createInitialWorkspaceState());

  const stateRef = useRef(state);
  stateRef.current = state;

  const isHeavyRefreshingRef = useRef(false);
  const isLiveRefreshingRef = useRef(false);
  const lastTmuxCaptureRef = useRef(0);
  const lastTmuxOutputRef = useRef("");
  const lastTmuxSessionRef = useRef<string | null>(null);
  const tmuxCaptureIntervalRef = useRef(deps.tmuxCaptureMinIntervalMs);
  const lastLiveMetaRef = useRef<LiveRefreshMeta | null>(null);
  const logIncrementalStateRef = useRef<LogIncrementalState | undefined>(undefined);
  const lastLogSessionPathRef = useRef<string | null>(null);

  const refreshHeavy = useCallback(async () => {
    if (isHeavyRefreshingRef.current) return;
    isHeavyRefreshingRef.current = true;

    try {
      const [isGitRepo, allSessions, projectSessions, currentSession, logSession, configResult] =
        await Promise.all([
          deps.ensureGitRepositoryAsync(projectPath),
          deps.listAllActiveSessions(),
          deps.listProjectActiveSessions(undefined, projectPath),
          deps.getLatestProjectActiveSession(undefined, projectPath),
          deps.getLatestProjectLogSession(undefined, projectPath),
          loadWorkspaceConfigSafe(projectPath, deps.loadEffectiveConfig),
        ]);

      const sessionGroups = buildSessionGroups(allSessions, projectPath);

      // Auto-select: prefer current selection if still alive, then latest project session
      const prevSelectedId = stateRef.current.selectedSessionId;
      const stillAlive = allSessions.find((s) => s.sessionId === prevSelectedId);
      const selectedSessionId = stillAlive
        ? prevSelectedId
        : (currentSession?.sessionId ?? allSessions[0]?.sessionId ?? null);

      let logEntries = stateRef.current.logEntries;
      let nextLogIncrementalState = logIncrementalStateRef.current;
      let nextLogSessionPath = lastLogSessionPathRef.current;

      const logPath = currentSession
        ? (currentSession.sessionPath ?? null)
        : (logSession?.path ?? null);

      if (logPath) {
        const logSessionChanged = logPath !== lastLogSessionPathRef.current;
        const incrementalResult = await deps.readLogIncremental(
          logPath,
          logSessionChanged ? undefined : logIncrementalStateRef.current
        );
        nextLogIncrementalState = incrementalResult.state;
        nextLogSessionPath = logPath;
        logEntries = mergeIncrementalLogEntries(stateRef.current.logEntries, incrementalResult);
      } else {
        nextLogIncrementalState = undefined;
        nextLogSessionPath = null;
        logEntries = [];
      }

      const {
        fixes,
        skipped,
        findings,
        storedFindings,
        selectedFindingIds,
        selectedFindings,
        unselectedFindings,
        fixResults,
        unresolvedSelectedFindings,
        auditRegressionFindings,
        iterationFixes,
        iterationSkipped,
        iterationFindings,
        latestReviewIteration,
        codexReviewText,
        maxIterations,
        reviewOptions,
      } = deriveWorkspaceLogData(logEntries);

      let lastSessionStats: SessionStats | null = null;
      let projectStats: ProjectStats | null = null;

      if (!currentSession) {
        const projectLogSessions = await deps.listProjectLogSessions(undefined, projectPath);
        const latestSession = projectLogSessions[0];
        if (latestSession) {
          lastSessionStats = await deps.computeSessionStats(latestSession);
          projectStats = await deps.computeProjectStats(
            deps.getProjectName(projectPath),
            projectLogSessions
          );
        }
      }

      logIncrementalStateRef.current = nextLogIncrementalState;
      lastLogSessionPathRef.current = nextLogSessionPath;

      setState((prev) =>
        mergeHeavyRefreshState(prev, {
          sessionGroups,
          allSessions,
          projectSessions,
          selectedSessionId,
          currentSession,
          logEntries,
          fixes,
          skipped,
          findings,
          storedFindings,
          selectedFindingIds,
          selectedFindings,
          unselectedFindings,
          fixResults,
          unresolvedSelectedFindings,
          auditRegressionFindings,
          iterationFixes,
          iterationSkipped,
          iterationFindings,
          latestReviewIteration,
          codexReviewText,
          maxIterations,
          lastSessionStats,
          projectStats,
          config: configResult.config,
          configWarning: configResult.configWarning,
          isGitRepo,
          reviewOptions,
        })
      );
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : "Unknown error",
        isLoading: false,
      }));
    } finally {
      isHeavyRefreshingRef.current = false;
    }
  }, [deps, projectPath]);

  const refreshLive = useCallback(async () => {
    if (isLiveRefreshingRef.current) return;
    isLiveRefreshingRef.current = true;

    try {
      const currentSession = await deps.getLatestProjectActiveSession(undefined, projectPath);

      let tmuxOutput = lastTmuxOutputRef.current;
      const liveMeta = getLiveRefreshMeta(currentSession);
      const sessionName = liveMeta.sessionName;
      const now = Date.now();
      const liveMetaChanged = hasLiveMetaChanged(lastLiveMetaRef.current, liveMeta);

      if (!sessionName) {
        tmuxOutput = "";
        lastTmuxOutputRef.current = "";
        lastTmuxSessionRef.current = null;
        lastTmuxCaptureRef.current = 0;
        tmuxCaptureIntervalRef.current = deps.tmuxCaptureMinIntervalMs;
      } else {
        const sessionChanged = sessionName !== lastTmuxSessionRef.current;
        const shouldCapture = deps.shouldCaptureTmux({
          sessionChanged,
          liveMetaChanged,
          now,
          lastCaptureAt: lastTmuxCaptureRef.current,
          currentIntervalMs: tmuxCaptureIntervalRef.current,
        });

        if (shouldCapture) {
          const capturedOutput = await deps.getSessionOutput(sessionName, 1000);
          const nextOutput = capturedOutput || (sessionChanged ? "" : lastTmuxOutputRef.current);
          const outputChanged = nextOutput !== lastTmuxOutputRef.current;
          tmuxOutput = nextOutput;
          lastTmuxOutputRef.current = tmuxOutput;
          lastTmuxSessionRef.current = sessionName;
          lastTmuxCaptureRef.current = now;
          tmuxCaptureIntervalRef.current = deps.computeNextTmuxCaptureInterval({
            sessionChanged,
            liveMetaChanged,
            outputChanged,
            previousIntervalMs: tmuxCaptureIntervalRef.current,
          });
        }
      }

      const elapsed = currentSession ? Date.now() - currentSession.startTime : 0;
      lastLiveMetaRef.current = liveMeta;

      setState((prev) => ({
        ...prev,
        currentSession,
        currentAgent: liveMeta.currentAgent,
        tmuxOutput,
        elapsed,
        liveRefreshError: null,
        isLoading: false,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        liveRefreshError: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      isLiveRefreshingRef.current = false;
    }
  }, [deps, projectPath]);

  useEffect(() => {
    void refreshHeavy();
  }, [refreshHeavy]);

  useEffect(() => {
    const interval = setInterval(refreshHeavy, refreshInterval);
    return () => clearInterval(interval);
  }, [refreshHeavy, refreshInterval]);

  useEffect(() => {
    void refreshLive();
  }, [refreshLive]);

  useEffect(() => {
    const interval = setInterval(refreshLive, deps.tmuxCaptureMinIntervalMs);
    return () => clearInterval(interval);
  }, [deps.tmuxCaptureMinIntervalMs, refreshLive]);

  return state;
}
