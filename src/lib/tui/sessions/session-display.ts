import { storedFindingToFinding } from "@/lib/review-workflow/presentation";
import type { SessionState } from "@/lib/session-state";
import { TUI_COLORS } from "@/lib/tui/shared/colors";
import type {
  Finding,
  FixEntry,
  HandoffStatus,
  Priority,
  ReviewOutcome,
  SessionStats,
  SkippedEntry,
} from "@/lib/types";
import { parseCodexReviewText } from "@/lib/types";

export const PRIORITY_COLORS: Record<Priority, string> = {
  P0: TUI_COLORS.status.error,
  P1: TUI_COLORS.status.warning,
  P2: TUI_COLORS.status.pending,
  P3: TUI_COLORS.status.success,
};

export const UNKNOWN_PRIORITY_COLOR = TUI_COLORS.status.inactive;

export function formatPriorityBreakdown(
  counts: Record<Priority, number>
): Array<{ priority: Priority; count: number }> {
  const priorities: Priority[] = ["P0", "P1", "P2", "P3"];
  return priorities.map((priority) => ({ priority, count: counts[priority] }));
}

export function formatProjectStatsSummary(totalFixes: number, sessionCount: number): string {
  const fixWord = totalFixes === 1 ? "fix" : "fixes";
  const sessionWord = sessionCount === 1 ? "session" : "sessions";
  return `${totalFixes} ${fixWord} across ${sessionCount} ${sessionWord}`;
}

export function formatProjectNameForDisplay(projectName: string): string {
  const strippedName = projectName.replace(/-[0-9a-f]{8}$/i, "");
  return strippedName.length > 0 ? strippedName : projectName;
}

interface SessionIdentityDisplay {
  primary: string;
  details: string[];
}

export function formatSessionIdentityDisplay(
  session: Pick<SessionState, "sessionName" | "worktreeBranch">,
  activeSessionCount: number = 0
): SessionIdentityDisplay {
  const details: string[] = [];

  if (session.worktreeBranch) {
    details.push(session.worktreeBranch);
  }

  if (activeSessionCount > 1) {
    details.push(`${activeSessionCount} active sessions`);
  }

  return {
    primary: session.sessionName,
    details,
  };
}

export function formatRetainedWorktreeMergeCommand(
  worktreeBranch: string | undefined,
  mergeReady: boolean | undefined
): string | null {
  if (!worktreeBranch || mergeReady !== true) {
    return null;
  }

  return `git merge ${worktreeBranch}`;
}

export function formatRetainedWorktreeOutcome(
  reviewOutcome: ReviewOutcome | undefined,
  mergeReady: boolean | undefined
): string | null {
  if (reviewOutcome === "incomplete" && mergeReady === true) {
    return "Remaining findings may still exist";
  }

  return null;
}

export function formatHandoffSummary(
  handoffStatus: HandoffStatus | undefined,
  commitSha: string | undefined
): string | null {
  if (!handoffStatus) {
    return null;
  }

  switch (handoffStatus) {
    case "applied-auto":
      return commitSha ? `Applied to working tree · ${commitSha}` : "Applied to working tree";
    case "pending-apply":
      return commitSha ? `Pending apply · ${commitSha}` : "Pending apply";
    case "applied-manual":
      return commitSha ? `Applied manually · ${commitSha}` : "Applied manually";
    case "discarded":
      return commitSha ? `Discarded · ${commitSha}` : "Discarded";
    default:
      return null;
  }
}

export function formatHandoffCommands(
  sessionId: string | undefined,
  handoffStatus: HandoffStatus | undefined
): string[] {
  if (!sessionId || handoffStatus !== "pending-apply") {
    return [];
  }

  return [`rr apply --session ${sessionId}`, `rr discard --session ${sessionId}`];
}

export function extractFixesFromStats(stats: SessionStats): FixEntry[] {
  const fixes: FixEntry[] = [];
  for (const entry of stats.entries) {
    if (entry.type === "iteration") {
      if (entry.fixes?.fixes) {
        fixes.push(...entry.fixes.fixes);
      }
    }
  }
  return fixes;
}

