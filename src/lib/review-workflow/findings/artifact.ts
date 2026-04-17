import { join } from "node:path";
import { materializeWorkingTreeSnapshot } from "@/lib/git";
import { getProjectStorageDir } from "@/lib/logging";
import type {
  AuditSummary,
  FindingFixResult,
  FindingId,
  FindingsArtifact,
} from "@/lib/review-workflow/findings/types";
import {
  assertSnapshotDirectoryExists as assertSnapshotDirectoryExistsSync,
  computeSnapshotDirectoryFingerprint,
  copySnapshotDirectoryPreservingMetadata,
  rootEntryExists,
  type SnapshotCopyOptions,
  type SnapshotFingerprintOptions,
  snapshotDirectoryExists,
} from "@/lib/review-workflow/shared/snapshot";

const FINDINGS_ARTIFACT_VERSION = 1;
const REVIEWED_SNAPSHOT_EXCLUDE_OPTIONS: SnapshotCopyOptions & SnapshotFingerprintOptions = {
  excludeRootEntries: [".git"],
};

function normalizeIsoTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }

  return date.toISOString();
}

function createCurrentIsoTimestamp(): string {
  return new Date().toISOString();
}

function uniqueSortedFindingIds(ids: FindingId[]): FindingId[] {
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}

function isFindingId(value: unknown): value is FindingId {
  return typeof value === "string" && /^F\d+$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isStoredFindingArray(value: unknown): boolean {
  if (!Array.isArray(value)) {
    return false;
  }

  return value.every((entry) => {
    if (!isRecord(entry)) {
      return false;
    }

    return (
      isFindingId(entry.id) &&
      typeof entry.fingerprint === "string" &&
      typeof entry.title === "string" &&
      typeof entry.body === "string" &&
      typeof entry.priority === "string" &&
      typeof entry.confidenceScore === "number" &&
      typeof entry.filePath === "string" &&
      typeof entry.startLine === "number" &&
      typeof entry.endLine === "number"
    );
  });
}

function isFixResultArray(value: unknown): value is FindingFixResult[] {
  if (value === undefined) {
    return true;
  }

  if (!Array.isArray(value)) {
    return false;
  }

  return value.every((entry) => {
    if (!isRecord(entry)) {
      return false;
    }

    return (
      isFindingId(entry.findingId) &&
      (entry.status === "fixed" || entry.status === "skipped" || entry.status === "failed") &&
      typeof entry.summary === "string"
    );
  });
}

function isAuditSummary(value: unknown): value is AuditSummary {
  if (value === undefined) {
    return true;
  }

  if (!isRecord(value)) {
    return false;
  }

  const resolved = value.resolvedFindingIds;
  const unresolved = value.unresolvedFindingIds;
  const regressions = value.regressionFindings;

  if (!Array.isArray(resolved) || !resolved.every(isFindingId)) {
    return false;
  }

  if (!Array.isArray(unresolved) || !unresolved.every(isFindingId)) {
    return false;
  }

  if (!isStoredFindingArray(regressions)) {
    return false;
  }

  if (value.summary !== undefined && typeof value.summary !== "string") {
    return false;
  }

  return true;
}

function isFindingsArtifact(value: unknown): value is FindingsArtifact {
  if (!isRecord(value)) {
    return false;
  }

  if (value.artifactVersion !== FINDINGS_ARTIFACT_VERSION) {
    return false;
  }

  if (typeof value.sessionId !== "string" || value.sessionId.trim().length === 0) {
    return false;
  }

  if (typeof value.projectPath !== "string" || value.projectPath.trim().length === 0) {
    return false;
  }

  if (typeof value.logPath !== "string" || value.logPath.trim().length === 0) {
    return false;
  }

  if (typeof value.reviewedSnapshotRef !== "string") {
    return false;
  }

  if (
    typeof value.reviewedSnapshotPath !== "string" ||
    value.reviewedSnapshotPath.trim().length === 0
  ) {
    return false;
  }

  if (
    typeof value.reviewedSnapshotFingerprint !== "string" ||
    value.reviewedSnapshotFingerprint.trim().length === 0
  ) {
    return false;
  }

  if (
    typeof value.handoffSnapshotPath !== "string" ||
    value.handoffSnapshotPath.trim().length === 0
  ) {
    return false;
  }

  if (
    typeof value.handoffSnapshotFingerprint !== "string" ||
    value.handoffSnapshotFingerprint.trim().length === 0
  ) {
    return false;
  }

  if (
    typeof value.sourceRepoFingerprint !== "string" ||
    value.sourceRepoFingerprint.trim().length === 0
  ) {
    return false;
  }

  if (!isStoredFindingArray(value.findings)) {
    return false;
  }

  if (!Array.isArray(value.selectedFindingIds) || !value.selectedFindingIds.every(isFindingId)) {
    return false;
  }

  if (!isFixResultArray(value.fixResults)) {
    return false;
  }

  if (!isAuditSummary(value.latestAudit)) {
    return false;
  }

  if (typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") {
    return false;
  }

  return true;
}

async function assertNamedSnapshotDirectoryExists(
  description: string,
  snapshotPath: string
): Promise<void> {
  assertSnapshotDirectoryExistsSync(description, snapshotPath);
}

async function assertSnapshotDirectoryExists(snapshotPath: string): Promise<void> {
  await assertNamedSnapshotDirectoryExists("Reviewed snapshot path", snapshotPath);
}

async function directoryExists(path: string): Promise<boolean> {
  return snapshotDirectoryExists(path);
}

async function readFindingsArtifactFile(artifactPath: string): Promise<FindingsArtifact | null> {
  const file = Bun.file(artifactPath);

  if (!(await file.exists())) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text()) as unknown;
  } catch {
    throw new Error(`Findings artifact is not valid JSON: ${artifactPath}`);
  }

  if (!isFindingsArtifact(parsed)) {
    throw new Error(`Findings artifact has invalid schema: ${artifactPath}`);
  }

  return parsed;
}

