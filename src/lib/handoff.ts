import { join } from "node:path";
import { CONFIG_DIR } from "@/lib/config";
import type { GitSessionWorktree } from "@/lib/git";
import {
  applyBinaryPatch,
  applyBinaryPatchWithThreeWay,
  buildHandoffRef,
  computeWorkingTreeFingerprint,
  createBaselineToFinalPatch,
  createCheckpoint,
  createHandoffRef,
  deleteSessionRefs,
  discardCheckpoint,
  finalizeSessionWorktree,
  hasCleanWorktreeState,
  hasUnmergedPaths,
  rollbackToCheckpoint,
  unstageWorktreeChanges,
} from "@/lib/git";
import { appendLog, getProjectStorageDir } from "@/lib/logger";
import type { HandoffStatus, PendingHandoffArtifact } from "@/lib/types";

type HandoffApplyMode = "auto" | "manual";

interface CreateOrAutoApplyOptions {
  sessionId: string;
  projectPath: string;
  logPath: string;
  worktree: GitSessionWorktree;
  handoffId?: string;
  autoApply?: boolean;
}

export interface SessionHandoffResult {
  handoffId: string;
  handoffStatus: Extract<HandoffStatus, "applied-auto" | "pending-apply">;
  commitSha: string;
  handoffUpdatedAt: number;
}

class PendingHandoffApplyConflictError extends Error {
  artifact: PendingHandoffArtifact;

  constructor(artifact: PendingHandoffArtifact) {
    super(
      `Review handoff "${artifact.handoffId}" has conflicts during apply. Resolve or abort the Git conflict, then rerun any rr command to reconcile the handoff automatically.`
    );
    this.name = "PendingHandoffApplyConflictError";
    this.artifact = artifact;
  }
}

const SNAPSHOT_MISMATCH_ERROR_MESSAGE =
  "Current repository state no longer matches the saved review baseline.";

