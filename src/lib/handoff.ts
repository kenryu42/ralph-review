import { join } from "node:path";
import { CONFIG_DIR } from "@/lib/config";
import type { GitSessionWorktree } from "@/lib/git";
import {
  applyBinaryPatch,
  applyBinaryPatchAsync,
  buildHandoffRef,
  computeWorkingTreeFingerprint,
  computeWorkingTreeFingerprintAsync,
  createBaselineToFinalPatch,
  createHandoffRef,
  deleteSessionRefs,
  finalizeSessionWorktree,
} from "@/lib/git";
import { getProjectStorageDir } from "@/lib/logger";
import type {
  ArchivedAppliedHandoffArtifact,
  ArchivedHandoffMatchResult,
  HandoffStatus,
  PendingHandoffArtifact,
} from "@/lib/types";

interface CreateOrAutoApplyOptions {
  sessionId: string;
  projectPath: string;
  logPath: string;
  worktree: GitSessionWorktree;
  autoApply?: boolean;
}

export interface SessionHandoffResult {
  handoffStatus: Extract<HandoffStatus, "applied-auto" | "pending-apply">;
  commitSha: string;
  handoffUpdatedAt: number;
}

const SNAPSHOT_MISMATCH_ERROR_MESSAGE =
  "Current repository state no longer matches the saved review baseline.";
const MAX_ARCHIVED_HANDOFFS = 5;

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isSnapshotMismatchError(error: unknown): error is Error {
  return error instanceof Error && error.message === SNAPSHOT_MISMATCH_ERROR_MESSAGE;
}

function getProjectHandoffsDir(storageRoot: string = CONFIG_DIR, projectPath: string): string {
  return join(getProjectStorageDir(storageRoot, projectPath), "handoffs");
}

function getProjectHandoffHistoryDir(
  storageRoot: string = CONFIG_DIR,
  projectPath: string
): string {
  return join(getProjectStorageDir(storageRoot, projectPath), "handoff-history");
}

function getPendingHandoffMetadataPath(
  storageRoot: string = CONFIG_DIR,
  projectPath: string,
  sessionId: string
): string {
  return join(getProjectHandoffsDir(storageRoot, projectPath), `${sessionId}.json`);
}

function getPendingHandoffPatchPath(
  storageRoot: string = CONFIG_DIR,
  projectPath: string,
  sessionId: string
): string {
  return join(getProjectHandoffsDir(storageRoot, projectPath), `${sessionId}.patch`);
}

function getArchivedHandoffMetadataPath(
  storageRoot: string = CONFIG_DIR,
  projectPath: string,
  sessionId: string
): string {
  return join(getProjectHandoffHistoryDir(storageRoot, projectPath), `${sessionId}.json`);
}

function getArchivedHandoffPatchPath(
  storageRoot: string = CONFIG_DIR,
  projectPath: string,
  sessionId: string
): string {
  return join(getProjectHandoffHistoryDir(storageRoot, projectPath), `${sessionId}.patch`);
}

function normalizePendingHandoff(raw: unknown): PendingHandoffArtifact | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const candidate = raw as Record<string, unknown>;
  const {
    sessionId,
    projectPath,
    sourceRepoPath,
    logPath,
    hiddenRef,
    patchPath,
    trackedRepoFingerprint,
    commitSha,
    state,
    createdAt,
    updatedAt,
  } = candidate;
  if (
    typeof sessionId !== "string" ||
    typeof projectPath !== "string" ||
    typeof sourceRepoPath !== "string" ||
    typeof logPath !== "string" ||
    typeof hiddenRef !== "string" ||
    typeof patchPath !== "string" ||
    typeof trackedRepoFingerprint !== "string" ||
    typeof commitSha !== "string" ||
    state !== "pending-apply" ||
    typeof createdAt !== "number" ||
    typeof updatedAt !== "number"
  ) {
    return null;
  }

  return {
    sessionId,
    projectPath,
    sourceRepoPath,
    logPath,
    hiddenRef,
    patchPath,
    trackedRepoFingerprint,
    commitSha,
    state,
    createdAt,
    updatedAt,
  };
}

function normalizeArchivedHandoff(raw: unknown): ArchivedAppliedHandoffArtifact | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const candidate = raw as Record<string, unknown>;
  const {
    sessionId,
    projectPath,
    sourceRepoPath,
    logPath,
    patchPath,
    trackedRepoFingerprint,
    appliedFingerprint,
    commitSha,
    appliedVia,
    state,
    createdAt,
    appliedAt,
  } = candidate;
  if (
    typeof sessionId !== "string" ||
    typeof projectPath !== "string" ||
    typeof sourceRepoPath !== "string" ||
    typeof logPath !== "string" ||
    typeof patchPath !== "string" ||
    typeof trackedRepoFingerprint !== "string" ||
    typeof appliedFingerprint !== "string" ||
    typeof commitSha !== "string" ||
    (appliedVia !== "auto" && appliedVia !== "manual") ||
    state !== "archived-applied" ||
    typeof createdAt !== "number" ||
    typeof appliedAt !== "number"
  ) {
    return null;
  }

  return {
    sessionId,
    projectPath,
    sourceRepoPath,
    logPath,
    patchPath,
    trackedRepoFingerprint,
    appliedFingerprint,
    commitSha,
    appliedVia,
    state,
    createdAt,
    appliedAt,
  };
}

