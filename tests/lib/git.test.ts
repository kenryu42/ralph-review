import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyBinaryPatch,
  createBinaryPatch,
  createCheckpoint,
  createSessionWorktree,
  discardCheckpoint,
  discardSessionWorktree,
  ensureGitRepository,
  ensureGitRepositoryAsync,
  finalizeSessionWorktree,
  type GitSessionWorktree,
  mergeBaseWithHead,
  rollbackToCheckpoint,
} from "@/lib/git";
import { getProjectWorktreesDir } from "@/lib/logger";

/**
 * Helper to run git commands in a directory
 */
function runGitIn(repoPath: string, args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: repoPath,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  }
}

/**
 * Helper to run git and return stdout
 */
function runGitStdout(repoPath: string, args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: repoPath,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString().trim();
}

/**
 * Initialize a test git repo
 */
function initTestRepo(repoPath: string): void {
  runGitIn(repoPath, ["init", "--initial-branch=main"]);
  runGitIn(repoPath, ["config", "core.autocrlf", "false"]);
  runGitIn(repoPath, ["config", "user.name", "Tester"]);
  runGitIn(repoPath, ["config", "user.email", "test@example.com"]);
  runGitIn(repoPath, ["config", "commit.gpgsign", "false"]);
}

/**
 * Create a commit with an empty file
 */
function commit(repoPath: string, filename: string, message: string): void {
  Bun.spawnSync(["touch", filename], { cwd: repoPath });
  runGitIn(repoPath, ["add", filename]);
  runGitIn(repoPath, ["commit", "-m", message]);
}

function patchSpawnSyncFailure(shouldFail: (command: string[]) => boolean): () => void {
  const originalSpawnSync = Bun.spawnSync;
  type SpawnSyncArgs =
    | [command: string[], options?: { cwd?: string }]
    | [options: { cmd: string[]; cwd?: string }];

  Bun.spawnSync = ((...args: SpawnSyncArgs) => {
    const firstArg = args[0];
    const command = Array.isArray(firstArg) ? firstArg : firstArg.cmd;

    if (shouldFail(command)) {
      const cwd = Array.isArray(firstArg) ? args[1]?.cwd : firstArg.cwd;
      return originalSpawnSync({
        cmd: ["git", "rev-parse", "--verify", "refs/does-not-exist"],
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
    }

    if (Array.isArray(firstArg)) {
      return originalSpawnSync(firstArg, args[1]);
    }

    return originalSpawnSync(firstArg);
  }) as typeof Bun.spawnSync;

  return () => {
    Bun.spawnSync = originalSpawnSync;
  };
}

function listWorktreePaths(repoPath: string): string[] {
  return runGitStdout(repoPath, ["worktree", "list", "--porcelain"])
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

function directoryExists(path: string): boolean {
  return (
    Bun.spawnSync(["test", "-d", path], {
      stdout: "ignore",
      stderr: "ignore",
    }).exitCode === 0
  );
}

describe("ensureGitRepository", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "git-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("returns true for a git repository", () => {
    initTestRepo(tempDir);
    expect(ensureGitRepository(tempDir)).toBe(true);
  });

  test("returns false for a non-git directory", () => {
    // tempDir without git init
    expect(ensureGitRepository(tempDir)).toBe(false);
  });
});

describe("binary patch rewriting", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "git-patch-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("rewrites new-file no-index headers so git apply can validate them", async () => {
    const repoPath = join(tempDir, "repo");
    const fromPath = join(tempDir, "from");
    const toPath = join(tempDir, "to");
    const patchPath = join(tempDir, "handoff.patch");

    await mkdir(repoPath, { recursive: true });
    await mkdir(fromPath, { recursive: true });
    initTestRepo(repoPath);
    await Bun.write(join(repoPath, ".gitignore"), "coverage\n", { createPath: true });
    runGitIn(repoPath, ["add", ".gitignore"]);
    runGitIn(repoPath, ["commit", "-m", "initial commit"]);

    await Bun.write(join(toPath, "coverage/lcov.info"), "coverage data\n", { createPath: true });

    const patch = await createBinaryPatch(fromPath, toPath, patchPath);

    expect(patch).toContain("diff --git a/coverage/lcov.info b/coverage/lcov.info");
    expect(patch).toContain("+++ b/coverage/lcov.info");
    expect(patch).not.toContain(`${toPath}/coverage/lcov.info`);

    expect(() => applyBinaryPatch(repoPath, patchPath)).not.toThrow();
    expect(await Bun.file(join(repoPath, "coverage/lcov.info")).text()).toBe("coverage data\n");
  });
});

