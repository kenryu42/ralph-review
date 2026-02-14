import { useCallback, useEffect, useRef, useState } from "react";
import { loadConfig } from "@/lib/config";
import { ensureGitRepositoryAsync } from "@/lib/git";
import type { LockData } from "@/lib/lockfile";
import { listAllActiveSessions, readLockfile } from "@/lib/lockfile";
import type { LogIncrementalResult, LogIncrementalState } from "@/lib/logger";
import {
  computeProjectStats,
  computeSessionStats,
  getLatestProjectLogSession,
  getProjectName,
  listProjectLogSessions,
  readLogIncremental,
} from "@/lib/logger";
import {
  computeNextTmuxCaptureInterval,
  getSessionOutput,
  shouldCaptureTmux,
  TMUX_CAPTURE_MIN_INTERVAL_MS,
} from "@/lib/tmux";
import type {
  AgentRole,
  Finding,
  FixEntry,
  IterationEntry,
  LogEntry,
  ProjectStats,
  ReviewOptions,
  SessionStats,
  SkippedEntry,
  SystemEntry,
} from "@/lib/types";
import type { DashboardState } from "./types";

const DEFAULT_REFRESH_INTERVAL = 1000;
const LIVE_REFRESH_INTERVAL = TMUX_CAPTURE_MIN_INTERVAL_MS;

export function getCurrentAgentFromLockData(lockData: LockData | null): AgentRole | null {
  return lockData?.currentAgent ?? null;
}

interface LiveRefreshMeta {
  sessionName: string | null;
  state: LockData["state"] | null;
  iteration: number | null;
  currentAgent: AgentRole | null;
}

export function getLiveRefreshMeta(lockData: LockData | null): LiveRefreshMeta {
  return {
    sessionName: lockData?.sessionName ?? null,
    state: lockData?.state ?? null,
    iteration: lockData?.iteration ?? null,
    currentAgent: getCurrentAgentFromLockData(lockData),
  };
}

export function hasLiveMetaChanged(
  previous: LiveRefreshMeta | null,
  next: LiveRefreshMeta
): boolean {
  if (!previous) {
    return false;
  }

  return (
    previous.sessionName !== next.sessionName ||
    previous.state !== next.state ||
    previous.iteration !== next.iteration ||
    previous.currentAgent !== next.currentAgent
  );
}

export function mergeIncrementalLogEntries(
  previousEntries: LogEntry[],
  incrementalResult: LogIncrementalResult
): LogEntry[] {
  if (incrementalResult.mode === "reset") {
    return incrementalResult.entries;
  }

  if (incrementalResult.mode === "incremental") {
    return [...previousEntries, ...incrementalResult.entries];
  }

  return previousEntries;
}

interface LatestReviewSelection {
  iterationFindings: Finding[];
  codexReviewText: string | null;
  latestReviewIteration: number | null;
}

export function selectLatestReviewFromEntries(logEntries: LogEntry[]): LatestReviewSelection {
  let latestReviewTimestamp = 0;
  let iterationFindings: Finding[] = [];
  let codexReviewText: string | null = null;
  let latestReviewIteration: number | null = null;

  for (const entry of logEntries) {
    if (entry.type !== "iteration") {
      continue;
    }

    const iterEntry = entry as IterationEntry;
    const timestamp = iterEntry.timestamp ?? 0;
    const hasReview = Boolean(iterEntry.review) || Boolean(iterEntry.codexReview?.text);

    if (hasReview && timestamp >= latestReviewTimestamp) {
      latestReviewTimestamp = timestamp;
      iterationFindings = iterEntry.review?.findings ?? [];
      codexReviewText = iterEntry.codexReview?.text ?? null;
      latestReviewIteration = iterEntry.iteration;
    }
  }

  return {
    iterationFindings,
    codexReviewText,
    latestReviewIteration,
  };
}

