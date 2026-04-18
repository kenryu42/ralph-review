import type {
  FindingId,
  FindingsArtifact,
  StoredFinding,
} from "@/lib/review-workflow/findings/types";
import type { ReviewOutcome, ReviewPhase, SessionStatus } from "@/lib/types";

export interface ReviewIterationResult {
  phase: Extract<ReviewPhase, "review">;
  sessionStatus: SessionStatus;
  findings: StoredFinding[];
  netNewFindingIds: FindingId[];
}

export interface ReviewPhaseResult {
  phase: Extract<ReviewPhase, "review">;
  sessionStatus: SessionStatus;
  findings: StoredFinding[];
  iterations: number;
  stopReason: "no-new-findings" | "max-iterations" | "interrupted";
}

export interface ReviewSessionResult {
  phase: Extract<ReviewPhase, "review">;
  sessionStatus: SessionStatus;
  reviewOutcome: ReviewOutcome;
  reason: string;
  iterations: number;
  findings: StoredFinding[];
  artifact?: FindingsArtifact;
  artifactPath?: string;
}