describe("ensureGitRepositoryAsync", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "git-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("returns true for a git repository", async () => {
    initTestRepo(tempDir);
    await expect(ensureGitRepositoryAsync(tempDir)).resolves.toBe(true);
  });

  test("returns false for a non-git directory", async () => {
    await expect(ensureGitRepositoryAsync(tempDir)).resolves.toBe(false);
  });
});

describe("mergeBaseWithHead", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "git-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("returns the shared ancestor commit", async () => {
    // Setup: main with one commit, feature branch diverged
    initTestRepo(tempDir);

    // Base commit on main
    commit(tempDir, "base.txt", "base commit");

    // Create feature branch and add a commit
    runGitIn(tempDir, ["checkout", "-b", "feature"]);
    commit(tempDir, "feature.txt", "feature commit");

    // Go back to main and add a commit (diverge)
    runGitIn(tempDir, ["checkout", "main"]);
    commit(tempDir, "main.txt", "main commit");

    // Back to feature branch
    runGitIn(tempDir, ["checkout", "feature"]);

    // Expected: the base commit SHA
    const expected = runGitStdout(tempDir, ["merge-base", "HEAD", "main"]);
    const result = mergeBaseWithHead(tempDir, "main");

    expect(result).toBe(expected);
  });

  test("prefers upstream when remote is ahead of local", async () => {
    // Setup: bare remote, local repo with tracking branch
    const repoPath = join(tempDir, "repo");
    const remotePath = join(tempDir, "remote.git");

    await Bun.write(join(repoPath, ".gitkeep"), "");
    await Bun.write(join(remotePath, ".gitkeep"), "");

    // Initialize bare remote
    runGitIn(remotePath, ["init", "--bare"]);

    // Initialize local repo
    initTestRepo(repoPath);

    // Base commit
    commit(repoPath, "base.txt", "base commit");

    // Push to remote and set tracking
    runGitIn(repoPath, ["remote", "add", "origin", remotePath]);
    runGitIn(repoPath, ["push", "-u", "origin", "main"]);

    // Create feature branch
    runGitIn(repoPath, ["checkout", "-b", "feature"]);
    commit(repoPath, "feature.txt", "feature commit");

    // Simulate local main being outdated:
    // Create an orphan branch that replaces main locally
    // while origin/main still points to the original commits
    runGitIn(repoPath, ["checkout", "--orphan", "rewrite"]);
    runGitIn(repoPath, ["rm", "-rf", "."]);
    commit(repoPath, "new-main.txt", "rewrite main");
    runGitIn(repoPath, ["branch", "-M", "rewrite", "main"]);
    runGitIn(repoPath, ["branch", "--set-upstream-to=origin/main", "main"]);

    // Back to feature and fetch
    runGitIn(repoPath, ["checkout", "feature"]);
    runGitIn(repoPath, ["fetch", "origin"]);

    // Expected: merge-base against origin/main (the original), not local main (rewritten)
    const expected = runGitStdout(repoPath, ["merge-base", "HEAD", "origin/main"]);
    const result = mergeBaseWithHead(repoPath, "main");

    expect(result).toBe(expected);
  });

  test("keeps local branch when upstream is not ahead", async () => {
    const repoPath = join(tempDir, "repo");
    const remotePath = join(tempDir, "remote.git");

    await Bun.write(join(repoPath, ".gitkeep"), "");
    await Bun.write(join(remotePath, ".gitkeep"), "");

    runGitIn(remotePath, ["init", "--bare"]);
    initTestRepo(repoPath);
    commit(repoPath, "base.txt", "base commit");

    runGitIn(repoPath, ["remote", "add", "origin", remotePath]);
    runGitIn(repoPath, ["push", "-u", "origin", "main"]);
    runGitIn(repoPath, ["checkout", "-b", "feature"]);
    commit(repoPath, "feature.txt", "feature commit");
    runGitIn(repoPath, ["fetch", "origin"]);

    const expected = runGitStdout(repoPath, ["merge-base", "HEAD", "main"]);
    const result = mergeBaseWithHead(repoPath, "main");

    expect(result).toBe(expected);
  });

  test("returns undefined when repository root cannot be resolved", async () => {
    initTestRepo(tempDir);
    commit(tempDir, "base.txt", "base commit");

    const restoreSpawnSync = patchSpawnSyncFailure(
      (command) =>
        command[0] === "git" && command[1] === "rev-parse" && command[2] === "--show-toplevel"
    );

    try {
      const result = mergeBaseWithHead(tempDir, "main");
      expect(result).toBeUndefined();
    } finally {
      restoreSpawnSync();
    }
  });

  test("returns undefined when target branch does not exist", async () => {
    initTestRepo(tempDir);
    commit(tempDir, "tracked.txt", "initial commit");

    const result = mergeBaseWithHead(tempDir, "nonexistent-branch");

    expect(result).toBeUndefined();
  });

  test("returns undefined when HEAD is unborn (no commits)", async () => {
    initTestRepo(tempDir);
    // No commits made - HEAD is unborn

    const result = mergeBaseWithHead(tempDir, "main");

    expect(result).toBeUndefined();
  });

  test("returns undefined for non-git directory", async () => {
    // tempDir is just a regular directory, not a git repo
    const result = mergeBaseWithHead(tempDir, "main");

    expect(result).toBeUndefined();
  });
});

