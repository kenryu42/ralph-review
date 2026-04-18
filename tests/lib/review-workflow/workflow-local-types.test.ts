import { describe, expect, test } from "bun:test";
import type { FindingSelectionMode } from "@/lib/review-workflow/findings/selection";
import type { BatchFixResult, RemediationSelection } from "@/lib/review-workflow/remediation/types";
import type { ReviewIterationResult } from "@/lib/review-workflow/review/types";
import type { WorkflowSessionState } from "@/lib/review-workflow/shared/types";
import type { ReviewOutcome } from "@/lib/types";

describe("review workflow local types", () => {
  test("supports review and remediation workflow-local contracts", () => {
    const review: ReviewIterationResult = {
      phase: "review",
      sessionStatus: "running",
      findings: [],
      netNewFindingIds: [],
    };

    const selection: RemediationSelection = {
      selectedFindingIds: [],
      selectedFindings: [],
    };

    const batchFix: BatchFixResult = {
      phase: "batch-fix",
      sessionStatus: "running",
      fixResults: [],
    };

    const mode: FindingSelectionMode = "all";
    const outcome: ReviewOutcome = "findings-pending";

    const workflowState: WorkflowSessionState = {
      currentPhase: "selection",
      sessionStatus: "pending-user",
      reviewOutcome: outcome,
    };

    expect(review.phase).toBe("review");
    expect(selection.selectedFindingIds).toEqual([]);
    expect(batchFix.phase).toBe("batch-fix");
    expect(mode).toBe("all");
    expect(workflowState.reviewOutcome).toBe("findings-pending");
  });
});
