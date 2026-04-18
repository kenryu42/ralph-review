import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { CONFIG_DIR } from "./config";
import { getProjectWorktreesDir } from "./logger";

function runGitForStdout(cwd: string, args: string[]): string | undefined {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return undefined;
  return result.stdout.toString().trim();
}

function runGit(cwd: string, args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
  };
}

function runCommand(
  cwd: string,
  command: string[]
): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(command, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
  };
}

async function runCommandAsync(
  cwd: string,
  command: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(command, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  return {
    exitCode,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  };
}

function pruneEmptyDirectory(cwd: string, directoryPath: string): void {
  const probe = runCommand(cwd, [
    "find",
    directoryPath,
    "-mindepth",
    "1",
    "-maxdepth",
    "1",
    "-print",
    "-quit",
  ]);
  if (probe.exitCode !== 0 || probe.stdout.length > 0) {
    return;
  }

  // Best-effort parent cleanup: a concurrent session may create siblings at any time.
  runCommand(cwd, ["rmdir", directoryPath]);
}

async function runGitForStdoutAsync(cwd: string, args: string[]): Promise<string | undefined> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) return undefined;
  return (await new Response(proc.stdout).text()).trim();
}

export function ensureGitRepository(path: string): boolean {
  const output = runGitForStdout(path, ["rev-parse", "--is-inside-work-tree"]);
  return output === "true";
}

/** Preferred for UI refresh loops (non-blocking). */
export async function ensureGitRepositoryAsync(path: string): Promise<boolean> {
  const output = await runGitForStdoutAsync(path, ["rev-parse", "--is-inside-work-tree"]);
  return output === "true";
}

function resolveRepositoryRoot(path: string): string | undefined {
  return runGitForStdout(path, ["rev-parse", "--show-toplevel"]);
}

export async function resolveRepositoryRootAsync(path: string): Promise<string | undefined> {
  return await runGitForStdoutAsync(path, ["rev-parse", "--show-toplevel"]);
}

function resolveHead(repoRoot: string): string | undefined {
  return runGitForStdout(repoRoot, ["rev-parse", "--verify", "HEAD"]);
}

function resolveBranchRef(repoRoot: string, branch: string): string | undefined {
  return runGitForStdout(repoRoot, ["rev-parse", "--verify", branch]);
}

function resolveUpstreamIfRemoteAhead(repoRoot: string, branch: string): string | undefined {
  const upstream = runGitForStdout(repoRoot, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    `${branch}@{upstream}`,
  ]);

  if (!upstream) return undefined;

  const counts = runGitForStdout(repoRoot, [
    "rev-list",
    "--left-right",
    "--count",
    `${branch}...${upstream}`,
  ]);

  if (!counts) return undefined;

  const parts = counts.split(/\s+/);
  const right = parseInt(parts[1] ?? "0", 10);

  if (right > 0) {
    return upstream;
  }

  return undefined;
}

/**
 * Returns the merge-base commit between HEAD and the target branch.
 *
 * If the remote tracking branch is ahead of the local branch,
 * uses the upstream ref for more accurate comparison.
 *
 * Returns undefined if:
 * - Not a git repository
 * - HEAD is unborn (no commits yet)
 * - Target branch doesn't exist
 *
 * @param repoPath - Path to a directory within the git repository
 * @param branch - The target branch name to compare against (e.g., "main")
 * @returns The merge-base commit SHA, or undefined
 */
export function mergeBaseWithHead(repoPath: string, branch: string): string | undefined {
  if (!ensureGitRepository(repoPath)) {
    return undefined;
  }

  const repoRoot = resolveRepositoryRoot(repoPath);
  if (!repoRoot) {
    return undefined;
  }

  const head = resolveHead(repoRoot);
  if (!head) {
    return undefined;
  }

  const branchRef = resolveBranchRef(repoRoot, branch);
  if (!branchRef) {
    return undefined;
  }

  const upstream = resolveUpstreamIfRemoteAhead(repoRoot, branch);
  let preferredRef = branchRef;

  if (upstream) {
    const upstreamRef = resolveBranchRef(repoRoot, upstream);
    if (upstreamRef) {
      preferredRef = upstreamRef;
    }
  }

  return runGitForStdout(repoRoot, ["merge-base", head, preferredRef]);
}