describe("checkpoint management", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "git-checkpoint-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("rolls back tracked and untracked changes while preserving ignored files", async () => {
    initTestRepo(tempDir);
    commit(tempDir, "base.txt", "base commit");
    await Bun.write(join(tempDir, ".gitignore"), ".env\n");
    runGitIn(tempDir, ["add", ".gitignore"]);
    runGitIn(tempDir, ["commit", "-m", "add ignore rules"]);

    await Bun.write(join(tempDir, "base.txt"), "tracked change before checkpoint");
    await Bun.write(join(tempDir, "notes.txt"), "untracked change before checkpoint");
    await Bun.write(join(tempDir, ".env"), "ignored secret before checkpoint");

    const checkpoint = createCheckpoint(tempDir, "checkpoint-ignored-files");
    expect(checkpoint.kind).toBe("ref");

    await Bun.write(join(tempDir, "base.txt"), "tracked change after checkpoint");
    await Bun.write(join(tempDir, "notes.txt"), "untracked change after checkpoint");
    await Bun.write(join(tempDir, ".env"), "ignored secret after checkpoint");

    try {
      rollbackToCheckpoint(tempDir, checkpoint);
    } finally {
      discardCheckpoint(tempDir, checkpoint);
    }

    expect(await Bun.file(join(tempDir, "base.txt")).text()).toBe(
      "tracked change before checkpoint"
    );
    expect(await Bun.file(join(tempDir, "notes.txt")).text()).toBe(
      "untracked change before checkpoint"
    );
    expect(await Bun.file(join(tempDir, ".env")).text()).toBe("ignored secret after checkpoint");
  });
});