function getFindingKey(finding: Finding): string {
  const location = finding.code_location;
  return [
    finding.title,
    location.absolute_file_path,
    location.line_range.start,
    location.line_range.end,
  ].join(":");
}

export function extractFindingsFromStats(stats: SessionStats): Finding[] {
  const latestReviewEntry = [...stats.entries]
    .reverse()
    .find((entry) => entry.type === "review_iteration");

  if (latestReviewEntry) {
    return latestReviewEntry.findings.map(storedFindingToFinding);
  }

  const findings: Finding[] = [];
  const seen = new Set<string>();

  for (const entry of stats.entries) {
    if (entry.type === "iteration") {
      const reviewFindings =
        entry.review?.findings ??
        parseCodexReviewText(entry.codexReview?.text ?? "")?.findings ??
        [];

      for (const finding of reviewFindings) {
        const key = getFindingKey(finding);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        findings.push(finding);
      }
      continue;
    }

    if (entry.type === "session_end" && entry.terminalReview) {
      for (const finding of entry.terminalReview.findings) {
        const key = getFindingKey(finding);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        findings.push(finding);
      }
    }
  }

  return findings;
}

export function extractSkippedFromStats(stats: SessionStats): SkippedEntry[] {
  const skipped: SkippedEntry[] = [];
  for (const entry of stats.entries) {
    if (entry.type === "iteration") {
      if (entry.fixes?.skipped) {
        skipped.push(...entry.fixes.skipped);
      }
    }
  }
  return skipped;
}

export function formatLastRunIssueSummary(
  totalFixes: number,
  totalSkipped: number,
  iterations: number
): string {
  const iterationsText = `${iterations} iteration${iterations !== 1 ? "s" : ""}`;

  if (totalFixes === 0 && totalSkipped === 0) {
    return `no issues found in ${iterationsText}`;
  }

  if (totalFixes === 0) {
    return `${totalSkipped} skipped in ${iterationsText}`;
  }

  if (totalSkipped === 0) {
    return `${totalFixes} fix${totalFixes !== 1 ? "es" : ""} in ${iterationsText}`;
  }

  return `${totalFixes} fix${totalFixes !== 1 ? "es" : ""}, ${totalSkipped} skipped in ${iterationsText}`;
}

export function hasBatchFirstSummary(
  stats: Pick<
    SessionStats,
    | "reviewOutcome"
    | "totalFindings"
    | "totalSelectedFindings"
    | "totalResolvedSelectedFindings"
    | "totalUnresolvedSelectedFindings"
  >
): boolean {
  return (
    stats.reviewOutcome === "findings-pending" ||
    stats.totalFindings !== undefined ||
    stats.totalSelectedFindings !== undefined ||
    stats.totalResolvedSelectedFindings !== undefined ||
    stats.totalUnresolvedSelectedFindings !== undefined
  );
}

export function formatBatchFirstIssueSummary(
  stats: Pick<
    SessionStats,
    | "totalFindings"
    | "totalSelectedFindings"
    | "totalResolvedSelectedFindings"
    | "totalUnresolvedSelectedFindings"
  >
): string {
  const findingsText = `${stats.totalFindings ?? 0} issues found`;
  const selectionText =
    stats.totalSelectedFindings !== undefined ? ` · ${stats.totalSelectedFindings} selected` : "";
  const remediationText =
    stats.totalResolvedSelectedFindings !== undefined ||
    stats.totalUnresolvedSelectedFindings !== undefined
      ? ` · ${stats.totalResolvedSelectedFindings ?? 0} resolved · ${stats.totalUnresolvedSelectedFindings ?? 0} unresolved`
      : "";

  return `${findingsText}${selectionText}${remediationText}`;
}

export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 1) return `${days}d ago`;
  if (days === 1) return "yesterday";
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}
