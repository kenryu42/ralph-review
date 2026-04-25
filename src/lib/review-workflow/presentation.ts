import type { Finding } from "@/lib/types";
import type {
  BatchFixEntry,
  FindingSelectionEntry,
  LogEntry,
  ReviewIterationEntry,
} from "@/lib/types/log";
import type { FindingFixResult, FindingId, StoredFinding } from "./findings/types";

interface WorkflowFixResultDisplay extends FindingFixResult {
  finding?: StoredFinding;
}

export interface WorkflowPresentationData {
  hasBatchFirstLifecycle: boolean;
  reviewEntries: ReviewIterationEntry[];
  selectionEntry?: FindingSelectionEntry;
  batchFixEntry?: BatchFixEntry;
  storedFindings: StoredFinding[];
  findingsById: Map<FindingId, StoredFinding>;
  selectedFindingIds: FindingId[];
  selectedFindings: StoredFinding[];
  unselectedFindings: StoredFinding[];
  fixResults: WorkflowFixResultDisplay[];
  unresolvedSelectedFindingIds: FindingId[];
  unresolvedSelectedFindings: StoredFinding[];
  regressionFindings: StoredFinding[];
}

function priorityToNumber(priority: StoredFinding["priority"]): number {
  return Number.parseInt(priority.slice(1), 10);
}

function createFindingMap(findings: StoredFinding[]): Map<FindingId, StoredFinding> {
  return new Map(findings.map((finding) => [finding.id, finding]));
}

export function collectReviewIterationFindings(
  reviewEntries: ReviewIterationEntry[]
): StoredFinding[] {
  return reviewEntries.flatMap((entry) => entry.findings);
}

export function storedFindingToFinding(finding: StoredFinding): Finding {
  return {
    title: finding.title,
    body: finding.body,
    confidence_score: finding.confidenceScore,
    priority: priorityToNumber(finding.priority),
    code_location: {
      absolute_file_path: finding.filePath,
      line_range: {
        start: finding.startLine,
        end: finding.endLine,
      },
    },
  };
}

export function deriveWorkflowPresentationData(entries: LogEntry[]): WorkflowPresentationData {
  const reviewEntries: ReviewIterationEntry[] = [];
  let selectionEntry: FindingSelectionEntry | undefined;
  let batchFixEntry: BatchFixEntry | undefined;

  for (const entry of entries) {
    if (entry.type === "review_iteration") {
      reviewEntries.push(entry);
      continue;
    }

    if (entry.type === "finding_selection") {
      selectionEntry = entry;
      continue;
    }

    if (entry.type === "batch_fix") {
      batchFixEntry = entry;
    }
  }

  const storedFindings = collectReviewIterationFindings(reviewEntries);
  const regressionFindings: StoredFinding[] = [];
  const findingsById = createFindingMap(storedFindings);
  const selectedFindingIds =
    selectionEntry?.selectedFindingIds ?? batchFixEntry?.selectedFindingIds ?? [];
  const selectedFindings = selectedFindingIds
    .map((findingId) => findingsById.get(findingId))
    .filter((finding): finding is StoredFinding => finding !== undefined);
  const fixResults = (batchFixEntry?.fixResults ?? []).map((result) => ({
    ...result,
    finding: findingsById.get(result.findingId),
  }));
  const unresolvedSelectedFindingIds = fixResults
    .filter((result) => result.status === "unresolved")
    .map((result) => result.findingId);
  const unresolvedSelectedFindings = unresolvedSelectedFindingIds
    .map((findingId) => findingsById.get(findingId))
    .filter((finding): finding is StoredFinding => finding !== undefined);
  const selectedIdSet = new Set(selectedFindingIds);
  const unselectedFindings = storedFindings.filter((finding) => !selectedIdSet.has(finding.id));

  return {
    hasBatchFirstLifecycle:
      reviewEntries.length > 0 || selectionEntry !== undefined || batchFixEntry !== undefined,
    reviewEntries,
    selectionEntry,
    batchFixEntry,
    storedFindings,
    findingsById,
    selectedFindingIds,
    selectedFindings,
    unselectedFindings,
    fixResults,
    unresolvedSelectedFindingIds,
    unresolvedSelectedFindings,
    regressionFindings,
  };
}
