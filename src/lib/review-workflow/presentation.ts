import type { Finding } from "@/lib/types";
import type {
  BatchFixEntry,
  DiscoveryIterationEntry,
  FinalAuditEntry,
  FindingSelectionEntry,
  LogEntry,
} from "@/lib/types/log";
import type { AuditSummary, FindingFixResult, FindingId, StoredFinding } from "./findings/types";

interface WorkflowFixResultDisplay extends FindingFixResult {
  finding?: StoredFinding;
}

export interface WorkflowPresentationData {
  hasBatchFirstLifecycle: boolean;
  discoveryEntries: DiscoveryIterationEntry[];
  selectionEntry?: FindingSelectionEntry;
  batchFixEntry?: BatchFixEntry;
  finalAuditEntry?: FinalAuditEntry;
  storedFindings: StoredFinding[];
  findingsById: Map<FindingId, StoredFinding>;
  selectedFindingIds: FindingId[];
  selectedFindings: StoredFinding[];
  unselectedFindings: StoredFinding[];
  fixResults: WorkflowFixResultDisplay[];
  unresolvedSelectedFindingIds: FindingId[];
  unresolvedSelectedFindings: StoredFinding[];
  regressionFindings: StoredFinding[];
  latestAudit?: AuditSummary;
}

function priorityToNumber(priority: StoredFinding["priority"]): number {
  return Number.parseInt(priority.slice(1), 10);
}

function createFindingMap(findings: StoredFinding[]): Map<FindingId, StoredFinding> {
  return new Map(findings.map((finding) => [finding.id, finding]));
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
  const discoveryEntries: DiscoveryIterationEntry[] = [];
  let selectionEntry: FindingSelectionEntry | undefined;
  let batchFixEntry: BatchFixEntry | undefined;
  let finalAuditEntry: FinalAuditEntry | undefined;

  for (const entry of entries) {
    if (entry.type === "discovery_iteration") {
      discoveryEntries.push(entry);
      continue;
    }

    if (entry.type === "finding_selection") {
      selectionEntry = entry;
      continue;
    }

    if (entry.type === "batch_fix") {
      batchFixEntry = entry;
      continue;
    }

    if (entry.type === "final_audit") {
      finalAuditEntry = entry;
    }
  }

  const storedFindings = discoveryEntries.at(-1)?.findings ?? [];
  const regressionFindings = finalAuditEntry?.summary.regressionFindings ?? [];
  const findingsById = createFindingMap([...storedFindings, ...regressionFindings]);
  const selectedFindingIds =
    selectionEntry?.selectedFindingIds ??
    batchFixEntry?.selectedFindingIds ??
    finalAuditEntry?.selectedFindingIds ??
    [];
  const selectedFindings = selectedFindingIds
    .map((findingId) => findingsById.get(findingId))
    .filter((finding): finding is StoredFinding => finding !== undefined);
  const fixResults = (batchFixEntry?.fixResults ?? []).map((result) => ({
    ...result,
    finding: findingsById.get(result.findingId),
  }));
  const unresolvedSelectedFindingIds = finalAuditEntry?.summary.unresolvedFindingIds ?? [];
  const unresolvedSelectedFindings = unresolvedSelectedFindingIds
    .map((findingId) => findingsById.get(findingId))
    .filter((finding): finding is StoredFinding => finding !== undefined);
  const selectedIdSet = new Set(selectedFindingIds);
  const unselectedFindings = storedFindings.filter((finding) => !selectedIdSet.has(finding.id));

  return {
    hasBatchFirstLifecycle:
      discoveryEntries.length > 0 ||
      selectionEntry !== undefined ||
      batchFixEntry !== undefined ||
      finalAuditEntry !== undefined,
    discoveryEntries,
    selectionEntry,
    batchFixEntry,
    finalAuditEntry,
    storedFindings,
    findingsById,
    selectedFindingIds,
    selectedFindings,
    unselectedFindings,
    fixResults,
    unresolvedSelectedFindingIds,
    unresolvedSelectedFindings,
    regressionFindings,
    latestAudit: finalAuditEntry?.summary,
  };
}
