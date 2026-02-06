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
const TMUX_REFRESH_INTERVAL = 250;
const LIVE_REFRESH_INTERVAL = 250;

export function getCurrentAgentFromLockData(lockData: LockData | null): AgentRole | null {
  return lockData?.currentAgent ?? null;
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
      if (logSession) {
        logEntries = await readLog(logSession.path);
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
          const capturedOutput = await getSessionOutput(sessionName, 1000);
          tmuxOutput = capturedOutput || (sessionChanged ? "" : lastTmuxOutputRef.current);
          lastTmuxOutputRef.current = tmuxOutput;
          lastTmuxSessionRef.current = sessionName;
          lastTmuxCaptureRef.current = now;
        }
      }

      const elapsed = lockData ? Date.now() - lockData.startTime : 0;
      const currentAgent = getCurrentAgentFromLockData(lockData);

      setState((prev: DashboardState) => ({
        ...prev,
        currentSession: lockData,
        currentAgent,
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
