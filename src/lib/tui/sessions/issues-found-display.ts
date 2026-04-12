import type { Finding, ReviewSummary } from "@/lib/types";

interface ResolveIssuesFoundDisplayInput {
  sessionStatus: string | undefined;
  sessionIteration: number;
  latestReviewIteration: number | null;
  persistedFindings: Finding[];
  persistedCodexText: string | null;
  parsedCodexSummary: ReviewSummary | null;
  liveReviewSummary: ReviewSummary | null;
  cachedLiveReviewSummary: ReviewSummary | null;
  sessionStateReviewSummary: ReviewSummary | null;
}

interface IssuesFoundDisplay {
  findings: Finding[];
  codexText: string | null;
}

export function resolveIssuesFoundDisplay({
  sessionStatus,
  sessionIteration,
  latestReviewIteration,
  persistedFindings,
  persistedCodexText,
  parsedCodexSummary,
  liveReviewSummary,
  cachedLiveReviewSummary,
  sessionStateReviewSummary,
}: ResolveIssuesFoundDisplayInput): IssuesFoundDisplay {
  const activeLiveSummary = liveReviewSummary ?? cachedLiveReviewSummary;
  if (activeLiveSummary) {
    return {
      findings: activeLiveSummary.findings,
      codexText: null,
    };
  }

  const hasCurrentIterationPersistedReview = latestReviewIteration === sessionIteration;
  const isRunning = sessionStatus === "running";

  if (hasCurrentIterationPersistedReview && persistedFindings.length > 0) {
    return {
      findings: persistedFindings,
      codexText: null,
    };
  }

  if (sessionStateReviewSummary) {
    return {
      findings: sessionStateReviewSummary.findings,
      codexText: null,
    };
  }

  if (isRunning && !hasCurrentIterationPersistedReview) {
    return {
      findings: [],
      codexText: null,
    };
  }

  if (persistedFindings.length > 0) {
    return {
      findings: persistedFindings,
      codexText: null,
    };
  }

  if (parsedCodexSummary && parsedCodexSummary.findings.length > 0) {
    return {
      findings: parsedCodexSummary.findings,
      codexText: null,
    };
  }

  return {
    findings: persistedFindings,
    codexText: persistedCodexText,
  };
}
