import { describe, expect, test } from "bun:test";
import type { FinalAuditPhaseResult } from "@/lib/review-workflow/audit/types";
import type { DiscoveryIterationResult } from "@/lib/review-workflow/discovery/types";
import type { FindingSelectionMode } from "@/lib/review-workflow/findings/selection";
import type {
  BatchFixResult,
  FinalAuditResult,
  RemediationSelection,
} from "@/lib/review-workflow/remediation/types";
import type { WorkflowSessionState } from "@/lib/review-workflow/shared/types";
import type { ReviewOutcome } from "@/lib/types";

describe("review workflow local types", () => {
  test("supports discovery/remediation/audit workflow-local contracts", () => {
    const discovery: DiscoveryIterationResult = {
      phase: "discovery",
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

    const finalAudit: FinalAuditResult = {
      phase: "final-audit",
      sessionStatus: "completed",
      latestAudit: {
        resolvedFindingIds: [],
        unresolvedFindingIds: [],
        regressionFindings: [],
      },
    };

    const finalAuditPhase: FinalAuditPhaseResult = {
      phase: "final-audit",
      sessionStatus: "completed",
      summary: finalAudit.latestAudit,
    };

    const mode: FindingSelectionMode = "all";
    const outcome: ReviewOutcome = "findings-pending";

    const workflowState: WorkflowSessionState = {
      currentPhase: "selection",
      sessionStatus: "pending-user",
      reviewOutcome: outcome,
    };

    expect(discovery.phase).toBe("discovery");
    expect(selection.selectedFindingIds).toEqual([]);
    expect(batchFix.phase).toBe("batch-fix");
    expect(finalAuditPhase.phase).toBe("final-audit");
    expect(mode).toBe("all");
    expect(workflowState.reviewOutcome).toBe("findings-pending");
  });
});
