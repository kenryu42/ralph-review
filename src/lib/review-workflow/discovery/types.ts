import type { FindingId, StoredFinding } from "@/lib/review-workflow/findings/types";
import type { ReviewPhase, SessionStatus } from "@/lib/types";

export interface DiscoveryIterationResult {
  phase: Extract<ReviewPhase, "discovery">;
  sessionStatus: SessionStatus;
  findings: StoredFinding[];
  netNewFindingIds: FindingId[];
}
