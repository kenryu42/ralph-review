import { isAbsolute, join } from "node:path";

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

function normalizeCheckpointId(checkpointId: string): string {
  return checkpointId.replace(/[^a-zA-Z0-9_.-]/g, "-");
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

function toAbsolutePath(basePath: string, path: string): string {
  return isAbsolute(path) ? path : join(basePath, path);
}

function createSnapshotCheckpoint(repoPath: string, normalizedId: string): GitCheckpoint {
  const repoRoot = assertGitOk(
    repoPath,
    ["rev-parse", "--show-toplevel"],
    "Failed to resolve repository root"
  );
  const gitDir = assertGitOk(
    repoRoot,
    ["rev-parse", "--git-dir"],
    "Failed to resolve git directory"
  );
  const absoluteGitDir = toAbsolutePath(repoRoot, gitDir);
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const snapshotDir = join(
    absoluteGitDir,
    CHECKPOINT_SNAPSHOT_DIR,
    `${normalizedId}-${uniqueSuffix}`
  );
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
  const normalizedId = normalizeCheckpointId(checkpointId);
  if (!hasInitialCommit(repoPath)) {
    return createSnapshotCheckpoint(repoPath, normalizedId);
  }

  const label = `rr-checkpoint-${normalizedId}`;
  const stashTopBefore = resolveStashTop(repoPath);
  assertGitOk(
    repoPath,
    ["stash", "push", "--all", "-m", label],
    "Failed to create checkpoint stash"
  );
  const stashTopAfter = resolveStashTop(repoPath);

  if (!stashTopAfter || stashTopAfter === stashTopBefore) {
    return {
      kind: "clean",
      id: normalizedId,
    };
  }

  const stashCommit = stashTopAfter;
  const checkpointRef = `${CHECKPOINT_REF_PREFIX}/${normalizedId}`;
  assertGitOk(
    repoPath,
    ["update-ref", checkpointRef, stashCommit],
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
    commit: stashCommit,
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
    const repoRoot = assertGitOk(
      repoPath,
      ["rev-parse", "--show-toplevel"],
      "Failed to resolve repository root during rollback"
    );
    const archivePath = join(checkpoint.snapshotDir, CHECKPOINT_SNAPSHOT_ARCHIVE);
    const snapshotIndexPath = join(checkpoint.snapshotDir, CHECKPOINT_SNAPSHOT_INDEX);
    const gitDir = assertGitOk(
      repoRoot,
      ["rev-parse", "--git-dir"],
      "Failed to resolve git directory during rollback"
    );
    const gitIndexPath = join(toAbsolutePath(repoRoot, gitDir), "index");

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

  const repoRoot = assertGitOk(
    repoPath,
    ["rev-parse", "--show-toplevel"],
    "Failed to resolve repository root during rollback"
  );

  assertGitOk(repoRoot, ["reset", "--hard", "HEAD"], "Failed to reset repository during rollback");
  assertGitOk(repoRoot, ["clean", "-fdx"], "Failed to clean untracked files during rollback");

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