interface HeavyRefreshUpdate {
  sessions: DashboardState["sessions"];
  logEntries: DashboardState["logEntries"];
  fixes: DashboardState["fixes"];
  skipped: DashboardState["skipped"];
  findings: DashboardState["findings"];
  iterationFixes: DashboardState["iterationFixes"];
  iterationSkipped: DashboardState["iterationSkipped"];
  iterationFindings: DashboardState["iterationFindings"];
  latestReviewIteration: DashboardState["latestReviewIteration"];
  codexReviewText: DashboardState["codexReviewText"];
  maxIterations: DashboardState["maxIterations"];
  lastSessionStats: DashboardState["lastSessionStats"];
  projectStats: DashboardState["projectStats"];
  config: DashboardState["config"];
  isGitRepo: DashboardState["isGitRepo"];
  reviewOptions: DashboardState["reviewOptions"];
}

export function mergeHeavyDashboardState(
  prev: DashboardState,
  update: HeavyRefreshUpdate
): DashboardState {
  return {
    ...prev,
    sessions: update.sessions,
    logEntries: update.logEntries,
    fixes: update.fixes,
    skipped: update.skipped,
    findings: update.findings,
    iterationFixes: update.iterationFixes,
    iterationSkipped: update.iterationSkipped,
    iterationFindings: update.iterationFindings,
    latestReviewIteration: update.latestReviewIteration,
    codexReviewText: update.codexReviewText,
    maxIterations: update.maxIterations,
    lastSessionStats: update.lastSessionStats,
    projectStats: update.projectStats,
    config: update.config,
    isGitRepo: update.isGitRepo,
    reviewOptions: update.reviewOptions,
    error: null,
    isLoading: false,
  };
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
      const [isGitRepo, sessions, lockData, logSession, config] = await Promise.all([
        ensureGitRepositoryAsync(projectPath),
        listAllActiveSessions(),
        readLockfile(undefined, projectPath),
        getLatestProjectLogSession(undefined, projectPath),
        loadConfig().catch(() => null),
      ]);

      let logEntries = stateRef.current.logEntries;
      let nextLogIncrementalState = logIncrementalStateRef.current;
      let nextLogSessionPath = lastLogSessionPathRef.current;
      if (logSession) {
        const logSessionChanged = logSession.path !== lastLogSessionPathRef.current;

        const incrementalResult = await readLogIncremental(
          logSession.path,
          logSessionChanged ? undefined : logIncrementalStateRef.current
        );
        nextLogIncrementalState = incrementalResult.state;
        nextLogSessionPath = logSession.path;
        logEntries = mergeIncrementalLogEntries(stateRef.current.logEntries, incrementalResult);
      } else {
        nextLogIncrementalState = undefined;
        nextLogSessionPath = null;
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
          const systemEntry = entry as SystemEntry;
          maxIterations = systemEntry.maxIterations;
          reviewOptions = systemEntry.reviewOptions;
        } else if (entry.type === "iteration") {
          const iterEntry = entry as IterationEntry;

          const timestamp = iterEntry.timestamp ?? 0;

          if (iterEntry.fixes) {
            fixes.push(...iterEntry.fixes.fixes);
            skipped.push(...iterEntry.fixes.skipped);

            if (timestamp >= latestFixesTimestamp) {
              latestFixesTimestamp = timestamp;
              iterationFixes = iterEntry.fixes.fixes;
              iterationSkipped = iterEntry.fixes.skipped;
            }
          }
        }
      }

      findings = iterationFindings;

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

      logIncrementalStateRef.current = nextLogIncrementalState;
      lastLogSessionPathRef.current = nextLogSessionPath;

      setState((prev: DashboardState) =>
        mergeHeavyDashboardState(prev, {
          sessions,
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
      setState((prev: DashboardState) => ({
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
      const lockData = await readLockfile(undefined, projectPath);

      let tmuxOutput = lastTmuxOutputRef.current;
      const liveMeta = getLiveRefreshMeta(lockData);
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

      const elapsed = lockData ? Date.now() - lockData.startTime : 0;
      lastLiveMetaRef.current = liveMeta;

      setState((prev: DashboardState) => ({
        ...prev,
        currentSession: lockData,
        currentAgent: liveMeta.currentAgent,
        tmuxOutput,
        elapsed,
        isLoading: false,
      }));
    } catch {
      // Ignore transient live refresh failures; heavy refresh owns user-facing errors.
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
