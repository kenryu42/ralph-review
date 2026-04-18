import type { RetainedSessionWorktree } from "@/lib/git";
import type {
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

export interface FixSessionResult {
  phase: ReviewPhase;
  sessionStatus: SessionStatus;
  reviewOutcome: ReviewOutcome;
  reason: string;
  artifact?: FindingsArtifact;
  selection: RemediationSelection;
  fixResults: FindingFixResult[];
  unresolvedSelectedFindings: StoredFinding[];
  unselectedFindings: StoredFinding[];
  handoffStatus?: HandoffStatus;
  handoffUpdatedAt?: number;
  commitSha?: string;
  retainedWorktree?: RetainedSessionWorktree;
}
