import { join } from "node:path";
import { getProjectStorageDir } from "@/lib/logging";
import type {
  AuditSummary,
  FindingFixResult,
  FindingId,
  FindingsArtifact,
} from "@/lib/review-workflow/findings/types";

const FINDINGS_ARTIFACT_VERSION = 1;

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

  if (typeof value.sourceFingerprint !== "string" || value.sourceFingerprint.trim().length === 0) {
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

function hashDirectoryEntry(
  hasher: Bun.CryptoHasher,
  snapshotPath: string,
  absolutePath: string,
  relativePath: string
): Promise<void> {
  const file = Bun.file(absolutePath);

  return file
    .arrayBuffer()
    .then((buffer) => {
      hasher.update("FILE\n");
      hasher.update(relativePath);
      hasher.update("\n");
      hasher.update(String(buffer.byteLength));
      hasher.update("\n");
      hasher.update(new Uint8Array(buffer));
      hasher.update("\n");
    })
    .catch(() => {
      throw new Error(
        `Failed to read snapshot file while hashing: ${join(snapshotPath, relativePath)}`
      );
    });
}

async function listRelativeFiles(rootPath: string): Promise<string[]> {
  const glob = new Bun.Glob("**/*");
  const relativeFiles: string[] = [];

  for await (const relativePath of glob.scan({ cwd: rootPath, onlyFiles: true })) {
    relativeFiles.push(relativePath);
  }

  relativeFiles.sort((left, right) => left.localeCompare(right));
  return relativeFiles;
}

async function assertSnapshotDirectoryExists(snapshotPath: string): Promise<void> {
  const glob = new Bun.Glob("**/*");

  try {
    for await (const _ of glob.scan({ cwd: snapshotPath, onlyFiles: true })) {
      break;
    }
  } catch {
    throw new Error(`Reviewed snapshot path is missing: ${snapshotPath}`);
  }
}

async function directoryExists(path: string): Promise<boolean> {
  const glob = new Bun.Glob("**/*");

  try {
    for await (const _ of glob.scan({ cwd: path, onlyFiles: true })) {
      break;
    }
    return true;
  } catch {
    return false;
  }
}

function ensureDirectory(path: string): void {
  const result = Bun.spawnSync(["mkdir", "-p", path], {
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`Failed to create directory ${path}: ${stderr || "mkdir failed"}`);
  }
}

async function copySnapshotFiles(sourcePath: string, destinationPath: string): Promise<void> {
  ensureDirectory(destinationPath);

  for (const relativePath of await listRelativeFiles(sourcePath)) {
    const sourceFile = Bun.file(join(sourcePath, relativePath));
    await Bun.write(join(destinationPath, relativePath), await sourceFile.arrayBuffer(), {
      createPath: true,
    });
  }
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

export async function computeSnapshotFingerprint(snapshotPath: string): Promise<string> {
  await assertSnapshotDirectoryExists(snapshotPath);

  const relativeFiles = await listRelativeFiles(snapshotPath);
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update("snapshot-v1\n");

  for (const relativePath of relativeFiles) {
    const absolutePath = join(snapshotPath, relativePath);
    await hashDirectoryEntry(hasher, snapshotPath, absolutePath, relativePath);
  }

  return hasher.digest("hex");
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

export async function persistReviewedSnapshot(
  storageRoot: string,
  projectPath: string,
  sessionId: string,
  sourceSnapshotPath: string
): Promise<{ reviewedSnapshotPath: string; sourceFingerprint: string }> {
  await assertSnapshotDirectoryExists(sourceSnapshotPath);

  const reviewedSnapshotPath = getReviewedSnapshotPath(storageRoot, projectPath, sessionId);
  const sourceFingerprint = await computeSnapshotFingerprint(sourceSnapshotPath);

  if (sourceSnapshotPath !== reviewedSnapshotPath) {
    const storedSnapshotExists = await directoryExists(reviewedSnapshotPath);
    if (storedSnapshotExists) {
      const storedFingerprint = await computeSnapshotFingerprint(reviewedSnapshotPath);
      if (storedFingerprint !== sourceFingerprint) {
        throw new Error(
          `Reviewed snapshot already exists for session ${sessionId} at ${reviewedSnapshotPath}`
        );
      }
    } else {
      await copySnapshotFiles(sourceSnapshotPath, reviewedSnapshotPath);
    }
  }

  const persistedFingerprint = await computeSnapshotFingerprint(reviewedSnapshotPath);
  return {
    reviewedSnapshotPath,
    sourceFingerprint: persistedFingerprint,
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

export async function validateArtifactSnapshot(
  artifact: FindingsArtifact
): Promise<{ fingerprint: string }> {
  const computedFingerprint = await computeSnapshotFingerprint(artifact.reviewedSnapshotPath);

  if (computedFingerprint !== artifact.sourceFingerprint) {
    throw new Error(
      `Reviewed snapshot fingerprint mismatch for session ${artifact.sessionId}. Expected ${artifact.sourceFingerprint}, got ${computedFingerprint}`
    );
  }

  return {
    fingerprint: computedFingerprint,
  };
}
