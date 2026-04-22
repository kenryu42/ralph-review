export type HandoffStatus =
  | "applied-auto"
  | "pending-apply"
  | "merge-conflicted"
  | "applied-manual"
  | "discarded";

export interface PendingHandoffArtifact {
  sessionId: string;
  projectPath: string;
  sourceRepoPath: string;
  logPath: string;
  hiddenRef: string;
  patchPath: string;
  sourceBaselineFingerprint: string;
  commitSha: string;
  state: "pending-apply" | "merge-conflicted";
  createdAt: number;
  updatedAt: number;
  mergeStartedAt?: number;
  mergeStartFingerprint?: string;
}

export interface ArchivedAppliedHandoffArtifact {
  sessionId: string;
  projectPath: string;
  sourceRepoPath: string;
  logPath: string;
  patchPath: string;
  sourceBaselineFingerprint: string;
  appliedFingerprint: string;
  commitSha: string;
  appliedVia: "auto" | "manual";
  applyMode?: "patch" | "merge";
  state: "archived-applied";
  createdAt: number;
  appliedAt: number;
}

export interface ArchivedHandoffMatchResult {
  currentFingerprint: string;
  handoffs: ArchivedAppliedHandoffArtifact[];
}
