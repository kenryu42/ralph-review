import type { AuditSummary } from "@/lib/review-workflow/findings/types";
import type { ReviewPhase, SessionStatus } from "@/lib/types";

export interface FinalAuditPhaseResult {
  phase: Extract<ReviewPhase, "final-audit">;
  sessionStatus: SessionStatus;
  summary: AuditSummary;
}