const CHECKPOINT_REF_PREFIX = "refs/ralph-review/checkpoints";
const CHECKPOINT_SNAPSHOT_DIR = "ralph-review/checkpoints";
const CHECKPOINT_SNAPSHOT_ARCHIVE = "worktree.tar";
const CHECKPOINT_SNAPSHOT_INDEX = "index";

export type GitCheckpoint =
  | {
      kind: "clean";
      id: string;
    }
  | {
      kind: "snapshot";
      id: string;
      snapshotDir: string;
    }
  | {
      kind: "ref";
      id: string;
      ref: string;
      commit: string;
    };

export interface GitSessionWorktree {
  sourceProjectPath: string;
  sourceRepoPath: string;
  worktreeProjectPath: string;
  agentProjectPath: string;
  retainedBranch: string;
  headKind: "detached";
  baselineCommitSha?: string;
  baselineRef?: string;
  sourceBaselineCommitSha?: string;
  sourceBaselineRef?: string;
  sourceBaselineFingerprint?: string;
  finalCommitSha?: string;
  finalRef?: string;
  preserveBranchOnDiscard?: boolean;
}

export interface RetainedSessionWorktree {
  worktreeProjectPath: string;
  worktreeBranch: string;
  mergeReady: boolean;
  commitSha?: string;
}

function assertGitOk(cwd: string, args: string[], context: string): string {
  const result = runGit(cwd, args);
  if (result.exitCode !== 0) {
    const details = result.stderr || result.stdout || "unknown git error";
    throw new Error(`${context}: git ${args.join(" ")} failed: ${details}`);
  }
  return result.stdout;
}

function assertCommandOk(cwd: string, command: string[], context: string): string {
  const result = runCommand(cwd, command);
  if (result.exitCode !== 0) {
    const details = result.stderr || result.stdout || "unknown command error";
    throw new Error(`${context}: ${command.join(" ")} failed: ${details}`);
  }
  return result.stdout;
}

async function assertCommandOkAsync(
  cwd: string,
  command: string[],
  context: string
): Promise<string> {
  const result = await runCommandAsync(cwd, command);
  if (result.exitCode !== 0) {
    const details = result.stderr || result.stdout || "unknown command error";
    throw new Error(`${context}: ${command.join(" ")} failed: ${details}`);
  }
  return result.stdout;
}

function assertGitOkWithEnv(
  cwd: string,
  args: string[],
  env: Record<string, string>,
  context: string
): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    const details = result.stderr.toString().trim() || result.stdout.toString().trim();
    throw new Error(`${context}: git ${args.join(" ")} failed: ${details || "unknown git error"}`);
  }

  return result.stdout.toString().trim();
}

async function assertGitOkWithEnvAsync(
  cwd: string,
  args: string[],
  env: Record<string, string>,
  context: string
): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `${context}: git ${args.join(" ")} failed: ${stderr.trim() || stdout.trim() || "unknown git error"}`
    );
  }

  return stdout.trim();
}

function normalizeGitArtifactId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-");
}

function hasInitialCommit(repoPath: string): boolean {
  return runGit(repoPath, ["rev-parse", "--verify", "HEAD"]).exitCode === 0;
}

function resolveStashTop(repoPath: string): string | undefined {
  const result = runGit(repoPath, ["rev-parse", "--verify", "refs/stash"]);
  if (result.exitCode !== 0) {
    return undefined;
  }
  return result.stdout;
}

function resolveGitDir(repoRoot: string, context: string): string {
  const gitDir = assertGitOk(repoRoot, ["rev-parse", "--git-dir"], context);
  return toAbsolutePath(repoRoot, gitDir);
}

