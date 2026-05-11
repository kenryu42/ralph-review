import { join } from "node:path";
import type { RetainedSessionWorktree } from "@/lib/git";
import { getProjectStorageDir } from "@/lib/logging";
import type {
  FindingFixResult,
  FindingId,
  FindingsArtifact,
} from "@/lib/review-workflow/findings/types";

const FINDINGS_ARTIFACT_VERSION = 1;
const INVALID_SCHEMA_RETRY_MESSAGE = "Findings artifact has invalid schema — re-run rr run";

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
      (entry.status === "resolved" ||
        entry.status === "skipped" ||
        entry.status === "unresolved") &&
      typeof entry.summary === "string"
    );
  });
}

function isRetainedSessionWorktree(value: unknown): value is RetainedSessionWorktree {
  if (value === undefined) {
    return true;
  }

  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.worktreeProjectPath === "string" &&
    typeof value.worktreeBranch === "string" &&
    typeof value.mergeReady === "boolean" &&
    (value.commitSha === undefined || typeof value.commitSha === "string")
  );
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

  if (typeof value.baselineRef !== "string" || value.baselineRef.trim().length === 0) {
    return false;
  }

  if (typeof value.baselineCommitSha !== "string" || value.baselineCommitSha.trim().length === 0) {
    return false;
  }

  if (typeof value.sourceBaselineRef !== "string" || value.sourceBaselineRef.trim().length === 0) {
    return false;
  }

  if (
    typeof value.sourceBaselineCommitSha !== "string" ||
    value.sourceBaselineCommitSha.trim().length === 0
  ) {
    return false;
  }

  if (
    typeof value.sourceBaselineFingerprint !== "string" ||
    value.sourceBaselineFingerprint.trim().length === 0
  ) {
    return false;
  }

  if (value.finalRef !== undefined && typeof value.finalRef !== "string") {
    return false;
  }

  if (value.finalCommitSha !== undefined && typeof value.finalCommitSha !== "string") {
    return false;
  }

  if (!isRetainedSessionWorktree(value.retainedWorktree)) {
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

  if (typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") {
    return false;
  }

  return true;
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
    throw new Error(INVALID_SCHEMA_RETRY_MESSAGE);
  }

  return parsed;
}

export function getFindingsArtifactPath(
  storageRoot: string,
  projectPath: string,
  sessionId: string
): string {
  return join(getProjectStorageDir(storageRoot, projectPath), "findings", `${sessionId}.json`);
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

export async function updateRetainedWorktree(
  storageRoot: string,
  projectPath: string,
  sessionId: string,
  retainedWorktree: RetainedSessionWorktree | undefined
): Promise<FindingsArtifact> {
  const artifact = await loadRequiredArtifact(storageRoot, projectPath, sessionId);
  return await saveFindingsArtifact(storageRoot, {
    ...artifact,
    retainedWorktree,
  });
}

export async function validateArtifactBaseline(
  artifact: FindingsArtifact
): Promise<{ baselineCommitSha: string }> {
  const result = Bun.spawnSync(
    ["git", "cat-file", "-e", `${artifact.baselineCommitSha}^{commit}`],
    {
      cwd: artifact.projectPath,
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  if (result.exitCode !== 0) {
    throw new Error(`Baseline commit ${artifact.baselineCommitSha} not found`);
  }

  if (artifact.retainedWorktree && !artifact.retainedWorktree.commitSha) {
    throw new Error("Retained remediation commit is missing");
  }

  if (artifact.retainedWorktree?.commitSha) {
    const retainedResult = Bun.spawnSync(
      ["git", "cat-file", "-e", `${artifact.retainedWorktree.commitSha}^{commit}`],
      {
        cwd: artifact.projectPath,
        stdout: "pipe",
        stderr: "pipe",
      }
    );

    if (retainedResult.exitCode !== 0) {
      throw new Error(
        `Retained remediation commit ${artifact.retainedWorktree.commitSha} not found`
      );
    }
  }

  return {
    baselineCommitSha: artifact.baselineCommitSha,
  };
}
