import type { RetainedSessionWorktree } from "@/lib/git";
import type { Priority } from "@/lib/types";

export type FindingId = `F${string}`;
export type FindingFingerprint = string;

export interface StoredFinding {
  id: FindingId;
  fingerprint: FindingFingerprint;
  locationKey?: string;
  title: string;
  body: string;
  priority: Priority;
  confidenceScore: number;
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface FindingFixResult {
  findingId: FindingId;
  status: "resolved" | "unresolved";
  summary: string;
}

export interface FindingsArtifact {
  artifactVersion: 1;
  sessionId: string;
  projectPath: string;
  logPath: string;
  baselineRef: string;
  baselineCommitSha: string;
  sourceBaselineRef: string;
  sourceBaselineCommitSha: string;
  sourceBaselineFingerprint: string;
  finalRef?: string;
  finalCommitSha?: string;
  retainedWorktree?: RetainedSessionWorktree;
  findings: StoredFinding[];
  selectedFindingIds: FindingId[];
  fixResults?: FindingFixResult[];
  createdAt: string;
  updatedAt: string;
}
