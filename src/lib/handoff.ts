import { join } from "node:path";
import { CONFIG_DIR } from "@/lib/config";
import type { GitSessionWorktree } from "@/lib/git";
import {
  applyBinaryPatch,
  buildHandoffRef,
  computeWorkingTreeFingerprint,
  createBinaryPatch,
  createHandoffRef,
  finalizeSessionWorktree,
  materializeWorkingTreeCopy,
  materializeWorkingTreeSnapshot,
  removeHandoffRef,
} from "@/lib/git";
import { getProjectStorageDir } from "@/lib/logger";
import type { HandoffStatus, PendingHandoffArtifact } from "@/lib/types";

interface CreateOrAutoApplyOptions {
  sessionId: string;
  projectPath: string;
  logPath: string;
  worktree: GitSessionWorktree;
}

export interface SessionHandoffResult {
  handoffStatus: Extract<HandoffStatus, "applied-auto" | "pending-apply">;
  commitSha: string;
  handoffUpdatedAt: number;
}

const SNAPSHOT_MISMATCH_ERROR_MESSAGE =
  "Current repository state no longer matches the saved review snapshot.";

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
    sourceFingerprint,
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
    typeof sourceFingerprint !== "string" ||
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
    sourceFingerprint,
    commitSha,
    state,
    createdAt,
    updatedAt,
  };
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

async function applyPendingHandoffArtifact(
  storageRoot: string,
  artifact: PendingHandoffArtifact
): Promise<PendingHandoffArtifact> {
  const currentFingerprint = computeWorkingTreeFingerprint(artifact.sourceRepoPath);
  if (currentFingerprint !== artifact.sourceFingerprint) {
    throw new Error(SNAPSHOT_MISMATCH_ERROR_MESSAGE);
  }

  applyBinaryPatch(artifact.sourceRepoPath, artifact.patchPath);
  removeHandoffRef(artifact.sourceRepoPath, artifact.hiddenRef);
  await deletePendingHandoffFiles(storageRoot, artifact);
  return artifact;
}

export async function readPendingHandoff(
  storageRoot: string = CONFIG_DIR,
  projectPath: string,
  sessionId: string
): Promise<PendingHandoffArtifact | null> {
  const file = Bun.file(getPendingHandoffMetadataPath(storageRoot, projectPath, sessionId));
  if (!(await file.exists())) {
    return null;
  }

  try {
    return normalizePendingHandoff(JSON.parse(await file.text()));
  } catch {
    return null;
  }
}

export async function listProjectPendingHandoffs(
  storageRoot: string = CONFIG_DIR,
  projectPath: string
): Promise<PendingHandoffArtifact[]> {
  const handoffsDir = getProjectHandoffsDir(storageRoot, projectPath);
  const artifacts: PendingHandoffArtifact[] = [];
  const glob = new Bun.Glob("*.json");

  try {
    for await (const relativePath of glob.scan({ cwd: handoffsDir })) {
      const artifact = await readPendingHandoff(
        storageRoot,
        projectPath,
        relativePath.replace(/\.json$/u, "")
      );
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

  return artifacts.sort((left, right) => right.updatedAt - left.updatedAt);
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

  return await applyPendingHandoffArtifact(storageRoot, artifact);
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

  removeHandoffRef(artifact.sourceRepoPath, artifact.hiddenRef);
  await deletePendingHandoffFiles(storageRoot, artifact);
  return artifact;
}

export async function createOrAutoApplyHandoff(
  storageRoot: string = CONFIG_DIR,
  options: CreateOrAutoApplyOptions
): Promise<SessionHandoffResult | null> {
  if (!options.worktree.sourceSnapshotDir && !options.worktree.sourceSnapshotPath) {
    throw new Error("Session worktree is missing its source snapshot metadata.");
  }

  const retained = finalizeSessionWorktree(options.worktree);
  if (!retained?.commitSha) {
    return null;
  }

  const patchPath = getPendingHandoffPatchPath(storageRoot, options.projectPath, options.sessionId);
  const sourceSnapshotPath = options.worktree.sourceSnapshotPath ?? `${patchPath}.source`;
  const finalSnapshotPath = `${patchPath}.final`;

  try {
    if (!options.worktree.sourceSnapshotPath && options.worktree.sourceSnapshotDir) {
      materializeWorkingTreeSnapshot(options.worktree.sourceSnapshotDir, sourceSnapshotPath);
      options.worktree.sourceSnapshotPath = sourceSnapshotPath;
    }

    const sourceFingerprint = options.worktree.sourceFingerprint;
    if (!sourceFingerprint) {
      throw new Error("Session worktree is missing its source fingerprint.");
    }

    materializeWorkingTreeCopy(options.worktree.worktreeProjectPath, finalSnapshotPath);
    await createBinaryPatch(sourceSnapshotPath, finalSnapshotPath, patchPath);

    const hiddenRef = buildHandoffRef(options.sessionId);
    createHandoffRef(options.worktree.sourceRepoPath, hiddenRef, retained.commitSha);
    options.worktree.preserveBranchOnDiscard = false;

    const handoffUpdatedAt = Date.now();
    const artifact: PendingHandoffArtifact = {
      sessionId: options.sessionId,
      projectPath: options.projectPath,
      sourceRepoPath: options.worktree.sourceRepoPath,
      logPath: options.logPath,
      hiddenRef,
      patchPath,
      sourceFingerprint,
      commitSha: retained.commitSha,
      state: "pending-apply",
      createdAt: handoffUpdatedAt,
      updatedAt: handoffUpdatedAt,
    };

    try {
      await applyPendingHandoffArtifact(storageRoot, artifact);
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
  } finally {
    Bun.spawnSync(["rm", "-rf", finalSnapshotPath], {
      stdout: "ignore",
      stderr: "ignore",
    });
  }
}

export type { HandoffStatus, PendingHandoffArtifact };
