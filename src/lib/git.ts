import { readdirSync } from "node:fs";
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

const WORKING_TREE_SNAPSHOT_DIR = "ralph-review/snapshots";
const WORKING_TREE_SNAPSHOT_ARCHIVE = "worktree.tar";
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
  headKind: "detached" | "orphan";
  sourceSnapshotDir?: string;
  sourceSnapshotPath?: string;
  sourceFingerprint?: string;
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

function createSnapshotDir(
  absoluteGitDir: string,
  snapshotNamespace: string,
  category: string
): string {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  return join(absoluteGitDir, category, `${snapshotNamespace}-${uniqueSuffix}`);
}

function discardWorkingTreeSnapshot(repoPath: string, snapshotDir: string, context: string): void {
  assertCommandOk(repoPath, ["rm", "-rf", snapshotDir], context);
}

/**
 * Hydrates `dstRoot` with the full contents of `srcRoot` using a CoW file copy.
 *
 * On macOS (APFS), passes `-c` to cp which invokes clonefile(2) — a copy-on-write
 * clone that shares data blocks until written, making copies nearly instantaneous
 * regardless of working tree size. Falls back to a standard recursive copy elsewhere.
 *
 * The destination is cleared of all non-.git entries before copying.
 */
function cloneWorkingTree(srcRoot: string, dstRoot: string, context: string): void {
  assertCommandOk(
    dstRoot,
    [
      "find",
      dstRoot,
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
    context
  );

  const entries = readdirSync(srcRoot);
  const cpArgs = process.platform === "darwin" ? ["-c", "-R"] : ["-R"];
  for (const entry of entries) {
    if (entry === ".git") continue;
    assertCommandOk(srcRoot, ["cp", ...cpArgs, join(srcRoot, entry), dstRoot], context);
  }

  // Copy the source git index into the worktree's git index to preserve staged state.
  const srcGitDir = resolveGitDir(srcRoot, context);
  const srcIndexPath = join(srcGitDir, "index");
  const dstGitDir = resolveGitDir(dstRoot, context);
  const dstIndexPath = join(dstGitDir, "index");

  if (runCommand(srcRoot, ["test", "-f", srcIndexPath]).exitCode === 0) {
    assertCommandOk(srcRoot, ["cp", srcIndexPath, dstIndexPath], context);
  } else {
    assertCommandOk(dstRoot, ["rm", "-f", dstIndexPath], context);
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

function extractWorkingTreeSnapshot(
  snapshotDir: string,
  destinationPath: string,
  context: string
): void {
  const archivePath = join(snapshotDir, WORKING_TREE_SNAPSHOT_ARCHIVE);
  assertCommandOk(dirname(snapshotDir), ["mkdir", "-p", destinationPath], context);
  assertCommandOk(destinationPath, ["tar", "-C", destinationPath, "-xf", archivePath], context);
}

export function materializeWorkingTreeSnapshot(snapshotDir: string, destinationPath: string): void {
  extractWorkingTreeSnapshot(
    snapshotDir,
    destinationPath,
    "Failed to materialize working tree snapshot"
  );
}

/**
 * Creates a snapshot of the working tree at `repoPath` containing only
 * git-tracked and untracked (non-gitignored) files.
 *
 * This matches the scope of computeWorkingTreeFingerprint so handoff patches
 * stay consistent: gitignored files (node_modules, .env, etc.) are excluded
 * and not overwritten when the patch is later applied.
 */
function createGitScopedWorkingTreeSnapshot(
  repoPath: string,
  snapshotNamespace: string,
  context: string
): string {
  const repoRoot = assertGitOk(repoPath, ["rev-parse", "--show-toplevel"], context);
  const absoluteGitDir = resolveGitDir(repoRoot, context);
  const snapshotDir = createSnapshotDir(
    absoluteGitDir,
    snapshotNamespace,
    WORKING_TREE_SNAPSHOT_DIR
  );
  const archivePath = join(snapshotDir, WORKING_TREE_SNAPSHOT_ARCHIVE);
  const escapedArchivePath = archivePath.replace(/'/g, "'\\''");

  assertCommandOk(repoRoot, ["mkdir", "-p", snapshotDir], context);
  assertCommandOk(
    repoRoot,
    [
      "sh",
      "-c",
      `git ls-files -z --cached --others --exclude-standard | perl -0ne 'print if -e' | tar --null -T - -cf '${escapedArchivePath}'`,
    ],
    context
  );

  return snapshotDir;
}

export function materializeGitScopedCopy(repoPath: string, destinationPath: string): void {
  const context = "Failed to materialize git-scoped working tree copy";
  const snapshotDir = createGitScopedWorkingTreeSnapshot(
    repoPath,
    `git-scoped-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
    context
  );

  try {
    extractWorkingTreeSnapshot(snapshotDir, destinationPath, context);
  } finally {
    discardWorkingTreeSnapshot(repoPath, snapshotDir, context);
  }
}

export function computeWorkingTreeFingerprint(repoPath: string): string {
  const repoRoot = assertGitOk(
    repoPath,
    ["rev-parse", "--show-toplevel"],
    "Failed to resolve repository root for fingerprint"
  );
  const script = `
git ls-files -z --cached --others --exclude-standard |
perl -0ne '
  use strict;
  use warnings;

  my @paths = sort grep { length $_ } split(/\\0/, $_);
  my @parts = ();

  for my $path (@paths) {
    if (-l $path) {
      my $target = readlink($path);
      push @parts, "l", $path, defined($target) ? $target : "";
      next;
    }

    if (-f $path) {
      open my $fh, "-|", "git", "hash-object", "--no-filters", "--", $path
        or die "Failed to hash file $path: $!";
      my $hash = <$fh>;
      close $fh or die "Failed to hash file $path";
      chomp $hash;
      push @parts, "f", $path, $hash;
      next;
    }

    push @parts, "d", $path, "";
  }

  binmode STDOUT;
  print join("\\0", @parts);
' |
git hash-object --stdin
  `;
  return assertCommandOk(repoRoot, ["sh", "-lc", script], "Failed to fingerprint working tree");
}

export async function computeWorkingTreeFingerprintAsync(repoPath: string): Promise<string> {
  const repoRoot = assertGitOk(
    repoPath,
    ["rev-parse", "--show-toplevel"],
    "Failed to resolve repository root for fingerprint"
  );
  const script = `
git ls-files -z --cached --others --exclude-standard |
perl -0ne '
  use strict;
  use warnings;

  my @paths = sort grep { length $_ } split(/\\0/, $_);
  my @parts = ();

  for my $path (@paths) {
    if (-l $path) {
      my $target = readlink($path);
      push @parts, "l", $path, defined($target) ? $target : "";
      next;
    }

    if (-f $path) {
      open my $fh, "-|", "git", "hash-object", "--no-filters", "--", $path
        or die "Failed to hash file $path: $!";
      my $hash = <$fh>;
      close $fh or die "Failed to hash file $path";
      chomp $hash;
      push @parts, "f", $path, $hash;
      next;
    }

    push @parts, "d", $path, "";
  }

  binmode STDOUT;
  print join("\\0", @parts);
' |
git hash-object --stdin
`;
  return await assertCommandOkAsync(
    repoRoot,
    ["sh", "-lc", script],
    "Failed to fingerprint working tree"
  );
}

function normalizePatchPathPrefix(path: string): string {
  return path.replace(/^\/+/u, "");
}

function rewriteNoIndexPatchPaths(patch: string, fromPath: string, toPath: string): string {
  const normalizedFromPath = normalizePatchPathPrefix(fromPath);
  const normalizedToPath = normalizePatchPathPrefix(toPath);
  const replacements: Array<[from: string, to: string]> = [
    [`a/${fromPath}/`, "a/"],
    [`a/${normalizedFromPath}/`, "a/"],
    [`a/${toPath}/`, "a/"],
    [`a/${normalizedToPath}/`, "a/"],
    [`b/${fromPath}/`, "b/"],
    [`b/${normalizedFromPath}/`, "b/"],
    [`b/${toPath}/`, "b/"],
    [`b/${normalizedToPath}/`, "b/"],
  ];

  return patch
    .split("\n")
    .map((line) =>
      replacements.reduce(
        (rewritten, [match, replacement]) => rewritten.replace(match, replacement),
        line
      )
    )
    .join("\n");
}

export async function createBinaryPatch(
  fromPath: string,
  toPath: string,
  patchPath: string
): Promise<string> {
  const result = Bun.spawnSync(
    ["git", "diff", "--no-index", "--binary", "--no-renames", fromPath, toPath],
    {
      cwd: dirname(fromPath),
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

  const patch = rewriteNoIndexPatchPaths(stdout, fromPath, toPath);
  const patchDir = dirname(patchPath);
  assertCommandOk(
    dirname(fromPath),
    ["mkdir", "-p", patchDir],
    "Failed to create handoff patch directory"
  );
  await Bun.write(patchPath, patch, { createPath: true });
  return patch;
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
  return `refs/ralph-review/handoffs/${normalizeGitArtifactId(sessionId)}`;
}

export function createHandoffRef(repoPath: string, ref: string, commitSha: string): void {
  assertGitOk(repoPath, ["update-ref", ref, commitSha], `Failed to write handoff ref ${ref}`);
}

export function removeHandoffRef(repoPath: string, ref: string): void {
  const result = runGit(repoPath, ["update-ref", "-d", ref]);
  if (result.exitCode !== 0 && !result.stderr.includes("does not exist")) {
    throw new Error(`Failed to delete handoff ref ${ref}: ${result.stderr || result.stdout}`);
  }
}

export function createSessionWorktree(
  sourceProjectPath: string,
  worktreeId: string,
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
  const headKind: GitSessionWorktree["headKind"] = hasInitialCommit(sourceProjectPath)
    ? "detached"
    : "orphan";
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
    headKind,
    sourceFingerprint: computeWorkingTreeFingerprint(sourceRepoPath),
    preserveBranchOnDiscard: false,
  };

  try {
    assertCommandOk(
      sourceRepoPath,
      ["mkdir", "-p", getProjectWorktreesDir(storageRoot, sourceProjectPath)],
      "Failed to prepare session worktree directory"
    );

    if (headKind === "detached") {
      assertGitOk(
        sourceProjectPath,
        ["worktree", "add", "--detach", worktreeProjectPath, "HEAD"],
        "Failed to create detached session worktree"
      );
    } else {
      assertGitOk(
        sourceProjectPath,
        ["worktree", "add", "--orphan", "-b", retainedBranch, worktreeProjectPath],
        "Failed to create orphan session worktree"
      );
    }

    cloneWorkingTree(
      sourceRepoPath,
      worktreeProjectPath,
      "Failed to clone working tree into session worktree"
    );

    worktree.sourceSnapshotDir = createGitScopedWorkingTreeSnapshot(
      sourceRepoPath,
      `worktree-${normalizedId}`,
      "Failed to capture session worktree snapshot"
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

  if (worktree.headKind === "detached") {
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
  } else {
    worktreeBranch =
      runGitForStdout(worktree.worktreeProjectPath, ["branch", "--show-current"]) || worktreeBranch;
  }

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

  if (worktree.sourceSnapshotDir) {
    discardWorkingTreeSnapshot(
      worktree.sourceRepoPath,
      worktree.sourceSnapshotDir,
      `Failed to remove source snapshot archive ${worktree.sourceSnapshotDir}`
    );
  }

  if (worktree.sourceSnapshotPath) {
    assertCommandOk(
      worktree.sourceRepoPath,
      ["rm", "-rf", worktree.sourceSnapshotPath],
      `Failed to remove source snapshot directory ${worktree.sourceSnapshotPath}`
    );
  }

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
