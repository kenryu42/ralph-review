import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeBaseWithHead } from "@/lib/git";

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
}

/**
 * Create a commit with an empty file
 */
function commit(repoPath: string, filename: string, message: string): void {
  Bun.spawnSync(["touch", filename], { cwd: repoPath });
  runGitIn(repoPath, ["add", filename]);
  runGitIn(repoPath, ["commit", "-m", message]);
}

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