async function readArtifactFile<T>(
  path: string,
  normalize: (raw: unknown) => T | null
): Promise<T | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return null;
  }

  try {
    return normalize(JSON.parse(await file.text()));
  } catch {
    return null;
  }
}

async function listArtifacts<T>(
  artifactsDir: string,
  readArtifact: (sessionId: string) => Promise<T | null>,
  compare: (left: T, right: T) => number
): Promise<T[]> {
  const artifacts: T[] = [];
  const glob = new Bun.Glob("*.json");

  try {
    for await (const relativePath of glob.scan({ cwd: artifactsDir })) {
      const artifact = await readArtifact(relativePath.replace(/\.json$/u, ""));
      if (artifact) {
        artifacts.push(artifact);
      }
    }
  } catch (error) {
    if (isMissingPathError(error)) {
      return [];
    }
    throw error;
  }

  return artifacts.sort(compare);
}

async function deletePendingHandoffFiles(
  storageRoot: string,
  artifact: PendingHandoffArtifact
): Promise<void> {
  await Bun.file(
    getPendingHandoffMetadataPath(storageRoot, artifact.projectPath, artifact.sessionId)
  )
    .delete()
    .catch(() => {});
  await Bun.file(artifact.patchPath)
    .delete()
    .catch(() => {});
}

async function deleteArchivedHandoffFiles(
  storageRoot: string,
  artifact: ArchivedAppliedHandoffArtifact
): Promise<void> {
  await Bun.file(
    getArchivedHandoffMetadataPath(storageRoot, artifact.projectPath, artifact.sessionId)
  )
    .delete()
    .catch(() => {});
  await Bun.file(artifact.patchPath)
    .delete()
    .catch(() => {});
}

function buildArchivedMismatchError(
  artifact: ArchivedAppliedHandoffArtifact,
  action: "revert" | "reapply"
): Error {
  return new Error(
    action === "revert"
      ? `Archived review handoff "${artifact.sessionId}" cannot be reverted because the current repository state does not match its applied baseline.`
      : `Archived review handoff "${artifact.sessionId}" cannot be reapplied because the current repository state does not match its source baseline.`
  );
}

async function copyPatchToArchive(sourcePath: string, destinationPath: string): Promise<void> {
  await Bun.write(destinationPath, await Bun.file(sourcePath).arrayBuffer(), {
    createPath: true,
  });
}

async function pruneProjectArchivedHandoffs(
  storageRoot: string,
  projectPath: string
): Promise<void> {
  const archived = await listProjectArchivedHandoffs(storageRoot, projectPath);
  for (const artifact of archived.slice(MAX_ARCHIVED_HANDOFFS)) {
    await deleteArchivedHandoffFiles(storageRoot, artifact);
  }
}

async function archiveAppliedHandoff(
  storageRoot: string,
  artifact: PendingHandoffArtifact,
  appliedVia: ArchivedAppliedHandoffArtifact["appliedVia"]
): Promise<ArchivedAppliedHandoffArtifact> {
  const archivedPatchPath = getArchivedHandoffPatchPath(
    storageRoot,
    artifact.projectPath,
    artifact.sessionId
  );
  await copyPatchToArchive(artifact.patchPath, archivedPatchPath);

  const archivedArtifact: ArchivedAppliedHandoffArtifact = {
    sessionId: artifact.sessionId,
    projectPath: artifact.projectPath,
    sourceRepoPath: artifact.sourceRepoPath,
    logPath: artifact.logPath,
    patchPath: archivedPatchPath,
    trackedRepoFingerprint: artifact.trackedRepoFingerprint,
    appliedFingerprint: computeWorkingTreeFingerprint(artifact.sourceRepoPath),
    commitSha: artifact.commitSha,
    appliedVia,
    state: "archived-applied",
    createdAt: artifact.createdAt,
    appliedAt: Date.now(),
  };

  await Bun.write(
    getArchivedHandoffMetadataPath(storageRoot, artifact.projectPath, artifact.sessionId),
    JSON.stringify(archivedArtifact, null, 2),
    {
      createPath: true,
    }
  );
  await pruneProjectArchivedHandoffs(storageRoot, artifact.projectPath);
  return archivedArtifact;
}

