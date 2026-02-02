function runGitForStdout(cwd: string, args: string[]): string | undefined {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return undefined;
  return result.stdout.toString().trim();
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
