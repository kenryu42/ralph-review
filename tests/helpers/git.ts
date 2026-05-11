import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function runGitIn(repoPath: string, args: string[]): void {
  assertGitSuccess(args, runGit(repoPath, args));
}

export function runGitResult(
  repoPath: string,
  args: string[]
): { exitCode: number; stdout: string } {
  const result = runGit(repoPath, args);

  return {
    exitCode: result.exitCode,
    stdout: result.stdout?.toString() ?? "",
  };
}

export function runGitStdout(repoPath: string, args: string[]): string {
  const result = runGit(repoPath, args);
  assertGitSuccess(args, result);

  return result.stdout?.toString().trim() ?? "";
}

export function initTestRepo(repoPath: string): void {
  runGitIn(repoPath, ["init", "--initial-branch=main"]);
  configureTestRepo(repoPath);
}

export async function createStorageBackedRepo(storagePrefix: string, repoPrefix: string) {
  const storageRoot = await mkdtemp(join(tmpdir(), storagePrefix));
  const repoPath = await mkdtemp(join(tmpdir(), repoPrefix));
  await initTestRepoWithCommit(repoPath);
  return { repoPath, storageRoot };
}

export async function removeStorageBackedRepo(env: { repoPath: string; storageRoot: string }) {
  await rm(env.storageRoot, { recursive: true, force: true });
  await rm(env.repoPath, { recursive: true, force: true });
}

export async function initTestRepoWithCommit(
  repoPath: string,
  filename = "app.txt",
  content = "base\n"
): Promise<void> {
  initTestRepo(repoPath);
  await Bun.write(`${repoPath}/${filename}`, content, { createPath: true });
  runGitIn(repoPath, ["add", filename]);
  runGitIn(repoPath, ["commit", "-m", "initial commit"]);
}

export function initTestRepoWithObjectFormat(
  repoPath: string,
  objectFormat: "sha1" | "sha256"
): void {
  runGitIn(repoPath, ["init", `--object-format=${objectFormat}`, "--initial-branch=main"]);
  configureTestRepo(repoPath);
}

function configureTestRepo(repoPath: string): void {
  runGitIn(repoPath, ["config", "core.autocrlf", "false"]);
  runGitIn(repoPath, ["config", "user.name", "Tester"]);
  runGitIn(repoPath, ["config", "user.email", "test@example.com"]);
  runGitIn(repoPath, ["config", "commit.gpgsign", "false"]);
}

function runGit(repoPath: string, args: string[]): ReturnType<typeof Bun.spawnSync> {
  return Bun.spawnSync(["git", ...args], {
    cwd: repoPath,
    stdout: "pipe",
    stderr: "pipe",
  });
}

function assertGitSuccess(args: string[], result: ReturnType<typeof Bun.spawnSync>): void {
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr?.toString().trim() ?? ""}`);
  }
}
