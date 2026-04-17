import { join } from "node:path";
import type { GitSessionWorktree } from "@/lib/git";
import type { persistDiscoverySnapshots as persistDiscoverySnapshotsType } from "@/lib/review-workflow/findings/artifact";

export interface FrozenDiscoverySnapshots {
  reviewedSnapshotPath: string;
  reviewedSnapshotRef: string;
  reviewedSnapshotFingerprint: string;
  handoffSnapshotPath: string;
  handoffSnapshotFingerprint: string;
  sourceRepoFingerprint: string;
}

function formatCommandError(stderr: string, stdout: string): string {
  return stderr || stdout || "command failed";
}

function runCommand(
  cwd: string,
  args: string[],
  context: string,
  options?: {
    trimStdout?: boolean;
  }
): string {
  const result = Bun.spawnSync(args, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    const stdout = result.stdout.toString().trim();
    throw new Error(`${context}: ${formatCommandError(stderr, stdout)}`);
  }

  const output = result.stdout.toString();
  return options?.trimStdout === false ? output : output.trim();
}

function quoteForShell(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function snapshotDirectoryExists(path: string): boolean {
  return (
    Bun.spawnSync(["test", "-d", path], {
      stdout: "ignore",
      stderr: "ignore",
    }).exitCode === 0
  );
}

export function assertSnapshotDirectoryExists(description: string, snapshotPath: string): void {
  if (!snapshotDirectoryExists(snapshotPath)) {
    throw new Error(`${description} is missing: ${snapshotPath}`);
  }
}

export function copySnapshotDirectoryPreservingMetadata(
  sourcePath: string,
  destinationPath: string
): void {
  assertSnapshotDirectoryExists("Snapshot source path", sourcePath);
  const normalizedSourcePath = sourcePath.replace(/\/+$/u, "");
  const normalizedDestinationPath = destinationPath.replace(/\/+$/u, "");
  const sourcePathQuoted = quoteForShell(sourcePath);
  const destinationPathQuoted = quoteForShell(destinationPath);
  const excludeDestinationFromSource =
    normalizedDestinationPath.length > normalizedSourcePath.length &&
    normalizedDestinationPath.startsWith(`${normalizedSourcePath}/`);
  const destinationRelativeToSource = excludeDestinationFromSource
    ? normalizedDestinationPath.slice(normalizedSourcePath.length + 1)
    : "";
  const tarExcludeClause = excludeDestinationFromSource
    ? ` --exclude=${quoteForShell(`./${destinationRelativeToSource}`)}`
    : "";
  runCommand(
    sourcePath,
    [
      "sh",
      "-lc",
      `mkdir -p ${destinationPathQuoted} && tar -C ${sourcePathQuoted}${tarExcludeClause} -cf - . | tar -C ${destinationPathQuoted} -xf -`,
    ],
    `Failed to copy snapshot from ${sourcePath} to ${destinationPath}`
  );
}

export async function hasRootGitignore(path: string): Promise<boolean> {
  return await Bun.file(join(path, ".gitignore")).exists();
}

export async function computeSnapshotDirectoryFingerprint(snapshotPath: string): Promise<string> {
  assertSnapshotDirectoryExists("Snapshot path", snapshotPath);

  const script = `
find . -mindepth 1 \\( -type f -o -type l \\) -print0 |
perl -0ne '
  use strict;
  use warnings;

  my @paths = sort grep { length $_ } split(/\\0/, $_);
  my @parts = ("snapshot-v2");

  for my $path (@paths) {
    $path =~ s#^\\./##;

    my @stat = lstat($path);
    die "Failed to stat $path" if !@stat;
    my $mode = sprintf("%04o", $stat[2] & 07777);

    if (-l $path) {
      my $target = readlink($path);
      push @parts, "l", $path, $mode, defined($target) ? $target : "";
      next;
    }

    if (-f $path) {
      open my $fh, "-|", "git", "hash-object", "--no-filters", "--", $path
        or die "Failed to hash file $path: $!";
      my $hash = <$fh>;
      close $fh or die "Failed to hash file $path";
      chomp $hash;
      push @parts, "f", $path, $mode, $hash;
      next;
    }
  }

  binmode STDOUT;
  print join("\\0", @parts);
' |
git hash-object --stdin
`;

  return runCommand(
    snapshotPath,
    ["sh", "-lc", script],
    `Failed to fingerprint snapshot directory ${snapshotPath}`
  );
}

export async function freezeDiscoverySnapshots(
  storageRoot: string,
  projectPath: string,
  sessionId: string,
  worktree: GitSessionWorktree,
  persistDiscoverySnapshots: typeof persistDiscoverySnapshotsType
): Promise<FrozenDiscoverySnapshots> {
  const persisted = await persistDiscoverySnapshots(storageRoot, projectPath, sessionId, {
    reviewedSnapshotSourcePath: worktree.agentProjectPath,
    handoffSnapshotSourceDir: worktree.sourceSnapshotDir ?? "",
    sourceRepoFingerprint: worktree.sourceFingerprint ?? "",
  });

  return {
    reviewedSnapshotPath: persisted.reviewedSnapshotPath,
    reviewedSnapshotRef: worktree.retainedBranch,
    reviewedSnapshotFingerprint: persisted.reviewedSnapshotFingerprint,
    handoffSnapshotPath: persisted.handoffSnapshotPath,
    handoffSnapshotFingerprint: persisted.handoffSnapshotFingerprint,
    sourceRepoFingerprint: persisted.sourceRepoFingerprint,
  };
}
