import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCheckpoint,
  discardCheckpoint,
  ensureGitRepository,
  ensureGitRepositoryAsync,
  mergeBaseWithHead,
  rollbackToCheckpoint,
} from "@/lib/git";

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

function patchGitSpawnSync(shouldFail: (command: string[]) => boolean): () => void {
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

    const restoreSpawnSync = patchGitSpawnSync(
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
    initTestRepo(tempDir);
    commit(tempDir, "base.txt", "base commit");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("restores staged, unstaged, and untracked changes on rollback", async () => {
    await Bun.write(join(tempDir, "base.txt"), "base with unstaged changes");
    await Bun.write(join(tempDir, "staged.txt"), "staged content");
    runGitIn(tempDir, ["add", "staged.txt"]);
    await Bun.write(join(tempDir, "untracked.txt"), "untracked content");

    const checkpoint = createCheckpoint(tempDir, "iter-1");
    expect(checkpoint.kind).toBe("ref");

    await Bun.write(join(tempDir, "base.txt"), "post-fixer changes");
    await Bun.write(join(tempDir, "another-untracked.txt"), "new file");
    runGitIn(tempDir, ["add", "base.txt"]);

    rollbackToCheckpoint(tempDir, checkpoint);

    expect(await Bun.file(join(tempDir, "base.txt")).text()).toBe("base with unstaged changes");
    expect(await Bun.file(join(tempDir, "staged.txt")).exists()).toBe(true);
    expect(await Bun.file(join(tempDir, "untracked.txt")).exists()).toBe(true);

    const status = runGitStdout(tempDir, ["status", "--porcelain"]);
    expect(status).toContain("M base.txt");
    expect(status).toContain("A  staged.txt");
    expect(status).toContain("?? untracked.txt");
  });

  test("restores ignored files and removes new ignored files on rollback", async () => {
    await Bun.write(join(tempDir, ".gitignore"), ".env\n*.local\n");
    runGitIn(tempDir, ["add", ".gitignore"]);
    runGitIn(tempDir, ["commit", "-m", "add ignore rules"]);

    await Bun.write(join(tempDir, ".env"), "before");

    const checkpoint = createCheckpoint(tempDir, "ignored-ref");
    expect(checkpoint.kind).toBe("ref");

    await Bun.write(join(tempDir, ".env"), "after");
    await Bun.write(join(tempDir, "created.local"), "new ignored file");

    rollbackToCheckpoint(tempDir, checkpoint);

    expect(await Bun.file(join(tempDir, ".env")).text()).toBe("before");
    expect(await Bun.file(join(tempDir, "created.local")).exists()).toBe(false);
    const status = runGitStdout(tempDir, ["status", "--porcelain"]);
    expect(status).toBe("");
  });

  test("returns clean checkpoint and rolls back to clean tree", async () => {
    const checkpoint = createCheckpoint(tempDir, "clean");
    expect(checkpoint.kind).toBe("clean");

    await Bun.write(join(tempDir, "base.txt"), "mutated");
    await Bun.write(join(tempDir, "new.txt"), "new");

    rollbackToCheckpoint(tempDir, checkpoint);
    const status = runGitStdout(tempDir, ["status", "--porcelain"]);
    expect(status).toBe("");
  });

  test("removes ignored files created after a clean checkpoint", async () => {
    await Bun.write(join(tempDir, ".gitignore"), "*.local\n");
    runGitIn(tempDir, ["add", ".gitignore"]);
    runGitIn(tempDir, ["commit", "-m", "add ignore rule"]);

    const checkpoint = createCheckpoint(tempDir, "clean-ignored");
    expect(checkpoint.kind).toBe("clean");

    await Bun.write(join(tempDir, "created.local"), "new ignored file");

    rollbackToCheckpoint(tempDir, checkpoint);

    expect(await Bun.file(join(tempDir, "created.local")).exists()).toBe(false);
    const status = runGitStdout(tempDir, ["status", "--porcelain"]);
    expect(status).toBe("");
  });

  test("cleans root untracked files when rollback is invoked from a subdirectory", async () => {
    const nestedPath = join(tempDir, "nested", "path");
    const mkdirResult = Bun.spawnSync(["mkdir", "-p", nestedPath], {
      stdout: "ignore",
      stderr: "pipe",
    });
    if (mkdirResult.exitCode !== 0) {
      throw new Error(`mkdir failed: ${mkdirResult.stderr.toString()}`);
    }

    const checkpoint = createCheckpoint(nestedPath, "clean-subdir");
    expect(checkpoint.kind).toBe("clean");

    await Bun.write(join(tempDir, "root-untracked.txt"), "created after checkpoint");

    rollbackToCheckpoint(nestedPath, checkpoint);

    expect(await Bun.file(join(tempDir, "root-untracked.txt")).exists()).toBe(false);
    const status = runGitStdout(tempDir, ["status", "--porcelain"]);
    expect(status).toBe("");
  });

  test("detects clean checkpoint without relying on stash output text", async () => {
    await Bun.write(join(tempDir, "base.txt"), "user stash content");
    runGitIn(tempDir, ["stash", "push", "-m", "user-stash"]);
    const stashRefBefore = runGitStdout(tempDir, ["rev-parse", "--verify", "refs/stash"]);
    const stashListBefore = runGitStdout(tempDir, ["stash", "list"]);

    const gitBinary = Bun.which("git");
    if (!gitBinary) {
      throw new Error("git binary not found");
    }

    const wrapperDir = await mkdtemp(join(tmpdir(), "git-wrapper-"));
    const wrapperPath = join(wrapperDir, "git");
    await Bun.write(
      wrapperPath,
      `#!/bin/sh
REAL_GIT="${gitBinary}"
if [ "$1" = "stash" ] && [ "$2" = "push" ]; then
  output="$("$REAL_GIT" "$@")"
  code=$?
  if [ "$code" -eq 0 ] && printf "%s" "$output" | grep -q "No local changes to save"; then
    printf "Pas de changements locaux a sauvegarder\n"
  else
    printf "%s\n" "$output"
  fi
  exit "$code"
fi
exec "$REAL_GIT" "$@"
`
    );

    const chmodResult = Bun.spawnSync(["chmod", "+x", wrapperPath], {
      stdout: "ignore",
      stderr: "pipe",
    });
    if (chmodResult.exitCode !== 0) {
      throw new Error(`chmod failed: ${chmodResult.stderr.toString()}`);
    }

    const originalPath = process.env.PATH ?? "";
    process.env.PATH = `${wrapperDir}:${originalPath}`;

    try {
      const checkpoint = createCheckpoint(tempDir, "localized-clean");
      expect(checkpoint.kind).toBe("clean");
    } finally {
      process.env.PATH = originalPath;
      await rm(wrapperDir, { recursive: true, force: true });
    }

    const stashRefAfter = runGitStdout(tempDir, ["rev-parse", "--verify", "refs/stash"]);
    const stashListAfter = runGitStdout(tempDir, ["stash", "list"]);
    expect(stashRefAfter).toBe(stashRefBefore);
    expect(stashListAfter).toBe(stashListBefore);

    const status = runGitStdout(tempDir, ["status", "--porcelain"]);
    expect(status).toBe("");
  });

  test("discardCheckpoint removes checkpoint refs", async () => {
    await Bun.write(join(tempDir, "base.txt"), "dirty");
    const checkpoint = createCheckpoint(tempDir, "discard-me");
    expect(checkpoint.kind).toBe("ref");

    if (checkpoint.kind === "ref") {
      discardCheckpoint(tempDir, checkpoint);
      const checkRef = Bun.spawnSync(["git", "show-ref", "--verify", "--quiet", checkpoint.ref], {
        cwd: tempDir,
        stdout: "ignore",
        stderr: "ignore",
      });
      expect(checkRef.exitCode).not.toBe(0);
    }
  });

  test("discardCheckpoint no-ops for missing snapshot directory", () => {
    const missingSnapshot = {
      kind: "snapshot" as const,
      id: "missing",
      snapshotDir: join(tempDir, "missing-snapshot"),
    };
    expect(() => discardCheckpoint(tempDir, missingSnapshot)).not.toThrow();
  });

  test("discardCheckpoint no-ops for clean checkpoint", () => {
    const cleanCheckpoint = {
      kind: "clean" as const,
      id: "clean",
    };
    expect(() => discardCheckpoint(tempDir, cleanCheckpoint)).not.toThrow();
  });

  test("discardCheckpoint no-ops when checkpoint ref does not exist", () => {
    const missingRef = {
      kind: "ref" as const,
      id: "missing-ref",
      ref: "refs/ralph-review/checkpoints/missing-ref",
      commit: "deadbeef",
    };
    expect(() => discardCheckpoint(tempDir, missingRef)).not.toThrow();
  });

  test("throws contextual error when checkpoint stash creation fails", async () => {
    const restoreSpawnSync = patchGitSpawnSync(
      (command) => command[0] === "git" && command[1] === "stash" && command[2] === "push"
    );

    try {
      expect(() => createCheckpoint(tempDir, "stash-failure")).toThrow(
        "Failed to create checkpoint stash"
      );
    } finally {
      restoreSpawnSync();
    }
  });

  test("throws when deleting checkpoint ref fails", async () => {
    await Bun.write(join(tempDir, "base.txt"), "dirty");
    const checkpoint = createCheckpoint(tempDir, "delete-fail");
    if (checkpoint.kind !== "ref") {
      throw new Error("Expected ref checkpoint");
    }

    const restoreSpawnSync = patchGitSpawnSync(
      (command) => command[0] === "git" && command[1] === "update-ref" && command[2] === "-d"
    );

    try {
      expect(() => discardCheckpoint(tempDir, checkpoint)).toThrow("Failed to discard checkpoint");
    } finally {
      restoreSpawnSync();
    }
  });
});