function createTemporaryIndexPath(namespace: string): string {
  return join(
    tmpdir(),
    `ralph-review-index-${namespace}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
  );
}

function createSnapshotDir(
  absoluteGitDir: string,
  snapshotNamespace: string,
  category: string
): string {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  return join(absoluteGitDir, category, `${snapshotNamespace}-${uniqueSuffix}`);
}

function buildSessionRef(sessionId: string, kind: "baseline" | "source" | "final"): string {
  return `refs/ralph-review/sessions/${normalizeGitArtifactId(sessionId)}/${kind}`;
}

function buildSessionBaselineRef(sessionId: string): string {
  return buildSessionRef(sessionId, "baseline");
}

function buildSessionSourceBaselineRef(sessionId: string): string {
  return buildSessionRef(sessionId, "source");
}

function buildSessionFinalRef(sessionId: string): string {
  return buildSessionRef(sessionId, "final");
}

function listSessionRefs(sessionId: string): string[] {
  return [
    buildSessionSourceBaselineRef(sessionId),
    buildSessionBaselineRef(sessionId),
    buildSessionFinalRef(sessionId),
  ];
}

export function deleteSessionRefs(repoPath: string, sessionId: string): void {
  for (const ref of listSessionRefs(sessionId)) {
    const result = runGit(repoPath, ["update-ref", "-d", ref]);
    if (result.exitCode !== 0 && !result.stderr.includes("does not exist")) {
      throw new Error(`Failed to delete session ref ${ref}: ${result.stderr || result.stdout}`);
    }
  }
}

function resolveAvailableBranchName(repoPath: string, baseBranch: string): string {
  if (
    runGit(repoPath, ["show-ref", "--verify", "--quiet", `refs/heads/${baseBranch}`]).exitCode !== 0
  ) {
    return baseBranch;
  }

  return `${baseBranch}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
}

function createWorktreePath(
  storageRoot: string,
  sourceProjectPath: string,
  worktreeId: string
): string {
  return join(
    getProjectWorktreesDir(storageRoot, sourceProjectPath),
    `${worktreeId}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
  );
}

function resolveAgentProjectPath(
  sourceRepoPath: string,
  sourceProjectPath: string,
  worktreeProjectPath: string
): string {
  const projectSubpath = relative(sourceRepoPath, sourceProjectPath);
  return projectSubpath ? join(worktreeProjectPath, projectSubpath) : worktreeProjectPath;
}

function toAbsolutePath(basePath: string, path: string): string {
  return isAbsolute(path) ? path : join(basePath, path);
}

function resolveCanonicalDirectoryPath(path: string): string | undefined {
  const result = Bun.spawnSync(["pwd", "-P"], {
    cwd: path,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    return undefined;
  }
  return result.stdout.toString().trim();
}

function collectComparableDirectoryPaths(path: string): Set<string> {
  const comparablePaths = new Set<string>([path]);
  const canonicalPath = resolveCanonicalDirectoryPath(path);
  if (canonicalPath) {
    comparablePaths.add(canonicalPath);
  }
  return comparablePaths;
}

function seedTemporaryIndex(repoRoot: string, tempIndexPath: string, context: string): void {
  const gitDir = resolveGitDir(repoRoot, context);
  const sourceIndexPath = join(gitDir, "index");

  if (runCommand(repoRoot, ["test", "-f", sourceIndexPath]).exitCode === 0) {
    assertCommandOk(
      repoRoot,
      ["cp", sourceIndexPath, tempIndexPath],
      `Failed to seed temporary index ${tempIndexPath}`
    );
    return;
  }

  assertCommandOk(
    repoRoot,
    ["sh", "-lc", `: > '${tempIndexPath.replace(/'/g, "'\\''")}'`],
    `Failed to initialize temporary index ${tempIndexPath}`
  );
}

function createCommitFromTree(
  repoRoot: string,
  treeSha: string,
  message: string,
  context: string
): string {
  const head = resolveHead(repoRoot);
  const args = [
    "-c",
    "user.name=Ralph Review",
    "-c",
    "user.email=ralph-review@local",
    "commit-tree",
    treeSha,
  ];

  if (head) {
    args.push("-p", head);
  }

  args.push("-m", message);
  return assertGitOk(repoRoot, args, context);
}