export async function computeSnapshotFingerprint(
  snapshotPath: string,
  options?: SnapshotFingerprintOptions
): Promise<string> {
  await assertSnapshotDirectoryExists(snapshotPath);
  return await computeSnapshotDirectoryFingerprint(snapshotPath, options);
}

export function getFindingsArtifactPath(
  storageRoot: string,
  projectPath: string,
  sessionId: string
): string {
  return join(getProjectStorageDir(storageRoot, projectPath), "findings", `${sessionId}.json`);
}

export function getReviewedSnapshotPath(
  storageRoot: string,
  projectPath: string,
  sessionId: string
): string {
  return join(getProjectStorageDir(storageRoot, projectPath), "snapshots", sessionId, "reviewed");
}

export function getHandoffSnapshotPath(
  storageRoot: string,
  projectPath: string,
  sessionId: string
): string {
  return join(getProjectStorageDir(storageRoot, projectPath), "snapshots", sessionId, "handoff");
}

async function persistSnapshotCopy(
  sourceSnapshotPath: string,
  destinationSnapshotPath: string,
  sessionId: string,
  label: string,
  options?: SnapshotCopyOptions & SnapshotFingerprintOptions
): Promise<string> {
  await assertNamedSnapshotDirectoryExists(`${label} path`, sourceSnapshotPath);

  const sourceFingerprint = await computeSnapshotFingerprint(sourceSnapshotPath, options);

  if (sourceSnapshotPath !== destinationSnapshotPath) {
    const storedSnapshotExists = await directoryExists(destinationSnapshotPath);
    if (storedSnapshotExists) {
      const storedFingerprint = await computeSnapshotFingerprint(destinationSnapshotPath, options);
      if (storedFingerprint !== sourceFingerprint) {
        throw new Error(
          `${label} already exists for session ${sessionId} at ${destinationSnapshotPath}`
        );
      }
    } else {
      copySnapshotDirectoryPreservingMetadata(sourceSnapshotPath, destinationSnapshotPath, options);
    }
  }

  return await computeSnapshotFingerprint(destinationSnapshotPath, options);
}

export async function persistDiscoverySnapshots(
  storageRoot: string,
  projectPath: string,
  sessionId: string,
  options: {
    reviewedSnapshotSourcePath: string;
    handoffSnapshotSourceDir: string;
    sourceRepoFingerprint: string;
  }
): Promise<{
  reviewedSnapshotPath: string;
  reviewedSnapshotFingerprint: string;
  handoffSnapshotPath: string;
  handoffSnapshotFingerprint: string;
  sourceRepoFingerprint: string;
}> {
  const reviewedSnapshotPath = getReviewedSnapshotPath(storageRoot, projectPath, sessionId);
  const reviewedSnapshotFingerprint = await persistSnapshotCopy(
    options.reviewedSnapshotSourcePath,
    reviewedSnapshotPath,
    sessionId,
    "Reviewed snapshot",
    REVIEWED_SNAPSHOT_EXCLUDE_OPTIONS
  );

  const handoffSnapshotPath = getHandoffSnapshotPath(storageRoot, projectPath, sessionId);
  if (!(await directoryExists(handoffSnapshotPath))) {
    materializeWorkingTreeSnapshot(options.handoffSnapshotSourceDir, handoffSnapshotPath);
  }
  const handoffSnapshotFingerprint = await computeSnapshotFingerprint(handoffSnapshotPath);

  return {
    reviewedSnapshotPath,
    reviewedSnapshotFingerprint,
    handoffSnapshotPath,
    handoffSnapshotFingerprint,
    sourceRepoFingerprint: options.sourceRepoFingerprint,
  };
}

