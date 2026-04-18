import { getPriorityRank } from "@/lib/html/priority";
import { deriveWorkflowPresentationData } from "@/lib/review-workflow/presentation";
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
  codeLocation?: {
    absoluteFilePath: string;
    lineStart: number;
    lineEnd: number;
  };
}

interface SkippedViewModel {
  priority: SkippedEntry["priority"];
  title: string;
  reason: string;
}

interface WorkflowFindingViewModel {
  id: string;
  priority: string;
  title: string;
  filePath: string;
  startLine: number;
  endLine: number;
}

interface WorkflowFixResultViewModel {
  findingId: string;
  status: string;
  summary: string;
  title: string;
  priority?: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
}

interface WorkflowSessionViewModel {
  hasBatchFirstLifecycle: boolean;
  findings: WorkflowFindingViewModel[];
  selectedFindings: WorkflowFindingViewModel[];
  fixResults: WorkflowFixResultViewModel[];
  unresolvedSelectedFindings: WorkflowFindingViewModel[];
  regressionFindings: WorkflowFindingViewModel[];
}

export interface SessionViewModel {
  badge: SessionBadgeViewModel;
  prioritiesText: string;
  sortedFixes: FixViewModel[];
  sortedSkipped: SkippedViewModel[];
  codeSimplified: boolean;
  reviewerDisplay: string;
  fixerDisplay: string;
  workflow: WorkflowSessionViewModel;
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

  if (session.reviewOutcome === "findings-pending") {
    return {
      label: "Pending findings",
      className: "status-pending-findings",
    };
  }

  if (session.reviewOutcome === "fixed-selected") {
    return {
      label: "Fixed selected",
      className: "status-has-fixes",
    };
  }

  if (session.reviewOutcome === "clean") {
    return {
      label: "Clean",
      className: "status-no-issues",
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

function isCodeSimplified(_systemEntry: SystemEntry | undefined): boolean {
  return false;
}

function formatRoleDisplay(name: string, model: string, reasoning: string): string {
  const details = [model, reasoning].filter(Boolean);
  if (details.length === 0) return name;
  return `${name} (${details.join(", ")})`;
}

function toCodeLocationViewModel(fix: FixEntry): FixViewModel["codeLocation"] {
  const location = fix.code_location;
  if (!location) {
    return undefined;
  }

  const lineStart = location.line_range?.start;
  const lineEnd = location.line_range?.end;
  if (
    typeof location.absolute_file_path !== "string" ||
    !Number.isInteger(lineStart) ||
    !Number.isInteger(lineEnd) ||
    lineStart < 1 ||
    lineEnd < lineStart
  ) {
    return undefined;
  }

  return {
    absoluteFilePath: location.absolute_file_path,
    lineStart,
    lineEnd,
  };
}

function toWorkflowFindingViewModel(
  finding: ReturnType<typeof deriveWorkflowPresentationData>["storedFindings"][number]
): WorkflowFindingViewModel {
  return {
    id: finding.id,
    priority: finding.priority,
    title: finding.title,
    filePath: finding.filePath,
    startLine: finding.startLine,
    endLine: finding.endLine,
  };
}

function buildSessionViewModel(session: SessionStats): SessionViewModel {
  const workflow = deriveWorkflowPresentationData(session.entries ?? []);
  const { fixes, skipped } = extractFixes(session.entries ?? []);
  const priorities = new Set(
    workflow.hasBatchFirstLifecycle
      ? workflow.storedFindings.map((finding) => finding.priority)
      : fixes.map((fix) => fix.priority)
  );
  const sortedFixes = [...fixes]
    .sort((a, b) => getPriorityRank(a.priority) - getPriorityRank(b.priority))
    .map((fix) => {
      const codeLocation = toCodeLocationViewModel(fix);
      return {
        priority: fix.priority,
        title: fix.title,
        file: fix.file ?? "",
        ...(codeLocation ? { codeLocation } : {}),
      };
    });

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
    workflow: {
      hasBatchFirstLifecycle: workflow.hasBatchFirstLifecycle,
      findings: workflow.storedFindings.map(toWorkflowFindingViewModel),
      selectedFindings: workflow.selectedFindings.map(toWorkflowFindingViewModel),
      fixResults: workflow.fixResults.map((result) => ({
        findingId: result.findingId,
        status: result.status,
        summary: result.summary,
        title: result.finding?.title ?? result.findingId,
        priority: result.finding?.priority,
        filePath: result.finding?.filePath,
        startLine: result.finding?.startLine,
        endLine: result.finding?.endLine,
      })),
      unresolvedSelectedFindings: workflow.unresolvedSelectedFindings.map(
        toWorkflowFindingViewModel
      ),
      regressionFindings: workflow.regressionFindings.map(toWorkflowFindingViewModel),
    },
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