async function applyPendingHandoffArtifact(
  storageRoot: string,
  artifact: PendingHandoffArtifact,
  appliedVia: ArchivedAppliedHandoffArtifact["appliedVia"]
): Promise<PendingHandoffArtifact> {
  const currentFingerprint = computeWorkingTreeFingerprint(artifact.sourceRepoPath);
  if (currentFingerprint !== artifact.trackedRepoFingerprint) {
    throw new Error(SNAPSHOT_MISMATCH_ERROR_MESSAGE);
  }

  applyBinaryPatch(artifact.sourceRepoPath, artifact.patchPath);
  await archiveAppliedHandoff(storageRoot, artifact, appliedVia);
  deleteSessionRefs(artifact.sourceRepoPath, artifact.sessionId);
  await deletePendingHandoffFiles(storageRoot, artifact);
  return artifact;
}

async function applyArchivedHandoffArtifact(
  artifact: ArchivedAppliedHandoffArtifact,
  action: "revert" | "reapply",
  expectedCurrentFingerprint?: string
): Promise<ArchivedAppliedHandoffArtifact> {
  const currentFingerprint =
    expectedCurrentFingerprint ??
    (await computeWorkingTreeFingerprintAsync(artifact.sourceRepoPath));
  const expectedFingerprint =
    action === "revert" ? artifact.appliedFingerprint : artifact.trackedRepoFingerprint;
  if (currentFingerprint !== expectedFingerprint) {
    throw buildArchivedMismatchError(artifact, action);
  }

  await applyBinaryPatchAsync(artifact.sourceRepoPath, artifact.patchPath, {
    reverse: action === "revert",
  });

  const resultingFingerprint = await computeWorkingTreeFingerprintAsync(artifact.sourceRepoPath);
  const targetFingerprint =
    action === "revert" ? artifact.trackedRepoFingerprint : artifact.appliedFingerprint;
  if (resultingFingerprint !== targetFingerprint) {
    throw new Error(
      action === "revert"
        ? `Archived review handoff "${artifact.sessionId}" did not revert to the expected source baseline.`
        : `Archived review handoff "${artifact.sessionId}" did not reapply to the expected applied baseline.`
    );
  }

  return artifact;
}

export async function readPendingHandoff(
  storageRoot: string = CONFIG_DIR,
  projectPath: string,
  sessionId: string
): Promise<PendingHandoffArtifact | null> {
  return await readArtifactFile(
    getPendingHandoffMetadataPath(storageRoot, projectPath, sessionId),
    normalizePendingHandoff
  );
}

async function readArchivedHandoff(
  storageRoot: string = CONFIG_DIR,
  projectPath: string,
  sessionId: string
): Promise<ArchivedAppliedHandoffArtifact | null> {
  return await readArtifactFile(
    getArchivedHandoffMetadataPath(storageRoot, projectPath, sessionId),
    normalizeArchivedHandoff
  );
}

export async function listProjectPendingHandoffs(
  storageRoot: string = CONFIG_DIR,
  projectPath: string
): Promise<PendingHandoffArtifact[]> {
  return await listArtifacts(
    getProjectHandoffsDir(storageRoot, projectPath),
    (sessionId) => readPendingHandoff(storageRoot, projectPath, sessionId),
    (left, right) => right.updatedAt - left.updatedAt
  );
}

export async function listProjectArchivedHandoffs(
  storageRoot: string = CONFIG_DIR,
  projectPath: string
): Promise<ArchivedAppliedHandoffArtifact[]> {
  return await listArtifacts(
    getProjectHandoffHistoryDir(storageRoot, projectPath),
    (sessionId) => readArchivedHandoff(storageRoot, projectPath, sessionId),
    (left, right) => right.appliedAt - left.appliedAt
  );
}

export async function listProjectRevertableHandoffs(
  storageRoot: string = CONFIG_DIR,
  projectPath: string
): Promise<ArchivedHandoffMatchResult> {
  const currentFingerprint = await computeWorkingTreeFingerprintAsync(projectPath);
  const handoffs = await listProjectArchivedHandoffs(storageRoot, projectPath);
  return {
    currentFingerprint,
    handoffs: handoffs.filter((artifact) => artifact.appliedFingerprint === currentFingerprint),
  };
}

export async function listProjectReapplicableHandoffs(
  storageRoot: string = CONFIG_DIR,
  projectPath: string
): Promise<ArchivedHandoffMatchResult> {
  const currentFingerprint = await computeWorkingTreeFingerprintAsync(projectPath);
  const handoffs = await listProjectArchivedHandoffs(storageRoot, projectPath);
  return {
    currentFingerprint,
    handoffs: handoffs.filter((artifact) => artifact.trackedRepoFingerprint === currentFingerprint),
  };
}

