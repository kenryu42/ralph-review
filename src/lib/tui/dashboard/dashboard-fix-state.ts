import type { StoredFinding } from "@/lib/review-workflow/findings/types";
import type { SessionStats, SystemEntry } from "@/lib/types";

export interface PendingFixTarget {
  sessionId: string;
  projectPath: string;
  findings: StoredFinding[];
  commandScope: "artifact" | "visible";
}

function getSystemEntry(stats: SessionStats): SystemEntry | undefined {
  return stats.entries.find((entry): entry is SystemEntry => entry.type === "system");
}

function hasRetryableFindings(stats: SessionStats): boolean {
  return stats.reviewOutcome === "findings-pending" || stats.status === "failed";
}

function mergeRemainingFindings(
  storedFindings: StoredFinding[],
  remainingGroups: StoredFinding[][]
): StoredFinding[] {
  const remainingIds = new Set(remainingGroups.flat().map((finding) => finding.id));
  return storedFindings.filter((finding) => remainingIds.has(finding.id));
}

export function getPendingFixTarget(
  lastSessionStats: SessionStats | null,
  storedFindings: StoredFinding[],
  unselectedFindings: StoredFinding[] = [],
  unresolvedSelectedFindings: StoredFinding[] = []
): PendingFixTarget | null {
  if (!lastSessionStats) {
    return null;
  }

  let findings: StoredFinding[] = [];
  let commandScope: PendingFixTarget["commandScope"] = "artifact";

  if (lastSessionStats.reviewOutcome === "findings-pending") {
    findings = storedFindings;
  } else if (lastSessionStats.reviewOutcome === "fixed-selected") {
    findings = mergeRemainingFindings(storedFindings, [unselectedFindings]);
    commandScope = "visible";
  } else if (lastSessionStats.reviewOutcome === "incomplete") {
    findings = mergeRemainingFindings(storedFindings, [
      unresolvedSelectedFindings,
      unselectedFindings,
    ]);
    commandScope = "visible";
    if (findings.length === 0 && lastSessionStats.status === "failed") {
      findings = storedFindings;
      commandScope = "artifact";
    }
  } else if (hasRetryableFindings(lastSessionStats)) {
    findings = storedFindings;
  } else {
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
    commandScope,
  };
}
