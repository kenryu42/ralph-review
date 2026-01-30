/**
 * Git utilities for ralph-review
 * Provides merge-base resolution for branch comparison
 *
 * Ported from codex-rs/utils/git/src/branch.rs
 */

/**
 * Run a git command and return stdout (trimmed).
 * Returns undefined if the command fails.
 */
function runGitForStdout(cwd: string, args: string[]): string | undefined {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return undefined;
  return result.stdout.toString().trim();
}

/**
 * Async version of runGitForStdout for non-blocking git operations.
 */
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

/**
 * Verify that the given path is inside a git work tree.
 */
export function ensureGitRepository(path: string): boolean {
  const output = runGitForStdout(path, ["rev-parse", "--is-inside-work-tree"]);
  return output === "true";
}

/**
 * Async version of ensureGitRepository for non-blocking checks.
 * Preferred for use in UI refresh loops.
 */
export async function ensureGitRepositoryAsync(path: string): Promise<boolean> {
  const output = await runGitForStdoutAsync(path, ["rev-parse", "--is-inside-work-tree"]);
  return output === "true";
}

/**
 * Get the repository root directory.
 */
function resolveRepositoryRoot(path: string): string | undefined {
  return runGitForStdout(path, ["rev-parse", "--show-toplevel"]);
}

/**
 * Get the current HEAD commit SHA.
 * Returns undefined if HEAD is unborn (no commits yet).
 */
function resolveHead(repoRoot: string): string | undefined {
  return runGitForStdout(repoRoot, ["rev-parse", "--verify", "HEAD"]);
}

/**
 * Resolve a branch reference to its commit SHA.
 * Returns undefined if the branch doesn't exist.
 */
function resolveBranchRef(repoRoot: string, branch: string): string | undefined {
  return runGitForStdout(repoRoot, ["rev-parse", "--verify", branch]);
}

/**
 * Check if the remote tracking branch is ahead of the local branch.
 * If so, returns the upstream ref name (e.g., "origin/main").
 * Returns undefined if no upstream, or local is not behind.
 */
function resolveUpstreamIfRemoteAhead(repoRoot: string, branch: string): string | undefined {
  // Get the upstream tracking branch name
  const upstream = runGitForStdout(repoRoot, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    `${branch}@{upstream}`,
  ]);

  if (!upstream) return undefined;

  // Count commits ahead/behind between local and upstream
  // Format: "<local ahead>\t<remote ahead>"
  const counts = runGitForStdout(repoRoot, [
    "rev-list",
    "--left-right",
    "--count",
    `${branch}...${upstream}`,
  ]);

  if (!counts) return undefined;

  const parts = counts.split(/\s+/);
  const right = parseInt(parts[1] ?? "0", 10);

  // If remote is ahead (has commits local doesn't have), return upstream
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
  // 1. Verify we're in a git repository
  if (!ensureGitRepository(repoPath)) {
    return undefined;
  }

  // 2. Resolve repository root
  const repoRoot = resolveRepositoryRoot(repoPath);
  if (!repoRoot) {
    return undefined;
  }

  // 3. Resolve HEAD
  const head = resolveHead(repoRoot);
  if (!head) {
    return undefined;
  }

  // 4. Resolve the branch reference
  const branchRef = resolveBranchRef(repoRoot, branch);
  if (!branchRef) {
    return undefined;
  }

  // 5. Check if upstream is ahead - if so, prefer the upstream ref
  const upstream = resolveUpstreamIfRemoteAhead(repoRoot, branch);
  let preferredRef = branchRef;

  if (upstream) {
    const upstreamRef = resolveBranchRef(repoRoot, upstream);
    if (upstreamRef) {
      preferredRef = upstreamRef;
    }
  }

  // 6. Compute the merge-base
  return runGitForStdout(repoRoot, ["merge-base", head, preferredRef]);
}
