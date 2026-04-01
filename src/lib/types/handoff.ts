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
