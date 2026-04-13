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
  status: "fixed" | "skipped" | "failed";
  summary: string;
}

export interface AuditSummary {
  resolvedFindingIds: FindingId[];
  unresolvedFindingIds: FindingId[];
  regressionFindings: StoredFinding[];
  summary?: string;
}

export interface FindingsArtifact {
  artifactVersion: 1;
  sessionId: string;
  projectPath: string;
  logPath: string;
  reviewedSnapshotRef: string;
  reviewedSnapshotPath: string;
  sourceFingerprint: string;
  findings: StoredFinding[];
  selectedFindingIds: FindingId[];
  fixResults?: FindingFixResult[];
  latestAudit?: AuditSummary;
  createdAt: string;
  updatedAt: string;
}
