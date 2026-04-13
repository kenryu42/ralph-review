import type { FindingId, StoredFinding } from "@/lib/review-workflow/findings/types";
import type { Priority } from "@/lib/types";

export type FindingSelectionMode = "all" | "priority" | "id";

export type FindingSelectionRequest =
  | {
      mode: "all";
    }
  | {
      mode: "priority";
      priorities: Priority[];
    }
  | {
      mode: "id";
      ids: FindingId[];
    };

export interface FindingSelectionResult {
  selectedFindings: StoredFinding[];
  selectedIds: FindingId[];
  notFoundIds: FindingId[];
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function selectFindings(
  findings: StoredFinding[],
  request: FindingSelectionRequest
): FindingSelectionResult {
  if (request.mode === "all") {
    return {
      selectedFindings: [...findings],
      selectedIds: findings.map((finding) => finding.id),
      notFoundIds: [],
    };
  }

  if (request.mode === "priority") {
    const priorities = new Set(unique(request.priorities));
    const selectedFindings = findings.filter((finding) => priorities.has(finding.priority));

    return {
      selectedFindings,
      selectedIds: selectedFindings.map((finding) => finding.id),
      notFoundIds: [],
    };
  }

  const requestedIds = unique(request.ids);
  const selectedFindings = findings.filter((finding) => requestedIds.includes(finding.id));
  const selectedIdSet = new Set(selectedFindings.map((finding) => finding.id));
  const notFoundIds = requestedIds.filter((findingId) => !selectedIdSet.has(findingId));

  return {
    selectedFindings,
    selectedIds: selectedFindings.map((finding) => finding.id),
    notFoundIds,
  };
}