export async function applyPendingHandoff(
  storageRoot: string = CONFIG_DIR,
  projectPath: string,
  sessionId: string
): Promise<PendingHandoffArtifact> {
  const artifact = await readPendingHandoff(storageRoot, projectPath, sessionId);
  if (!artifact) {
    throw new Error(`Pending review handoff "${sessionId}" was not found.`);
  }

  return await applyPendingHandoffArtifact(storageRoot, artifact, "manual");
}

export async function revertArchivedHandoff(
  storageRoot: string = CONFIG_DIR,
  projectPath: string,
  sessionId: string,
  expectedCurrentFingerprint?: string
): Promise<ArchivedAppliedHandoffArtifact> {
  const artifact = await readArchivedHandoff(storageRoot, projectPath, sessionId);
  if (!artifact) {
    throw new Error(`Archived review handoff "${sessionId}" was not found.`);
  }

  return await applyArchivedHandoffArtifact(artifact, "revert", expectedCurrentFingerprint);
}

export async function reapplyArchivedHandoff(
  storageRoot: string = CONFIG_DIR,
  projectPath: string,
  sessionId: string,
  expectedCurrentFingerprint?: string
): Promise<ArchivedAppliedHandoffArtifact> {
  const artifact = await readArchivedHandoff(storageRoot, projectPath, sessionId);
  if (!artifact) {
    throw new Error(`Archived review handoff "${sessionId}" was not found.`);
  }

  return await applyArchivedHandoffArtifact(artifact, "reapply", expectedCurrentFingerprint);
}

export async function discardPendingHandoff(
  storageRoot: string = CONFIG_DIR,
  projectPath: string,
  sessionId: string
): Promise<PendingHandoffArtifact> {
  const artifact = await readPendingHandoff(storageRoot, projectPath, sessionId);
  if (!artifact) {
    throw new Error(`Pending review handoff "${sessionId}" was not found.`);
  }

  deleteSessionRefs(artifact.sourceRepoPath, artifact.sessionId);
  await deletePendingHandoffFiles(storageRoot, artifact);
  return artifact;
}

export async function createOrAutoApplyHandoff(
  storageRoot: string = CONFIG_DIR,
  options: CreateOrAutoApplyOptions
): Promise<SessionHandoffResult | null> {
  const retained = finalizeSessionWorktree(options.worktree);
  if (!retained?.commitSha) {
    return null;
  }

  const patchPath = getPendingHandoffPatchPath(storageRoot, options.projectPath, options.sessionId);
  const sourceBaselineCommitSha = options.worktree.sourceBaselineCommitSha;
  const trackedRepoFingerprint = options.worktree.trackedRepoFingerprint;
  if (!sourceBaselineCommitSha) {
    throw new Error("Session worktree is missing its source baseline commit.");
  }

  if (!trackedRepoFingerprint) {
    throw new Error("Session worktree is missing its tracked repository fingerprint.");
  }

  const hiddenRef = buildHandoffRef(options.sessionId);
  createHandoffRef(options.worktree.sourceRepoPath, hiddenRef, retained.commitSha);
  options.worktree.finalCommitSha = retained.commitSha;
  options.worktree.finalRef = hiddenRef;
  options.worktree.preserveBranchOnDiscard = false;

  await createBaselineToFinalPatch(
    options.worktree.worktreeProjectPath,
    sourceBaselineCommitSha,
    retained.commitSha,
    patchPath
  );

  const handoffUpdatedAt = Date.now();
  const artifact: PendingHandoffArtifact = {
    sessionId: options.sessionId,
    projectPath: options.projectPath,
    sourceRepoPath: options.worktree.sourceRepoPath,
    logPath: options.logPath,
    hiddenRef,
    patchPath,
    trackedRepoFingerprint,
    commitSha: retained.commitSha,
    state: "pending-apply",
    createdAt: handoffUpdatedAt,
    updatedAt: handoffUpdatedAt,
  };

  if (options.autoApply !== false) {
    try {
      await applyPendingHandoffArtifact(storageRoot, artifact, "auto");
      return {
        handoffStatus: "applied-auto",
        commitSha: artifact.commitSha,
        handoffUpdatedAt,
      };
    } catch (error) {
      if (!isSnapshotMismatchError(error)) {
        throw error;
      }
    }
  }

  await Bun.write(
    getPendingHandoffMetadataPath(storageRoot, options.projectPath, options.sessionId),
    JSON.stringify(artifact, null, 2),
    {
      createPath: true,
    }
  );

  return {
    handoffStatus: "pending-apply",
    commitSha: artifact.commitSha,
    handoffUpdatedAt,
  };
}

export type { ArchivedAppliedHandoffArtifact, PendingHandoffArtifact };