function createHandoffId(sessionId: string): string {
  return `${sessionId}-handoff-${crypto.randomUUID()}`;
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isSnapshotMismatchError(error: unknown): error is Error {
  return error instanceof Error && error.message === SNAPSHOT_MISMATCH_ERROR_MESSAGE;
}

function getProjectHandoffsDir(storageRoot: string = CONFIG_DIR, projectPath: string): string {
  return join(getProjectStorageDir(storageRoot, projectPath), "handoffs");
}

function getPendingHandoffMetadataPath(
  storageRoot: string = CONFIG_DIR,
  projectPath: string,
  handoffId: string
): string {
  return join(getProjectHandoffsDir(storageRoot, projectPath), `${handoffId}.json`);
}

function getPendingHandoffPatchPath(
  storageRoot: string = CONFIG_DIR,
  projectPath: string,
  handoffId: string
): string {
  return join(getProjectHandoffsDir(storageRoot, projectPath), `${handoffId}.patch`);
}

function normalizePendingHandoff(raw: unknown): PendingHandoffArtifact | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const candidate = raw as Record<string, unknown>;
  const {
    handoffId,
    sessionId,
    projectPath,
    sourceRepoPath,
    logPath,
    hiddenRef,
    patchPath,
    sourceBaselineFingerprint,
    commitSha,
    state,
    createdAt,
    updatedAt,
    applyStartedAt,
    applyStartFingerprint,
  } = candidate;
  if (
    typeof handoffId !== "string" ||
    typeof sessionId !== "string" ||
    typeof projectPath !== "string" ||
    typeof sourceRepoPath !== "string" ||
    typeof logPath !== "string" ||
    typeof hiddenRef !== "string" ||
    typeof patchPath !== "string" ||
    typeof sourceBaselineFingerprint !== "string" ||
    typeof commitSha !== "string" ||
    typeof createdAt !== "number" ||
    typeof updatedAt !== "number" ||
    (state !== "pending-apply" && state !== "apply-conflicted")
  ) {
    return null;
  }

  if (
    state === "apply-conflicted" &&
    (typeof applyStartedAt !== "number" || typeof applyStartFingerprint !== "string")
  ) {
    return null;
  }

  return {
    handoffId,
    sessionId,
    projectPath,
    sourceRepoPath,
    logPath,
    hiddenRef,
    patchPath,
    sourceBaselineFingerprint,
    commitSha,
    state,
    createdAt,
    updatedAt,
    applyStartedAt: typeof applyStartedAt === "number" ? applyStartedAt : undefined,
    applyStartFingerprint:
      typeof applyStartFingerprint === "string" ? applyStartFingerprint : undefined,
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

async function writePendingHandoff(
  storageRoot: string,
  artifact: PendingHandoffArtifact
): Promise<void> {
  await Bun.write(
    getPendingHandoffMetadataPath(storageRoot, artifact.projectPath, artifact.handoffId),
    JSON.stringify(artifact, null, 2),
    {
      createPath: true,
    }
  );
}

async function appendHandoffStatusLog(
  artifact: PendingHandoffArtifact,
  handoffStatus: HandoffStatus
): Promise<void> {
  await appendLog(artifact.logPath, {
    type: "handoff",
    timestamp: Date.now(),
    handoffId: artifact.handoffId,
    handoffStatus,
    commitSha: artifact.commitSha,
  });
}

async function deletePendingHandoffFiles(
  storageRoot: string,
  artifact: PendingHandoffArtifact
): Promise<void> {
  await Bun.file(
    getPendingHandoffMetadataPath(storageRoot, artifact.projectPath, artifact.handoffId)
  )
    .delete()
    .catch(() => {});
  await Bun.file(artifact.patchPath)
    .delete()
    .catch(() => {});
}

function deleteHandoffRefs(artifact: Pick<PendingHandoffArtifact, "sourceRepoPath" | "handoffId">) {
  deleteSessionRefs(artifact.sourceRepoPath, artifact.handoffId);
}

function restorePendingApplyArtifact(artifact: PendingHandoffArtifact): PendingHandoffArtifact {
  return {
    handoffId: artifact.handoffId,
    sessionId: artifact.sessionId,
    projectPath: artifact.projectPath,
    sourceRepoPath: artifact.sourceRepoPath,
    logPath: artifact.logPath,
    hiddenRef: artifact.hiddenRef,
    patchPath: artifact.patchPath,
    sourceBaselineFingerprint: artifact.sourceBaselineFingerprint,
    commitSha: artifact.commitSha,
    state: "pending-apply",
    createdAt: artifact.createdAt,
    updatedAt: Date.now(),
  };
}

async function reconcilePendingHandoffArtifact(
  storageRoot: string,
  artifact: PendingHandoffArtifact
): Promise<PendingHandoffArtifact | null> {
  if (artifact.state !== "apply-conflicted") {
    return artifact;
  }

  if (hasUnmergedPaths(artifact.sourceRepoPath)) {
    return artifact;
  }

  const currentFingerprint = computeWorkingTreeFingerprint(artifact.sourceRepoPath);
  if (currentFingerprint === artifact.applyStartFingerprint) {
    const restored = restorePendingApplyArtifact(artifact);
    await writePendingHandoff(storageRoot, restored);
    await appendHandoffStatusLog(restored, "pending-apply");
    return restored;
  }

  deleteHandoffRefs(artifact);
  await deletePendingHandoffFiles(storageRoot, artifact);
  await appendHandoffStatusLog(artifact, "applied-manual");
  return null;
}

async function applyPendingHandoffWithDivergedRepo(
  storageRoot: string,
  artifact: PendingHandoffArtifact,
  currentFingerprint: string
): Promise<PendingHandoffArtifact> {
  if (
    !hasCleanWorktreeState(artifact.sourceRepoPath) ||
    hasUnmergedPaths(artifact.sourceRepoPath)
  ) {
    throw new Error(
      `Review handoff "${artifact.handoffId}" requires a clean working tree before rr apply.`
    );
  }

  const checkpoint = createCheckpoint(artifact.sourceRepoPath, `apply-${artifact.handoffId}`);

  try {
    const applyResult = applyBinaryPatchWithThreeWay(artifact.sourceRepoPath, artifact.patchPath);
    if (applyResult === "conflicted") {
      const applyConflicted: PendingHandoffArtifact = {
        ...artifact,
        state: "apply-conflicted",
        applyStartedAt: Date.now(),
        applyStartFingerprint: currentFingerprint,
        updatedAt: Date.now(),
      };
      await writePendingHandoff(storageRoot, applyConflicted);
      await appendHandoffStatusLog(applyConflicted, "apply-conflicted");
      discardCheckpoint(artifact.sourceRepoPath, checkpoint);
      throw new PendingHandoffApplyConflictError(applyConflicted);
    }

    unstageWorktreeChanges(artifact.sourceRepoPath);
    deleteHandoffRefs(artifact);
    await deletePendingHandoffFiles(storageRoot, artifact);
    discardCheckpoint(artifact.sourceRepoPath, checkpoint);
    return artifact;
  } catch (error) {
    if (error instanceof PendingHandoffApplyConflictError) {
      throw error;
    }

    rollbackToCheckpoint(artifact.sourceRepoPath, checkpoint);
    throw error;
  }
}

async function applyPendingHandoffArtifact(
  storageRoot: string,
  artifact: PendingHandoffArtifact,
  applyMode: HandoffApplyMode
): Promise<PendingHandoffArtifact> {
  if (artifact.state === "apply-conflicted") {
    throw new Error(
      `Review handoff "${artifact.handoffId}" is waiting for Git conflicts to be resolved or aborted.`
    );
  }

  const currentFingerprint = computeWorkingTreeFingerprint(artifact.sourceRepoPath);
  if (currentFingerprint === artifact.sourceBaselineFingerprint) {
    applyBinaryPatch(artifact.sourceRepoPath, artifact.patchPath);
    deleteHandoffRefs(artifact);
    await deletePendingHandoffFiles(storageRoot, artifact);
    return artifact;
  }

  if (applyMode === "manual") {
    return await applyPendingHandoffWithDivergedRepo(storageRoot, artifact, currentFingerprint);
  }

  throw new Error(SNAPSHOT_MISMATCH_ERROR_MESSAGE);
}

async function readPendingHandoffArtifact(
  storageRoot: string = CONFIG_DIR,
  projectPath: string,
  handoffId: string
): Promise<PendingHandoffArtifact | null> {
  return await readArtifactFile(
    getPendingHandoffMetadataPath(storageRoot, projectPath, handoffId),
    normalizePendingHandoff
  );
}

export async function readPendingHandoff(
  storageRoot: string = CONFIG_DIR,
  projectPath: string,
  handoffId: string
): Promise<PendingHandoffArtifact | null> {
  const artifact = await readPendingHandoffArtifact(storageRoot, projectPath, handoffId);
  if (!artifact) {
    return null;
  }

  return await reconcilePendingHandoffArtifact(storageRoot, artifact);
}

export async function listProjectPendingHandoffs(
  storageRoot: string = CONFIG_DIR,
  projectPath: string
): Promise<PendingHandoffArtifact[]> {
  return await listArtifacts(
    getProjectHandoffsDir(storageRoot, projectPath),
    (handoffId) => readPendingHandoff(storageRoot, projectPath, handoffId),
    (left, right) => right.updatedAt - left.updatedAt
  );
}

export async function applyPendingHandoff(
  storageRoot: string = CONFIG_DIR,
  projectPath: string,
  handoffId: string
): Promise<PendingHandoffArtifact> {
  const artifact = await readPendingHandoff(storageRoot, projectPath, handoffId);
  if (!artifact) {
    throw new Error(`Pending review handoff "${handoffId}" was not found.`);
  }

  return await applyPendingHandoffArtifact(storageRoot, artifact, "manual");
}

export async function discardPendingHandoff(
  storageRoot: string = CONFIG_DIR,
  projectPath: string,
  handoffId: string
): Promise<PendingHandoffArtifact> {
  const artifact = await readPendingHandoff(storageRoot, projectPath, handoffId);
  if (!artifact) {
    throw new Error(`Pending review handoff "${handoffId}" was not found.`);
  }

  if (artifact.state === "apply-conflicted") {
    throw new Error(
      `Review handoff "${artifact.handoffId}" is waiting for Git conflicts to be resolved or aborted.`
    );
  }

  deleteHandoffRefs(artifact);
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
  options.worktree.preserveBranchOnDiscard = false;

  const handoffId = options.handoffId ?? createHandoffId(options.sessionId);
  const patchPath = getPendingHandoffPatchPath(storageRoot, options.projectPath, handoffId);
  const sourceBaselineCommitSha = options.worktree.sourceBaselineCommitSha;
  const sourceBaselineFingerprint = options.worktree.sourceBaselineFingerprint;
  if (!sourceBaselineCommitSha) {
    throw new Error("Session worktree is missing its source baseline commit.");
  }

  if (!sourceBaselineFingerprint) {
    throw new Error("Session worktree is missing its source baseline fingerprint.");
  }

  await createBaselineToFinalPatch(
    options.worktree.worktreeProjectPath,
    sourceBaselineCommitSha,
    retained.commitSha,
    patchPath
  );

  const hiddenRef = buildHandoffRef(handoffId);
  createHandoffRef(options.worktree.sourceRepoPath, hiddenRef, retained.commitSha);
  options.worktree.finalCommitSha = retained.commitSha;
  options.worktree.finalRef = hiddenRef;

  const handoffUpdatedAt = Date.now();
  const artifact: PendingHandoffArtifact = {
    handoffId,
    sessionId: options.sessionId,
    projectPath: options.projectPath,
    sourceRepoPath: options.worktree.sourceRepoPath,
    logPath: options.logPath,
    hiddenRef,
    patchPath,
    sourceBaselineFingerprint,
    commitSha: retained.commitSha,
    state: "pending-apply",
    createdAt: handoffUpdatedAt,
    updatedAt: handoffUpdatedAt,
  };

  if (options.autoApply !== false) {
    try {
      await applyPendingHandoffArtifact(storageRoot, artifact, "auto");
      return {
        handoffId,
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

  await writePendingHandoff(storageRoot, artifact);

  return {
    handoffId,
    handoffStatus: "pending-apply",
    commitSha: artifact.commitSha,
    handoffUpdatedAt,
  };
}

export type { PendingHandoffArtifact };