function createCommitFromWorktreeState(
  repoPath: string,
  sessionId: string,
  options: {
    message: string;
    refKind?: "baseline" | "source" | "final";
    updateRef?: boolean;
  }
): { commitSha: string; ref?: string; treeSha: string; fingerprint: string } {
  const context = `Failed to create ${options.refKind ?? "temporary"} commit`;
  const repoRoot = assertGitOk(repoPath, ["rev-parse", "--show-toplevel"], context);
  const tempIndexPath = createTemporaryIndexPath(options.refKind ?? "temp");

  try {
    seedTemporaryIndex(repoRoot, tempIndexPath, context);

    const env = {
      GIT_INDEX_FILE: tempIndexPath,
    };
    assertGitOkWithEnv(repoRoot, ["add", "-A", "--", "."], env, context);
    const treeSha = assertGitOkWithEnv(repoRoot, ["write-tree"], env, context);
    const commitSha = createCommitFromTree(repoRoot, treeSha, options.message, context);

    if (options.updateRef === false || !options.refKind) {
      return {
        commitSha,
        treeSha,
        fingerprint: treeSha,
      };
    }

    const ref = buildSessionRef(sessionId, options.refKind);
    assertGitOk(repoRoot, ["update-ref", ref, commitSha], `Failed to write session ref ${ref}`);

    return {
      commitSha,
      ref,
      treeSha,
      fingerprint: treeSha,
    };
  } finally {
    runCommand(repoRoot, ["rm", "-f", tempIndexPath]);
  }
}

function createWorktreeStateTree(repoPath: string, context: string): string {
  const repoRoot = assertGitOk(repoPath, ["rev-parse", "--show-toplevel"], context);
  const tempIndexPath = createTemporaryIndexPath("worktree");

  try {
    seedTemporaryIndex(repoRoot, tempIndexPath, context);
    const env = {
      GIT_INDEX_FILE: tempIndexPath,
    };
    assertGitOkWithEnv(repoRoot, ["add", "-A", "--", "."], env, context);
    return assertGitOkWithEnv(repoRoot, ["write-tree"], env, context);
  } finally {
    runCommand(repoRoot, ["rm", "-f", tempIndexPath]);
  }
}

export function createBaselineCommit(
  repoPath: string,
  sessionId: string,
  options: {
    refKind?: "baseline" | "source";
  } = {}
): { commitSha: string; ref: string; fingerprint: string } {
  const created = createCommitFromWorktreeState(repoPath, sessionId, {
    message: `rr: ${options.refKind ?? "baseline"} for ${normalizeGitArtifactId(sessionId)}`,
    refKind: options.refKind ?? "baseline",
  });

  if (!created.ref) {
    throw new Error("Baseline creation did not produce a ref.");
  }

  return {
    commitSha: created.commitSha,
    ref: created.ref,
    fingerprint: created.fingerprint,
  };
}

async function computeWorkingTreeFingerprintInternalAsync(repoPath: string): Promise<string> {
  const repoRoot = assertGitOk(
    repoPath,
    ["rev-parse", "--show-toplevel"],
    "Failed to resolve repository root for worktree fingerprint"
  );
  const tempIndexPath = createTemporaryIndexPath("worktree-async");

  try {
    seedTemporaryIndex(repoRoot, tempIndexPath, "Failed to fingerprint worktree state");
    await assertGitOkWithEnvAsync(
      repoRoot,
      ["add", "-A", "--", "."],
      {
        GIT_INDEX_FILE: tempIndexPath,
      },
      "Failed to fingerprint worktree state"
    );
    return await assertGitOkWithEnvAsync(
      repoRoot,
      ["write-tree"],
      {
        GIT_INDEX_FILE: tempIndexPath,
      },
      "Failed to fingerprint worktree state"
    );
  } finally {
    runCommand(repoRoot, ["rm", "-f", tempIndexPath]);
  }
}

export function computeWorkingTreeFingerprint(repoPath: string): string {
  return createWorktreeStateTree(repoPath, "Failed to fingerprint worktree state");
}