export async function saveFindingsArtifact(
  storageRoot: string,
  artifact: FindingsArtifact
): Promise<FindingsArtifact> {
  const now = createCurrentIsoTimestamp();
  const createdAt = normalizeIsoTimestamp(artifact.createdAt);
  const normalized: FindingsArtifact = {
    ...artifact,
    artifactVersion: FINDINGS_ARTIFACT_VERSION,
    selectedFindingIds: uniqueSortedFindingIds(artifact.selectedFindingIds),
    createdAt,
    updatedAt: now,
  };

  const artifactPath = getFindingsArtifactPath(
    storageRoot,
    normalized.projectPath,
    normalized.sessionId
  );
  await Bun.write(artifactPath, JSON.stringify(normalized, null, 2), { createPath: true });
  return normalized;
}

export async function loadFindingsArtifact(
  storageRoot: string,
  projectPath: string,
  sessionId: string
): Promise<FindingsArtifact | null> {
  const artifactPath = getFindingsArtifactPath(storageRoot, projectPath, sessionId);
  return await readFindingsArtifactFile(artifactPath);
}

export async function loadFindingsArtifactBySessionId(
  storageRoot: string,
  sessionId: string
): Promise<FindingsArtifact | null> {
  const matches: FindingsArtifact[] = [];
  const artifactPathGlob = new Bun.Glob(`*/findings/${sessionId}.json`);

  try {
    for await (const relativePath of artifactPathGlob.scan({ cwd: storageRoot })) {
      const artifact = await readFindingsArtifactFile(join(storageRoot, relativePath));
      if (artifact) {
        matches.push(artifact);
      }
    }
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }
    throw error;
  }

  if (matches.length === 0) {
    return null;
  }

  if (matches.length > 1) {
    throw new Error(`Multiple findings artifacts found for session ${sessionId}`);
  }

  return matches[0] ?? null;
}

async function loadRequiredArtifact(
  storageRoot: string,
  projectPath: string,
  sessionId: string
): Promise<FindingsArtifact> {
  const artifact = await loadFindingsArtifact(storageRoot, projectPath, sessionId);
  if (!artifact) {
    throw new Error(
      `Findings artifact not found for session ${sessionId} at ${getFindingsArtifactPath(storageRoot, projectPath, sessionId)}`
    );
  }

  return artifact;
}

export async function updateSelection(
  storageRoot: string,
  projectPath: string,
  sessionId: string,
  selectedFindingIds: FindingId[]
): Promise<FindingsArtifact> {
  const artifact = await loadRequiredArtifact(storageRoot, projectPath, sessionId);
  return await saveFindingsArtifact(storageRoot, {
    ...artifact,
    selectedFindingIds: uniqueSortedFindingIds(selectedFindingIds),
  });
}

export async function appendFixResults(
  storageRoot: string,
  projectPath: string,
  sessionId: string,
  fixResults: FindingFixResult[]
): Promise<FindingsArtifact> {
  const artifact = await loadRequiredArtifact(storageRoot, projectPath, sessionId);
  const combined = [...(artifact.fixResults ?? []), ...fixResults];

  return await saveFindingsArtifact(storageRoot, {
    ...artifact,
    fixResults: combined,
  });
}

export async function updateAuditSummary(
  storageRoot: string,
  projectPath: string,
  sessionId: string,
  latestAudit: AuditSummary
): Promise<FindingsArtifact> {
  const artifact = await loadRequiredArtifact(storageRoot, projectPath, sessionId);

  return await saveFindingsArtifact(storageRoot, {
    ...artifact,
    latestAudit,
  });
}

export async function validateArtifactSnapshots(artifact: FindingsArtifact): Promise<{
  reviewedSnapshotFingerprint: string;
  handoffSnapshotFingerprint: string;
}> {
  await assertNamedSnapshotDirectoryExists("Reviewed snapshot path", artifact.reviewedSnapshotPath);
  if (rootEntryExists(artifact.reviewedSnapshotPath, ".git")) {
    throw new Error(
      `Reviewed snapshot for session ${artifact.sessionId} contains root .git metadata and is unsupported. Re-run discovery to regenerate findings artifacts.`
    );
  }
  const computedReviewedFingerprint = await computeSnapshotFingerprint(
    artifact.reviewedSnapshotPath
  );

  if (computedReviewedFingerprint !== artifact.reviewedSnapshotFingerprint) {
    throw new Error(
      `Reviewed snapshot fingerprint mismatch for session ${artifact.sessionId}. Expected ${artifact.reviewedSnapshotFingerprint}, got ${computedReviewedFingerprint}`
    );
  }

  await assertNamedSnapshotDirectoryExists("Handoff snapshot path", artifact.handoffSnapshotPath);
  const computedHandoffFingerprint = await computeSnapshotFingerprint(artifact.handoffSnapshotPath);
  if (computedHandoffFingerprint !== artifact.handoffSnapshotFingerprint) {
    throw new Error(
      `Handoff snapshot fingerprint mismatch for session ${artifact.sessionId}. Expected ${artifact.handoffSnapshotFingerprint}, got ${computedHandoffFingerprint}`
    );
  }

  return {
    reviewedSnapshotFingerprint: computedReviewedFingerprint,
    handoffSnapshotFingerprint: computedHandoffFingerprint,
  };
}