describe("session worktree management", () => {
  let tempDir: string;
  let storageRoot: string;
  let createdWorktrees: GitSessionWorktree[];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "git-session-worktree-test-"));
    storageRoot = await mkdtemp(join(tmpdir(), "git-session-worktree-storage-"));
    createdWorktrees = [];
  });

  afterEach(async () => {
    for (const worktree of createdWorktrees) {
      try {
        discardSessionWorktree(worktree);
      } catch (error) {
        await rm(worktree.worktreeProjectPath, { recursive: true, force: true });
        if (await Bun.file(worktree.worktreeProjectPath).exists()) {
          throw error;
        }
      }
    }
    await rm(storageRoot, { recursive: true, force: true });
    await rm(tempDir, { recursive: true, force: true });
  });

  test("captures dirty tracked, untracked, and ignored state into an isolated worktree", async () => {
    initTestRepo(tempDir);
    commit(tempDir, "base.txt", "base commit");
    await Bun.write(join(tempDir, ".gitignore"), ".env\n");
    runGitIn(tempDir, ["add", ".gitignore"]);
    runGitIn(tempDir, ["commit", "-m", "add ignore rules"]);

    await Bun.write(join(tempDir, "base.txt"), "base with unstaged changes");
    await Bun.write(join(tempDir, "staged.txt"), "staged content");
    runGitIn(tempDir, ["add", "staged.txt"]);
    await Bun.write(join(tempDir, "untracked.txt"), "untracked content");
    await Bun.write(join(tempDir, ".env"), "ignored content");

    const worktree = createSessionWorktree(tempDir, "session-1", storageRoot);
    createdWorktrees.push(worktree);

    expect(
      worktree.worktreeProjectPath.startsWith(`${getProjectWorktreesDir(storageRoot, tempDir)}/`)
    ).toBe(true);
    expect(worktree.worktreeProjectPath).not.toContain(
      join(process.env.TMPDIR || "/tmp", "ralph-review", "sandboxes")
    );
    expect(await Bun.file(join(worktree.worktreeProjectPath, "base.txt")).text()).toBe(
      "base with unstaged changes"
    );
    expect(await Bun.file(join(worktree.worktreeProjectPath, "staged.txt")).exists()).toBe(true);
    expect(await Bun.file(join(worktree.worktreeProjectPath, "untracked.txt")).exists()).toBe(true);
    expect(await Bun.file(join(worktree.worktreeProjectPath, ".env")).text()).toBe(
      "ignored content"
    );

    const worktreeStatus = runGitStdout(worktree.worktreeProjectPath, ["status", "--porcelain"]);
    expect(worktreeStatus).toContain("M base.txt");
    expect(worktreeStatus).toContain("A  staged.txt");
    expect(worktreeStatus).toContain("?? untracked.txt");

    await Bun.write(join(tempDir, "base.txt"), "source changed after capture");
    await Bun.write(join(tempDir, "late.txt"), "late source file");

    expect(await Bun.file(join(worktree.worktreeProjectPath, "base.txt")).text()).toBe(
      "base with unstaged changes"
    );
    expect(await Bun.file(join(worktree.worktreeProjectPath, "late.txt")).exists()).toBe(false);
  });

  test("captures the source fingerprint when the session worktree is created", async () => {
    initTestRepo(tempDir);
    commit(tempDir, "base.txt", "base commit");

    let fingerprintCalls = 0;
    const originalSpawnSync = Bun.spawnSync;
    type SpawnSyncArgs =
      | [command: string[], options?: { cwd?: string }]
      | [options: { cmd: string[]; cwd?: string }];

    Bun.spawnSync = ((...args: SpawnSyncArgs) => {
      const firstArg = args[0];
      const command = Array.isArray(firstArg) ? firstArg : firstArg.cmd;

      if (
        command[0] === "sh" &&
        command[1] === "-lc" &&
        typeof command[2] === "string" &&
        command[2].includes("git hash-object")
      ) {
        fingerprintCalls += 1;
      }

      if (Array.isArray(firstArg)) {
        return originalSpawnSync(firstArg, args[1]);
      }

      return originalSpawnSync(firstArg);
    }) as typeof Bun.spawnSync;

    try {
      const worktree = createSessionWorktree(tempDir, "session-deferred-fingerprint", storageRoot);
      createdWorktrees.push(worktree);

      expect(worktree.sourceSnapshotDir).toBeString();
      expect(worktree.sourceSnapshotPath).toBeUndefined();
      expect(worktree.sourceFingerprint).toBeString();
      expect(fingerprintCalls).toBe(1);
    } finally {
      Bun.spawnSync = originalSpawnSync;
    }
  });

  test("captures a git-scoped source snapshot for handoff (excludes gitignored files)", () => {
    initTestRepo(tempDir);
    commit(tempDir, "base.txt", "base commit");

    const worktree = createSessionWorktree(tempDir, "session-archive-snapshot", storageRoot);
    createdWorktrees.push(worktree);

    // Snapshot is captured for handoff patch creation, but scoped to git-tracked files only.
    expect(worktree.sourceSnapshotDir).toBeString();
    expect(worktree.sourceSnapshotPath).toBeUndefined();
  });

  test("finalizes a detached worktree onto a retained branch and removes it cleanly", async () => {
    initTestRepo(tempDir);
    commit(tempDir, "base.txt", "base commit");

    const worktree = createSessionWorktree(tempDir, "session-2", storageRoot);
    createdWorktrees.push(worktree);

    await Bun.write(join(worktree.worktreeProjectPath, "base.txt"), "worktree change");

    const retained = finalizeSessionWorktree(worktree);
    expect(retained).not.toBeNull();
    if (!retained) {
      throw new Error("Expected retained worktree to be created");
    }
    expect(retained.worktreeBranch).toBe("rr-worktree-session-2");
    expect(retained.mergeReady).toBe(true);
    expect(retained.commitSha).toBeString();
    const retainedCommitSha = retained.commitSha;
    if (!retainedCommitSha) {
      throw new Error("Expected retained worktree commit sha");
    }
    expect(runGitStdout(worktree.worktreeProjectPath, ["branch", "--show-current"])).toBe(
      retained.worktreeBranch
    );
    expect(runGitStdout(worktree.worktreeProjectPath, ["rev-parse", "HEAD"])).toBe(
      retainedCommitSha
    );
    expect(runGitStdout(tempDir, ["merge", retained.worktreeBranch])).not.toBe(
      "Already up to date."
    );
    expect(await Bun.file(join(tempDir, "base.txt")).text()).toBe("worktree change");

    discardSessionWorktree(worktree);
    createdWorktrees = createdWorktrees.filter(
      (candidate) => candidate.worktreeProjectPath !== worktree.worktreeProjectPath
    );

    expect(await Bun.file(worktree.worktreeProjectPath).exists()).toBe(false);
    const worktreeList = runGitStdout(tempDir, ["worktree", "list", "--porcelain"]);
    expect(worktreeList).not.toContain(worktree.worktreeProjectPath);
  });

  test("prunes an empty per-project worktrees directory after discarding the last worktree", () => {
    initTestRepo(tempDir);
    commit(tempDir, "base.txt", "base commit");

    const worktreesDir = getProjectWorktreesDir(storageRoot, tempDir);
    const worktree = createSessionWorktree(tempDir, "session-prune-empty-parent", storageRoot);
    createdWorktrees.push(worktree);

    expect(directoryExists(worktreesDir)).toBe(true);

    discardSessionWorktree(worktree);
    createdWorktrees = createdWorktrees.filter(
      (candidate) => candidate.worktreeProjectPath !== worktree.worktreeProjectPath
    );

    expect(directoryExists(worktreesDir)).toBe(false);
  });

  test("keeps the per-project worktrees directory when sibling artifacts remain", async () => {
    initTestRepo(tempDir);
    commit(tempDir, "base.txt", "base commit");

    const worktreesDir = getProjectWorktreesDir(storageRoot, tempDir);
    const markerPath = join(worktreesDir, ".keep");
    const worktree = createSessionWorktree(tempDir, "session-keep-parent", storageRoot);
    createdWorktrees.push(worktree);

    await Bun.write(markerPath, "marker", { createPath: true });

    discardSessionWorktree(worktree);
    createdWorktrees = createdWorktrees.filter(
      (candidate) => candidate.worktreeProjectPath !== worktree.worktreeProjectPath
    );

    expect(directoryExists(worktreesDir)).toBe(true);
    expect(await Bun.file(markerPath).exists()).toBe(true);
  });

  test("does not retain a detached worktree when there is nothing to commit", async () => {
    initTestRepo(tempDir);
    commit(tempDir, "base.txt", "base commit");

    const worktree = createSessionWorktree(tempDir, "session-empty", storageRoot);
    createdWorktrees.push(worktree);

    const retained = finalizeSessionWorktree(worktree);
    expect(retained).toBeNull();
  });

  test("finalizes a dirty worktree without relying on git status pre-checks", async () => {
    initTestRepo(tempDir);
    commit(tempDir, "base.txt", "base commit");

    const worktree = createSessionWorktree(tempDir, "session-statusless", storageRoot);
    createdWorktrees.push(worktree);

    await Bun.write(join(worktree.worktreeProjectPath, "base.txt"), "worktree change");

    const restoreSpawnSync = patchSpawnSyncFailure(
      (command) =>
        command[0] === "git" &&
        command[1] === "status" &&
        command[2] === "--porcelain" &&
        command[3] === "--untracked-files=all"
    );

    try {
      const retained = finalizeSessionWorktree(worktree);
      expect(retained).not.toBeNull();
      if (!retained) {
        throw new Error("Expected retained worktree to be created");
      }
      expect(retained.worktreeBranch).toBe("rr-worktree-session-statusless");
      expect(retained.mergeReady).toBe(true);
      expect(retained.commitSha).toBeString();
    } finally {
      restoreSpawnSync();
    }
  });

  test("creates an unborn worktree that preserves staged and untracked state", async () => {
    initTestRepo(tempDir);

    await Bun.write(join(tempDir, "staged.txt"), "staged content");
    runGitIn(tempDir, ["add", "staged.txt"]);
    await Bun.write(join(tempDir, "mixed.txt"), "staged snapshot");
    runGitIn(tempDir, ["add", "mixed.txt"]);
    await Bun.write(join(tempDir, "mixed.txt"), "staged snapshot plus unstaged change");
    await Bun.write(join(tempDir, "untracked.txt"), "untracked content");

    const worktree = createSessionWorktree(tempDir, "unborn-session", storageRoot);
    createdWorktrees.push(worktree);

    expect(runGitStdout(worktree.worktreeProjectPath, ["branch", "--show-current"])).toBe(
      "rr-worktree-unborn-session"
    );

    const worktreeStatus = runGitStdout(worktree.worktreeProjectPath, ["status", "--porcelain"]);
    expect(worktreeStatus).toContain("A  staged.txt");
    expect(worktreeStatus).toContain("AM mixed.txt");
    expect(worktreeStatus).toContain("?? untracked.txt");
  });

  test("includes cleanup failure details when worktree creation cleanup also fails", async () => {
    initTestRepo(tempDir);
    commit(tempDir, "base.txt", "base commit");

    const restoreSpawnSync = patchSpawnSyncFailure(
      (command) =>
        (command[0] === "cp" &&
          command.some((part) => part.includes(getProjectWorktreesDir(storageRoot, tempDir)))) ||
        (command[0] === "git" &&
          command[1] === "worktree" &&
          command[2] === "remove" &&
          command[3] === "--force") ||
        (command[0] === "rm" &&
          command[1] === "-rf" &&
          command.some((part) =>
            part.includes(join(getProjectWorktreesDir(storageRoot, tempDir), "cleanup-failure"))
          ))
    );

    try {
      expect(() => createSessionWorktree(tempDir, "cleanup-failure", storageRoot)).toThrow(
        "Cleanup also failed"
      );
    } finally {
      restoreSpawnSync();
      const repoRoot = await realpath(runGitStdout(tempDir, ["rev-parse", "--show-toplevel"]));

      for (const worktreePath of listWorktreePaths(tempDir)) {
        if ((await realpath(worktreePath)) === repoRoot) {
          continue;
        }

        runGitIn(tempDir, ["worktree", "remove", "--force", worktreePath]);
      }
    }
  });
});