export async function computeWorkingTreeFingerprintAsync(repoPath: string): Promise<string> {
  return await computeWorkingTreeFingerprintInternalAsync(repoPath);
}

export async function createBaselineToFinalPatch(
  repoPath: string,
  baselineSha: string,
  finalSha: string,
  patchPath: string
): Promise<string> {
  const result = Bun.spawnSync(
    ["git", "diff", "--binary", "--no-renames", `${baselineSha}..${finalSha}`],
    {
      cwd: repoPath,
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString().trim();

  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Error(
      `Failed to create handoff patch: ${stderr || stdout.trim() || "git diff failed"}`
    );
  }

  const patchDir = dirname(patchPath);
  assertCommandOk(repoPath, ["mkdir", "-p", patchDir], "Failed to create handoff patch directory");
  await Bun.write(patchPath, stdout, { createPath: true });
  return stdout;
}

export function createSessionWorktreeAt(
  sourceProjectPath: string,
  worktreeId: string,
  startPoint: string,
  storageRoot: string = CONFIG_DIR
): GitSessionWorktree {
  const normalizedId = normalizeGitArtifactId(worktreeId);
  const sourceRepoPath = assertGitOk(
    sourceProjectPath,
    ["rev-parse", "--show-toplevel"],
    "Failed to resolve source repository root"
  );
  const worktreeProjectPath = createWorktreePath(storageRoot, sourceProjectPath, normalizedId);
  const retainedBranch = resolveAvailableBranchName(
    sourceProjectPath,
    `rr-worktree-${normalizedId}`
  );
  const worktree: GitSessionWorktree = {
    sourceProjectPath,
    sourceRepoPath,
    worktreeProjectPath,
    agentProjectPath: resolveAgentProjectPath(
      sourceRepoPath,
      sourceProjectPath,
      worktreeProjectPath
    ),
    retainedBranch,
    headKind: "detached",
    preserveBranchOnDiscard: false,
  };

  try {
    assertCommandOk(
      sourceRepoPath,
      ["mkdir", "-p", getProjectWorktreesDir(storageRoot, sourceProjectPath)],
      "Failed to prepare session worktree directory"
    );
    assertGitOk(
      sourceProjectPath,
      ["worktree", "add", "--detach", worktreeProjectPath, startPoint],
      "Failed to create detached session worktree"
    );
    return worktree;
  } catch (error) {
    try {
      discardSessionWorktree(worktree);
    } catch (cleanupError) {
      throw new Error(`${error} Cleanup also failed: ${cleanupError}`);
    }
    throw error;
  }
}

export function createSessionWorktree(
  sourceProjectPath: string,
  worktreeId: string,
  storageRoot: string = CONFIG_DIR
): GitSessionWorktree {
  const sourceBaseline = createBaselineCommit(sourceProjectPath, worktreeId, {
    refKind: "source",
  });
  const baselineRef = buildSessionBaselineRef(worktreeId);
  assertGitOk(
    sourceProjectPath,
    ["update-ref", baselineRef, sourceBaseline.commitSha],
    `Failed to write session ref ${baselineRef}`
  );

  const worktree = createSessionWorktreeAt(
    sourceProjectPath,
    worktreeId,
    sourceBaseline.commitSha,
    storageRoot
  );
  worktree.baselineCommitSha = sourceBaseline.commitSha;
  worktree.baselineRef = baselineRef;
  worktree.sourceBaselineCommitSha = sourceBaseline.commitSha;
  worktree.sourceBaselineRef = sourceBaseline.ref;
  worktree.sourceBaselineFingerprint = sourceBaseline.fingerprint;
  return worktree;
}

interface ApplyBinaryPatchOptions {
  reverse?: boolean;
}

export function applyBinaryPatch(
  repoPath: string,
  patchPath: string,
  options: ApplyBinaryPatchOptions = {}
): void {
  const applyArgs = ["apply"];
  if (options.reverse) {
    applyArgs.push("--reverse");
  }
  applyArgs.push("--check", "--binary", patchPath);
  assertGitOk(repoPath, applyArgs, "Failed to validate handoff patch");
  const writeArgs = ["apply"];
  if (options.reverse) {
    writeArgs.push("--reverse");
  }
  writeArgs.push("--binary", patchPath);
  assertGitOk(repoPath, writeArgs, "Failed to apply handoff patch");
}

export async function applyBinaryPatchAsync(
  repoPath: string,
  patchPath: string,
  options: ApplyBinaryPatchOptions = {}
): Promise<void> {
  const applyArgs = ["git", "apply"];
  if (options.reverse) {
    applyArgs.push("--reverse");
  }
  applyArgs.push("--check", "--binary", patchPath);
  await assertCommandOkAsync(repoPath, applyArgs, "Failed to validate handoff patch");

  const writeArgs = ["git", "apply"];
  if (options.reverse) {
    writeArgs.push("--reverse");
  }
  writeArgs.push("--binary", patchPath);
  await assertCommandOkAsync(repoPath, writeArgs, "Failed to apply handoff patch");
}

function createSnapshotCheckpoint(repoPath: string, normalizedId: string): GitCheckpoint {
  const repoRoot = resolveRepositoryRoot(repoPath);
  if (!repoRoot) {
    throw new Error("Failed to resolve repository root");
  }
  const absoluteGitDir = resolveGitDir(repoRoot, "Failed to resolve git directory");
  const snapshotDir = createSnapshotDir(absoluteGitDir, normalizedId, CHECKPOINT_SNAPSHOT_DIR);
  const archivePath = join(snapshotDir, CHECKPOINT_SNAPSHOT_ARCHIVE);
  const gitIndexPath = join(absoluteGitDir, "index");
  const snapshotIndexPath = join(snapshotDir, CHECKPOINT_SNAPSHOT_INDEX);

  assertCommandOk(repoRoot, ["mkdir", "-p", snapshotDir], "Failed to create snapshot checkpoint");
  assertCommandOk(
    repoRoot,
    ["tar", "-C", repoRoot, "--exclude=.git", "-cf", archivePath, "."],
    "Failed to capture checkpoint snapshot"
  );

  if (runCommand(repoRoot, ["test", "-f", gitIndexPath]).exitCode === 0) {
    assertCommandOk(
      repoRoot,
      ["cp", gitIndexPath, snapshotIndexPath],
      "Failed to capture checkpoint index snapshot"
    );
  }

  return {
    kind: "snapshot",
    id: normalizedId,
    snapshotDir,
  };
}

export function createCheckpoint(repoPath: string, checkpointId: string): GitCheckpoint {
  const normalizedId = normalizeGitArtifactId(checkpointId);
  if (!hasInitialCommit(repoPath)) {
    return createSnapshotCheckpoint(repoPath, normalizedId);
  }

  const label = `rr-checkpoint-${normalizedId}`;
  const stashTopBefore = resolveStashTop(repoPath);
  assertGitOk(
    repoPath,
    // Intentionally exclude gitignored files to avoid checkpointing secrets/caches.
    ["stash", "push", "--include-untracked", "-m", label],
    "Failed to create checkpoint stash"
  );
  const stashTopAfter = resolveStashTop(repoPath);

  if (!stashTopAfter || stashTopAfter === stashTopBefore) {
    return {
      kind: "clean",
      id: normalizedId,
    };
  }

  const checkpointRef = `${CHECKPOINT_REF_PREFIX}/${normalizedId}`;
  assertGitOk(
    repoPath,
    ["update-ref", checkpointRef, stashTopAfter],
    "Failed to save checkpoint reference"
  );

  try {
    assertGitOk(
      repoPath,
      ["stash", "apply", "--index", "stash@{0}"],
      "Failed to restore working tree after checkpoint"
    );
  } finally {
    assertGitOk(
      repoPath,
      ["stash", "drop", "stash@{0}"],
      "Failed to drop temporary checkpoint stash"
    );
  }

  return {
    kind: "ref",
    id: normalizedId,
    ref: checkpointRef,
    commit: stashTopAfter,
  };
}

export function discardCheckpoint(repoPath: string, checkpoint: GitCheckpoint): void {
  if (checkpoint.kind === "snapshot") {
    if (runCommand(repoPath, ["test", "-d", checkpoint.snapshotDir]).exitCode !== 0) {
      return;
    }
    assertCommandOk(
      repoPath,
      ["rm", "-rf", checkpoint.snapshotDir],
      `Failed to discard snapshot checkpoint ${checkpoint.snapshotDir}`
    );
    return;
  }

  if (checkpoint.kind !== "ref") {
    return;
  }

  const refExists =
    runGit(repoPath, ["show-ref", "--verify", "--quiet", checkpoint.ref]).exitCode === 0;
  if (!refExists) {
    return;
  }

  const result = runGit(repoPath, ["update-ref", "-d", checkpoint.ref]);
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to discard checkpoint ${checkpoint.ref}: ${result.stderr || result.stdout}`
    );
  }
}

export function rollbackToCheckpoint(repoPath: string, checkpoint: GitCheckpoint): void {
  if (checkpoint.kind === "snapshot") {
    const repoRoot = resolveRepositoryRoot(repoPath);
    if (!repoRoot) {
      throw new Error("Failed to resolve repository root during rollback");
    }
    const archivePath = join(checkpoint.snapshotDir, CHECKPOINT_SNAPSHOT_ARCHIVE);
    const snapshotIndexPath = join(checkpoint.snapshotDir, CHECKPOINT_SNAPSHOT_INDEX);
    const absoluteGitDir = resolveGitDir(
      repoRoot,
      "Failed to resolve git directory during rollback"
    );
    const gitIndexPath = join(absoluteGitDir, "index");

    assertCommandOk(
      repoRoot,
      [
        "find",
        repoRoot,
        "-mindepth",
        "1",
        "-maxdepth",
        "1",
        "!",
        "-name",
        ".git",
        "-exec",
        "rm",
        "-rf",
        "{}",
        "+",
      ],
      "Failed to clear working tree during rollback"
    );
    assertCommandOk(
      repoRoot,
      ["tar", "-C", repoRoot, "-xf", archivePath],
      "Failed to restore working tree snapshot"
    );

    if (runCommand(repoRoot, ["test", "-f", snapshotIndexPath]).exitCode === 0) {
      assertCommandOk(
        repoRoot,
        ["cp", snapshotIndexPath, gitIndexPath],
        "Failed to restore git index snapshot"
      );
    } else {
      assertCommandOk(
        repoRoot,
        ["rm", "-f", gitIndexPath],
        "Failed to reset git index during rollback"
      );
    }

    discardCheckpoint(repoPath, checkpoint);
    return;
  }

  const repoRoot = resolveRepositoryRoot(repoPath);
  if (!repoRoot) {
    throw new Error("Failed to resolve repository root during rollback");
  }

  assertGitOk(repoRoot, ["reset", "--hard", "HEAD"], "Failed to reset repository during rollback");
  assertGitOk(repoRoot, ["clean", "-fd"], "Failed to clean untracked files during rollback");

  if (checkpoint.kind !== "ref") {
    return;
  }

  assertGitOk(
    repoRoot,
    ["stash", "apply", "--index", checkpoint.ref],
    "Failed to restore checkpoint contents"
  );
  discardCheckpoint(repoPath, checkpoint);
}

export function buildHandoffRef(sessionId: string): string {
  return buildSessionFinalRef(sessionId);
}

export function createHandoffRef(repoPath: string, ref: string, commitSha: string): void {
  assertGitOk(repoPath, ["update-ref", ref, commitSha], `Failed to write handoff ref ${ref}`);
}

function resolveRetainedCommitMessage(worktree: GitSessionWorktree): string {
  return `rr: apply reviewed patch for ${worktree.retainedBranch}`;
}

function hasStagedRetainedChanges(repoPath: string): boolean {
  const result = runGit(repoPath, ["diff", "--cached", "--quiet", "--exit-code"]);

  if (result.exitCode === 0) {
    return false;
  }

  if (result.exitCode === 1) {
    return true;
  }

  throw new Error(
    `Failed to inspect staged retained session worktree changes: ${result.stderr || `git exited with code ${result.exitCode}`}`
  );
}

function ensureRetainedWorktreeBranch(worktree: GitSessionWorktree): string {
  let worktreeBranch = worktree.retainedBranch;

  if (
    runGit(worktree.worktreeProjectPath, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${worktreeBranch}`,
    ]).exitCode === 0
  ) {
    worktreeBranch = resolveAvailableBranchName(worktree.worktreeProjectPath, worktreeBranch);
  }

  assertGitOk(
    worktree.worktreeProjectPath,
    ["switch", "-c", worktreeBranch],
    "Failed to retain session worktree on a branch"
  );

  worktree.retainedBranch = worktreeBranch;
  return worktreeBranch;
}

