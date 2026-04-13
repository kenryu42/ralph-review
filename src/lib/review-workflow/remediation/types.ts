import type {
  AuditSummary,
  FindingFixResult,
  FindingId,
  StoredFinding,
} from "@/lib/review-workflow/findings/types";
import type { ReviewPhase, SessionStatus } from "@/lib/types";

export interface RemediationSelection {
  selectedFindingIds: FindingId[];
  selectedFindings: StoredFinding[];
}

export interface BatchFixResult {
  phase: Extract<ReviewPhase, "batch-fix">;
  sessionStatus: SessionStatus;
  fixResults: FindingFixResult[];
}

export interface FinalAuditResult {
  phase: Extract<ReviewPhase, "final-audit">;
  sessionStatus: SessionStatus;
  latestAudit: AuditSummary;
}