describe("checkpoint management on unborn HEAD", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "git-checkpoint-unborn-test-"));
    initTestRepo(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("restores staged, unstaged, and untracked changes on rollback", async () => {
    await Bun.write(join(tempDir, "staged.txt"), "staged content");
    runGitIn(tempDir, ["add", "staged.txt"]);

    await Bun.write(join(tempDir, "mixed.txt"), "staged snapshot");
    runGitIn(tempDir, ["add", "mixed.txt"]);
    await Bun.write(join(tempDir, "mixed.txt"), "staged snapshot plus unstaged change");

    await Bun.write(join(tempDir, "untracked.txt"), "untracked content");

    const checkpoint = createCheckpoint(tempDir, "unborn");
    expect(checkpoint.kind).toBe("snapshot");

    await Bun.write(join(tempDir, "staged.txt"), "mutated staged");
    await Bun.write(join(tempDir, "mixed.txt"), "mutated mixed");
    await Bun.write(join(tempDir, "extra.txt"), "new file");
    runGitIn(tempDir, ["add", "extra.txt"]);

    rollbackToCheckpoint(tempDir, checkpoint);

    expect(await Bun.file(join(tempDir, "staged.txt")).text()).toBe("staged content");
    expect(await Bun.file(join(tempDir, "mixed.txt")).text()).toBe(
      "staged snapshot plus unstaged change"
    );
    expect(await Bun.file(join(tempDir, "untracked.txt")).exists()).toBe(true);
    expect(await Bun.file(join(tempDir, "extra.txt")).exists()).toBe(false);

    const status = runGitStdout(tempDir, ["status", "--porcelain"]);
    expect(status).toContain("A  staged.txt");
    expect(status).toContain("AM mixed.txt");
    expect(status).toContain("?? untracked.txt");
  });

  test("removes git index when snapshot index is unavailable", async () => {
    await Bun.write(join(tempDir, "staged.txt"), "staged content");
    runGitIn(tempDir, ["add", "staged.txt"]);

    const checkpoint = createCheckpoint(tempDir, "unborn-no-index");
    expect(checkpoint.kind).toBe("snapshot");
    if (checkpoint.kind !== "snapshot") {
      return;
    }

    await rm(join(checkpoint.snapshotDir, "index"), { force: true });
    await Bun.write(join(tempDir, "staged.txt"), "mutated");

    rollbackToCheckpoint(tempDir, checkpoint);

    expect(await Bun.file(join(tempDir, "staged.txt")).text()).toBe("staged content");
    expect(await Bun.file(join(tempDir, ".git", "index")).exists()).toBe(false);
  });

  test("throws contextual error when restoring snapshot archive fails", async () => {
    await Bun.write(join(tempDir, "tracked.txt"), "tracked");
    const checkpoint = createCheckpoint(tempDir, "unborn-broken-archive");
    expect(checkpoint.kind).toBe("snapshot");
    if (checkpoint.kind !== "snapshot") {
      return;
    }

    await rm(join(checkpoint.snapshotDir, "worktree.tar"), { force: true });

    expect(() => rollbackToCheckpoint(tempDir, checkpoint)).toThrow(
      "Failed to restore working tree snapshot"
    );
  });
});