export function finalizeSessionWorktree(
  worktree: GitSessionWorktree
): RetainedSessionWorktree | null {
  assertGitOk(
    worktree.worktreeProjectPath,
    ["add", "-A"],
    "Failed to stage retained session worktree"
  );

  if (!hasStagedRetainedChanges(worktree.worktreeProjectPath)) {
    return null;
  }

  const worktreeBranch = ensureRetainedWorktreeBranch(worktree);

  assertGitOk(
    worktree.worktreeProjectPath,
    [
      "-c",
      "user.name=Ralph Review",
      "-c",
      "user.email=ralph-review@local",
      "commit",
      "-m",
      resolveRetainedCommitMessage(worktree),
    ],
    "Failed to commit retained session worktree"
  );

  const commitSha = assertGitOk(
    worktree.worktreeProjectPath,
    ["rev-parse", "--verify", "HEAD"],
    "Failed to resolve retained session commit"
  );

  worktree.preserveBranchOnDiscard = true;

  return {
    worktreeProjectPath: worktree.worktreeProjectPath,
    worktreeBranch,
    mergeReady: true,
    commitSha,
  };
}

export function discardSessionWorktree(worktree: GitSessionWorktree): void {
  const worktreeList = runGit(worktree.sourceRepoPath, ["worktree", "list", "--porcelain"]);
  const comparableWorktreePaths = collectComparableDirectoryPaths(worktree.worktreeProjectPath);
  const hasRegisteredWorktree =
    worktreeList.exitCode === 0 &&
    worktreeList.stdout
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .some((line) => {
        const registeredPath = line.slice("worktree ".length);
        const comparableRegisteredPaths = collectComparableDirectoryPaths(registeredPath);
        return [...comparableRegisteredPaths].some((path) => comparableWorktreePaths.has(path));
      });

  if (hasRegisteredWorktree) {
    const removeResult = runGit(worktree.sourceRepoPath, [
      "worktree",
      "remove",
      "--force",
      worktree.worktreeProjectPath,
    ]);
    if (removeResult.exitCode !== 0) {
      throw new Error(
        `Failed to discard session worktree ${worktree.worktreeProjectPath}: ${removeResult.stderr || removeResult.stdout}`
      );
    }
  }

  assertCommandOk(
    worktree.sourceRepoPath,
    ["rm", "-rf", worktree.worktreeProjectPath],
    `Failed to remove worktree directory ${worktree.worktreeProjectPath}`
  );

  if (worktree.preserveBranchOnDiscard !== true) {
    const deleteBranch = runGit(worktree.sourceRepoPath, ["branch", "-D", worktree.retainedBranch]);
    if (
      deleteBranch.exitCode !== 0 &&
      !deleteBranch.stderr.includes(`branch '${worktree.retainedBranch}' not found`)
    ) {
      throw new Error(
        `Failed to discard worktree branch ${worktree.retainedBranch}: ${deleteBranch.stderr || deleteBranch.stdout}`
      );
    }
  }

  const pruneResult = runGit(worktree.sourceRepoPath, ["worktree", "prune"]);
  if (pruneResult.exitCode !== 0) {
    throw new Error(
      `Failed to prune session worktree metadata: ${pruneResult.stderr || pruneResult.stdout}`
    );
  }

  pruneEmptyDirectory(worktree.sourceRepoPath, dirname(worktree.worktreeProjectPath));
}
