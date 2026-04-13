import type { FindingsArtifact } from "@/lib/review-workflow/findings/types";
import type { ReviewOutcome, ReviewPhase, SessionStatus } from "@/lib/types";

export interface WorkflowSessionState {
  currentPhase: ReviewPhase;
  sessionStatus: SessionStatus;
  reviewOutcome?: ReviewOutcome;
  artifactPath?: string;
  artifact?: FindingsArtifact;
}
