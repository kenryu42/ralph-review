import {
  deriveWorkflowPresentationData,
  storedFindingToFinding,
} from "@/lib/review-workflow/presentation";
import type { Config, Finding, FixEntry, LogEntry, ReviewOptions, SkippedEntry } from "@/lib/types";
import { selectLatestReviewFromEntries } from "./workspace-refresh-utils";

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface WorkspaceLogData {
  fixes: FixEntry[];
  skipped: SkippedEntry[];
  findings: Finding[];
  storedFindings: ReturnType<typeof deriveWorkflowPresentationData>["storedFindings"];
  selectedFindingIds: ReturnType<typeof deriveWorkflowPresentationData>["selectedFindingIds"];
  selectedFindings: ReturnType<typeof deriveWorkflowPresentationData>["selectedFindings"];
  fixResults: ReturnType<typeof deriveWorkflowPresentationData>["fixResults"];
  unresolvedSelectedFindings: ReturnType<
    typeof deriveWorkflowPresentationData
  >["unresolvedSelectedFindings"];
  auditRegressionFindings: ReturnType<typeof deriveWorkflowPresentationData>["regressionFindings"];
  iterationFixes: FixEntry[];
  iterationSkipped: SkippedEntry[];
  iterationFindings: Finding[];
  latestReviewIteration: number | null;
  codexReviewText: string | null;
  maxIterations: number;
  reviewOptions: ReviewOptions | undefined;
}

export function deriveWorkspaceLogData(logEntries: LogEntry[]): WorkspaceLogData {
  const fixes: FixEntry[] = [];
  const skipped: SkippedEntry[] = [];
  let iterationFixes: FixEntry[] = [];
  let iterationSkipped: SkippedEntry[] = [];
  let latestFixesTimestamp = 0;
  let maxIterations = 0;
  let reviewOptions: ReviewOptions | undefined;
  const workflow = deriveWorkflowPresentationData(logEntries);

  const latestReview = selectLatestReviewFromEntries(logEntries);
  const iterationFindings = latestReview.iterationFindings;
  const codexReviewText = latestReview.codexReviewText;
  const latestReviewIteration = latestReview.latestReviewIteration;

  for (const entry of logEntries) {
    if (entry.type === "system") {
      maxIterations = entry.maxIterations;
      reviewOptions = entry.reviewOptions;
      continue;
    }

    if (entry.type !== "iteration") {
      continue;
    }

    const timestamp = entry.timestamp ?? 0;
    if (!entry.fixes) {
      continue;
    }

    fixes.push(...entry.fixes.fixes);
    skipped.push(...entry.fixes.skipped);
    if (timestamp >= latestFixesTimestamp) {
      latestFixesTimestamp = timestamp;
      iterationFixes = entry.fixes.fixes;
      iterationSkipped = entry.fixes.skipped;
    }
  }

  const findings = workflow.hasBatchFirstLifecycle
    ? workflow.storedFindings.map(storedFindingToFinding)
    : iterationFindings;

  return {
    fixes,
    skipped,
    findings,
    storedFindings: workflow.storedFindings,
    selectedFindingIds: workflow.selectedFindingIds,
    selectedFindings: workflow.selectedFindings,
    fixResults: workflow.fixResults,
    unresolvedSelectedFindings: workflow.unresolvedSelectedFindings,
    auditRegressionFindings: workflow.regressionFindings,
    iterationFixes,
    iterationSkipped,
    iterationFindings,
    latestReviewIteration,
    codexReviewText,
    maxIterations,
    reviewOptions,
  };
}

export interface SafeConfigLoadResult {
  config: Config | null;
  configWarning: string | null;
}

export async function loadWorkspaceConfigSafe(
  projectPath: string,
  loadConfig: (projectPath: string) => Promise<Config | null>
): Promise<SafeConfigLoadResult> {
  try {
    return {
      config: await loadConfig(projectPath),
      configWarning: null,
    };
  } catch (error) {
    return {
      config: null,
      configWarning: `Unable to load config: ${toErrorMessage(error)}`,
    };
  }
}
