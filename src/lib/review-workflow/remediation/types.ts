import type {
  AuditSummary,
  FindingFixResult,
  FindingId,
  FindingsArtifact,
  StoredFinding,
} from "@/lib/review-workflow/findings/types";
import type { HandoffStatus, ReviewOutcome, ReviewPhase, SessionStatus } from "@/lib/types";

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

export interface FixSessionResult {
  phase: ReviewPhase;
  sessionStatus: SessionStatus;
  reviewOutcome: ReviewOutcome;
  reason: string;
  artifact?: FindingsArtifact;
  selection: RemediationSelection;
  fixResults: FindingFixResult[];
  audit?: AuditSummary;
  unresolvedSelectedFindings: StoredFinding[];
  unselectedFindings: StoredFinding[];
  handoffStatus?: HandoffStatus;
  handoffUpdatedAt?: number;
  commitSha?: string;
}
