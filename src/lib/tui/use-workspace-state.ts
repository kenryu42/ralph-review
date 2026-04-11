import { basename } from "node:path";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadEffectiveConfig } from "@/lib/config";
import { ensureGitRepositoryAsync } from "@/lib/git";
import type { LogIncrementalState } from "@/lib/logger";
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
import type {
  AgentRole,
  Config,
  Finding,
  FixEntry,
  LogEntry,
  ProjectStats,
  ReviewOptions,
  SessionStats,
  SkippedEntry,
} from "@/lib/types";
import type { SessionGroupData } from "./components/SessionGroup";
import {
  getLiveRefreshMeta,
  hasLiveMetaChanged,
  type LiveRefreshMeta,
  mergeHeavyRefreshState,
  mergeIncrementalLogEntries,
  selectLatestReviewFromEntries,
} from "./workspace-refresh-utils";

const DEFAULT_REFRESH_INTERVAL = 1000;
const LIVE_REFRESH_INTERVAL = TMUX_CAPTURE_MIN_INTERVAL_MS;

export interface WorkspaceState {
  sessionGroups: SessionGroupData[];
  allSessions: ActiveSession[];
  projectSessions: ActiveSession[];
  selectedSessionId: string | null;
  currentSession: SessionState | null;
  logEntries: LogEntry[];
  fixes: FixEntry[];
  skipped: SkippedEntry[];
  findings: Finding[];
  iterationFixes: FixEntry[];
  iterationSkipped: SkippedEntry[];
  iterationFindings: Finding[];
  latestReviewIteration: number | null;
  codexReviewText: string | null;
  tmuxOutput: string;
  elapsed: number;
  maxIterations: number;
  error: string | null;
  liveRefreshError: string | null;
  isLoading: boolean;
  lastSessionStats: SessionStats | null;
  projectStats: ProjectStats | null;
  config: Config | null;
  isGitRepo: boolean;
  currentAgent: AgentRole | null;
  reviewOptions: ReviewOptions | undefined;
  outputVisible: boolean;
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
  refreshInterval: number = DEFAULT_REFRESH_INTERVAL
): WorkspaceState {
  const [state, setState] = useState<WorkspaceState>({
    sessionGroups: [],
    allSessions: [],
    projectSessions: [],
    selectedSessionId: null,
    currentSession: null,
    logEntries: [],
    fixes: [],
    skipped: [],
    findings: [],
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
    isGitRepo: true,
    currentAgent: null,
    reviewOptions: undefined,
    outputVisible: false,
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const isHeavyRefreshingRef = useRef(false);
  const isLiveRefreshingRef = useRef(false);
  const lastTmuxCaptureRef = useRef(0);
  const lastTmuxOutputRef = useRef("");
  const lastTmuxSessionRef = useRef<string | null>(null);
  const tmuxCaptureIntervalRef = useRef(TMUX_CAPTURE_MIN_INTERVAL_MS);
  const lastLiveMetaRef = useRef<LiveRefreshMeta | null>(null);
  const logIncrementalStateRef = useRef<LogIncrementalState | undefined>(undefined);
  const lastLogSessionPathRef = useRef<string | null>(null);

  const refreshHeavy = useCallback(async () => {
    if (isHeavyRefreshingRef.current) return;
    isHeavyRefreshingRef.current = true;

    try {
      const [isGitRepo, allSessions, projectSessions, currentSession, logSession, config] =
        await Promise.all([
          ensureGitRepositoryAsync(projectPath),
          listAllActiveSessions(),
          listProjectActiveSessions(undefined, projectPath),
          getLatestProjectActiveSession(undefined, projectPath),
          getLatestProjectLogSession(undefined, projectPath),
          loadEffectiveConfig(projectPath).catch(() => null),
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
        const incrementalResult = await readLogIncremental(
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

      const fixes: FixEntry[] = [];
      const skipped: SkippedEntry[] = [];
      let findings: Finding[] = [];
      let iterationFixes: FixEntry[] = [];
      let iterationSkipped: SkippedEntry[] = [];

      const latestReview = selectLatestReviewFromEntries(logEntries);
      const iterationFindings = latestReview.iterationFindings;
      const codexReviewText = latestReview.codexReviewText;
      const latestReviewIteration = latestReview.latestReviewIteration;

      let latestFixesTimestamp = 0;
      let maxIterations = 0;
      let reviewOptions: ReviewOptions | undefined;

      for (const entry of logEntries) {
        if (entry.type === "system") {
          maxIterations = entry.maxIterations;
          reviewOptions = entry.reviewOptions;
        } else if (entry.type === "iteration") {
          const timestamp = entry.timestamp ?? 0;
          if (entry.fixes) {
            fixes.push(...entry.fixes.fixes);
            skipped.push(...entry.fixes.skipped);
            if (timestamp >= latestFixesTimestamp) {
              latestFixesTimestamp = timestamp;
              iterationFixes = entry.fixes.fixes;
              iterationSkipped = entry.fixes.skipped;
            }
          }
        }
      }

      findings = iterationFindings;

      let lastSessionStats: SessionStats | null = null;
      let projectStats: ProjectStats | null = null;

      if (!currentSession) {
        const projectLogSessions = await listProjectLogSessions(undefined, projectPath);
        const latestSession = projectLogSessions[0];
        if (latestSession) {
          lastSessionStats = await computeSessionStats(latestSession);
          projectStats = await computeProjectStats(getProjectName(projectPath), projectLogSessions);
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
          iterationFixes,
          iterationSkipped,
          iterationFindings,
          latestReviewIteration,
          codexReviewText,
          maxIterations,
          lastSessionStats,
          projectStats,
          config,
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
  }, [projectPath]);

  const refreshLive = useCallback(async () => {
    if (isLiveRefreshingRef.current) return;
    isLiveRefreshingRef.current = true;

    try {
      const currentSession = await getLatestProjectActiveSession(undefined, projectPath);

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
        tmuxCaptureIntervalRef.current = TMUX_CAPTURE_MIN_INTERVAL_MS;
      } else {
        const sessionChanged = sessionName !== lastTmuxSessionRef.current;
        const shouldCapture = shouldCaptureTmux({
          sessionChanged,
          liveMetaChanged,
          now,
          lastCaptureAt: lastTmuxCaptureRef.current,
          currentIntervalMs: tmuxCaptureIntervalRef.current,
        });

        if (shouldCapture) {
          const capturedOutput = await getSessionOutput(sessionName, 1000);
          const nextOutput = capturedOutput || (sessionChanged ? "" : lastTmuxOutputRef.current);
          const outputChanged = nextOutput !== lastTmuxOutputRef.current;
          tmuxOutput = nextOutput;
          lastTmuxOutputRef.current = tmuxOutput;
          lastTmuxSessionRef.current = sessionName;
          lastTmuxCaptureRef.current = now;
          tmuxCaptureIntervalRef.current = computeNextTmuxCaptureInterval({
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
  }, [projectPath]);

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
    const interval = setInterval(refreshLive, LIVE_REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [refreshLive]);

  return state;
}
