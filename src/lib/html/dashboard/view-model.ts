import { getPriorityRank } from "@/lib/html/priority";
import type {
  DashboardData,
  FixEntry,
  LogEntry,
  SessionStats,
  SkippedEntry,
  SystemEntry,
} from "@/lib/types";

interface SessionBadgeViewModel {
  label: string;
  className: string;
}

interface FixViewModel {
  priority: FixEntry["priority"];
  title: string;
  file: string;
}

interface SkippedViewModel {
  priority: SkippedEntry["priority"];
  title: string;
  reason: string;
}

export interface SessionViewModel {
  badge: SessionBadgeViewModel;
  prioritiesText: string;
  sortedFixes: FixViewModel[];
  sortedSkipped: SkippedViewModel[];
  codeSimplified: boolean;
  reviewerDisplay: string;
  fixerDisplay: string;
}

export interface DashboardViewModel {
  sessionsByPath: Record<string, SessionViewModel>;
}

const NUMBER_FORMAT = new Intl.NumberFormat();

function formatFixesLabel(totalFixes: number): string {
  if (totalFixes === 0) return "No Issues";
  return `${NUMBER_FORMAT.format(totalFixes)} fixes`;
}

function getSessionBadge(session: SessionStats): SessionBadgeViewModel {
  if (session.status !== "completed") {
    return {
      label: session.status,
      className: `status-${session.status}`,
    };
  }

  if (session.totalFixes === 0 && session.totalSkipped > 0) {
    return {
      label: `${NUMBER_FORMAT.format(session.totalSkipped)} skipped`,
      className: "status-has-skipped",
    };
  }

  if (session.totalFixes > 0) {
    return {
      label: formatFixesLabel(session.totalFixes),
      className: "status-has-fixes",
    };
  }

  return {
    label: "No Issues",
    className: "status-no-issues",
  };
}

function extractFixes(entries: LogEntry[]): { fixes: FixEntry[]; skipped: SkippedEntry[] } {
  const fixes: FixEntry[] = [];
  const skipped: SkippedEntry[] = [];
  for (const entry of entries) {
    if (entry.type !== "iteration" || !entry.fixes) continue;
    fixes.push(...entry.fixes.fixes);
    skipped.push(...entry.fixes.skipped);
  }
  return { fixes, skipped };
}

function getSessionSystemEntry(session: SessionStats): SystemEntry | undefined {
  return session.entries.find((entry): entry is SystemEntry => entry.type === "system");
}

function isCodeSimplified(systemEntry: SystemEntry | undefined): boolean {
  return Boolean(systemEntry?.codeSimplifier || systemEntry?.reviewOptions?.simplifier);
}

function formatRoleDisplay(name: string, model: string, reasoning: string): string {
  const details = [model, reasoning].filter(Boolean);
  if (details.length === 0) return name;
  return `${name} (${details.join(", ")})`;
}

function buildSessionViewModel(session: SessionStats): SessionViewModel {
  const { fixes, skipped } = extractFixes(session.entries ?? []);
  const priorities = new Set(fixes.map((fix) => fix.priority));
  const sortedFixes = [...fixes]
    .sort((a, b) => getPriorityRank(a.priority) - getPriorityRank(b.priority))
    .map((fix) => ({
      priority: fix.priority,
      title: fix.title,
      file: fix.file ?? "",
    }));

  const sortedSkipped = [...skipped]
    .sort((a, b) => getPriorityRank(a.priority) - getPriorityRank(b.priority))
    .map((item) => ({
      priority: item.priority,
      title: item.title,
      reason: item.reason,
    }));

  const reviewerName = session.reviewerDisplayName || session.reviewer || "unknown";
  const reviewerModel = session.reviewerModelDisplayName || session.reviewerModel || "";
  const reviewerReasoning = session.reviewerReasoning || "";
  const fixerName = session.fixerDisplayName || session.fixer || "unknown";
  const fixerModel = session.fixerModelDisplayName || session.fixerModel || "";
  const fixerReasoning = session.fixerReasoning || "";

  return {
    badge: getSessionBadge(session),
    prioritiesText: Array.from(priorities).join(" "),
    sortedFixes,
    sortedSkipped,
    codeSimplified: isCodeSimplified(getSessionSystemEntry(session)),
    reviewerDisplay: formatRoleDisplay(reviewerName, reviewerModel, reviewerReasoning),
    fixerDisplay: formatRoleDisplay(fixerName, fixerModel, fixerReasoning),
  };
}

export function buildDashboardViewModel(data: DashboardData): DashboardViewModel {
  const sessionsByPath: Record<string, SessionViewModel> = {};

  for (const project of data.projects) {
    for (const session of project.sessions) {
      sessionsByPath[session.sessionPath] = buildSessionViewModel(session);
    }
  }

  return { sessionsByPath };
}
