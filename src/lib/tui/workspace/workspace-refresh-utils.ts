import type { LogIncrementalResult } from "@/lib/logger";
import type { SessionState } from "@/lib/session-state";
import type { AgentRole, Finding, LogEntry } from "@/lib/types";

export function getCurrentAgentFromSessionState(
  sessionState: SessionState | null
): AgentRole | null {
  return sessionState?.currentAgent ?? null;
}

export interface LiveRefreshMeta {
  sessionName: string | null;
  state: SessionState["state"] | null;
  iteration: number | null;
  currentAgent: AgentRole | null;
}

export function getLiveRefreshMeta(sessionState: SessionState | null): LiveRefreshMeta {
  return {
    sessionName: sessionState?.sessionName ?? null,
    state: sessionState?.state ?? null,
    iteration: sessionState?.iteration ?? null,
    currentAgent: getCurrentAgentFromSessionState(sessionState),
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
    if (entry.type === "iteration") {
      const timestamp = entry.timestamp ?? 0;
      const hasReview = Boolean(entry.review) || Boolean(entry.codexReview?.text);

      if (hasReview && timestamp >= latestReviewTimestamp) {
        latestReviewTimestamp = timestamp;
        iterationFindings = entry.review?.findings ?? [];
        codexReviewText = entry.codexReview?.text ?? null;
        latestReviewIteration = entry.iteration;
      }
      continue;
    }

    if (entry.type === "session_end") {
      const timestamp = entry.timestamp ?? 0;
      if (entry.terminalReview && timestamp >= latestReviewTimestamp) {
        latestReviewTimestamp = timestamp;
        iterationFindings = entry.terminalReview.findings;
        codexReviewText = null;
        latestReviewIteration = null;
      }
    }
  }

  return {
    iterationFindings,
    codexReviewText,
    latestReviewIteration,
  };
}

interface HeavyRefreshMergeableState {
  error: string | null;
  isLoading: boolean;
}

export function mergeHeavyRefreshState<T extends HeavyRefreshMergeableState>(
  previous: T,
  update: Partial<Omit<T, "error" | "isLoading">>
): T {
  return {
    ...previous,
    ...update,
    error: null,
    isLoading: false,
  };
}
