import type {
  FindingId,
  FindingsArtifact,
  StoredFinding,
} from "@/lib/review-workflow/findings/types";
import type { ReviewOutcome, ReviewPhase, SessionStatus } from "@/lib/types";

export interface DiscoveryIterationResult {
  phase: Extract<ReviewPhase, "discovery">;
  sessionStatus: SessionStatus;
  findings: StoredFinding[];
  netNewFindingIds: FindingId[];
}

export interface DiscoveryPhaseResult {
  phase: Extract<ReviewPhase, "discovery">;
  sessionStatus: SessionStatus;
  findings: StoredFinding[];
  iterations: number;
  stopReason: "no-new-findings" | "max-iterations" | "interrupted";
}

export interface DiscoverySessionResult {
  phase: Extract<ReviewPhase, "discovery">;
  sessionStatus: SessionStatus;
  reviewOutcome: ReviewOutcome;
  reason: string;
  iterations: number;
  findings: StoredFinding[];
  artifact?: FindingsArtifact;
  artifactPath?: string;
}
