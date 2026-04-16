import type { StoredFinding } from "@/lib/review-workflow/findings/types";
import type { SessionStats, SystemEntry } from "@/lib/types";

export interface PendingFixTarget {
  sessionId: string;
  projectPath: string;
  findings: StoredFinding[];
}

function getSystemEntry(stats: SessionStats): SystemEntry | undefined {
  return stats.entries.find((entry): entry is SystemEntry => entry.type === "system");
}

function hasRetryableFindings(stats: SessionStats): boolean {
  return stats.reviewOutcome === "findings-pending" || stats.status === "failed";
}

export function getPendingFixTarget(
  lastSessionStats: SessionStats | null,
  findings: StoredFinding[]
): PendingFixTarget | null {
  if (!lastSessionStats || !hasRetryableFindings(lastSessionStats)) {
    return null;
  }

  if (!lastSessionStats.sessionId || findings.length === 0) {
    return null;
  }

  const projectPath = getSystemEntry(lastSessionStats)?.projectPath;
  if (!projectPath) {
    return null;
  }

  return {
    sessionId: lastSessionStats.sessionId,
    projectPath,
    findings,
  };
}
