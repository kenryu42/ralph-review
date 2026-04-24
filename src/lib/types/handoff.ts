export type HandoffStatus =
  | "applied-auto"
  | "pending-apply"
  | "apply-conflicted"
  | "applied-manual"
  | "discarded";

export interface PendingHandoffArtifact {
  handoffId: string;
  sessionId: string;
  projectPath: string;
  sourceRepoPath: string;
  logPath: string;
  hiddenRef: string;
  patchPath: string;
  sourceBaselineFingerprint: string;
  commitSha: string;
  state: "pending-apply" | "apply-conflicted";
  createdAt: number;
  updatedAt: number;
  applyStartedAt?: number;
  applyStartFingerprint?: string;
}
