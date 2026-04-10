export type HandoffStatus = "applied-auto" | "pending-apply" | "applied-manual" | "discarded";

export interface PendingHandoffArtifact {
  sessionId: string;
  projectPath: string;
  sourceRepoPath: string;
  logPath: string;
  hiddenRef: string;
  patchPath: string;
  sourceFingerprint: string;
  commitSha: string;
  state: "pending-apply";
  createdAt: number;
  updatedAt: number;
}

export interface ArchivedAppliedHandoffArtifact {
  sessionId: string;
  projectPath: string;
  sourceRepoPath: string;
  logPath: string;
  patchPath: string;
  sourceFingerprint: string;
  appliedFingerprint: string;
  commitSha: string;
  appliedVia: "auto" | "manual";
  state: "archived-applied";
  createdAt: number;
  appliedAt: number;
}

export interface ArchivedHandoffMatchResult {
  currentFingerprint: string;
  handoffs: ArchivedAppliedHandoffArtifact[];
}
