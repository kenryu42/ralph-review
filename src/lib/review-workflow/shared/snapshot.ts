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

export interface SnapshotCopyOptions {
  excludeRootEntries?: string[];
}

export interface SnapshotFingerprintOptions {
  excludeRootEntries?: string[];
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

function normalizeRootEntry(entry: string): string {
  return entry.replace(/^\/+/u, "").replace(/^\.\//u, "").replace(/\/+$/u, "");
}

function normalizeRootEntries(entries: string[] | undefined): string[] {
  return [
    ...new Set((entries ?? []).map(normalizeRootEntry).filter((entry) => entry.length > 0)),
  ].sort((left, right) => left.localeCompare(right));
}

function escapeForPerlDoubleQuotedString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/@/g, "\\@");
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

export function rootEntryExists(snapshotPath: string, entry: string): boolean {
  return (
    Bun.spawnSync(["test", "-e", join(snapshotPath, normalizeRootEntry(entry))], {
      stdout: "ignore",
      stderr: "ignore",
    }).exitCode === 0
  );
}

export function copySnapshotDirectoryPreservingMetadata(
  sourcePath: string,
  destinationPath: string,
  options?: SnapshotCopyOptions
): void {
  assertSnapshotDirectoryExists("Snapshot source path", sourcePath);
  const normalizedSourcePath = sourcePath.replace(/\/+$/u, "");
  const normalizedDestinationPath = destinationPath.replace(/\/+$/u, "");
  const sourcePathQuoted = quoteForShell(sourcePath);
  const destinationPathQuoted = quoteForShell(destinationPath);
  const excludeRootEntries = normalizeRootEntries(options?.excludeRootEntries);
  const excludeDestinationFromSource =
    normalizedDestinationPath.length > normalizedSourcePath.length &&
    normalizedDestinationPath.startsWith(`${normalizedSourcePath}/`);
  const destinationRelativeToSource = excludeDestinationFromSource
    ? normalizedDestinationPath.slice(normalizedSourcePath.length + 1)
    : "";

  const tarExcludes: string[] = [];
  for (const rootEntry of excludeRootEntries) {
    tarExcludes.push(`--exclude=${quoteForShell(`./${rootEntry}`)}`);
    tarExcludes.push(`--exclude=${quoteForShell(`./${rootEntry}/*`)}`);
  }

  if (excludeDestinationFromSource) {
    tarExcludes.push(`--exclude=${quoteForShell(`./${destinationRelativeToSource}`)}`);
    tarExcludes.push(`--exclude=${quoteForShell(`./${destinationRelativeToSource}/*`)}`);
  }

  const tarExcludeClause = tarExcludes.length > 0 ? ` ${tarExcludes.join(" ")}` : "";
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

export async function computeSnapshotDirectoryFingerprint(
  snapshotPath: string,
  options?: SnapshotFingerprintOptions
): Promise<string> {
  assertSnapshotDirectoryExists("Snapshot path", snapshotPath);
  const excludedRootEntries = normalizeRootEntries(options?.excludeRootEntries);
  const excludedRootEntriesPerl = excludedRootEntries
    .map((entry) => `"${escapeForPerlDoubleQuotedString(entry)}" => 1`)
    .join(", ");

  const script = `
find . -mindepth 1 \\( -type f -o -type l \\) -print0 |
perl -0e '
  use strict;
  use warnings;
  use Digest::SHA ();

  my %excluded_root_entries = (${excludedRootEntriesPerl});

  my $input = do { local $/; <STDIN> // "" };
  my @paths = sort grep { length $_ } split(/\\0/, $input);
  my $aggregate = Digest::SHA->new(256);
  $aggregate->add("snapshot-v3\\0");

  for my $path (@paths) {
    $path =~ s#^\\./##;
    my ($root_entry) = split(/\\//, $path, 2);
    next if exists $excluded_root_entries{$root_entry};

    my @stat = lstat($path);
    die "Failed to stat $path" if !@stat;
    my $mode = sprintf("%04o", $stat[2] & 07777);

    if (-l $path) {
      my $target = readlink($path);
      $target = "" if !defined $target;
      $aggregate->add("l\\0", $path, "\\0", $mode, "\\0", $target, "\\0");
      next;
    }

    if (-f $path) {
      open my $fh, "<", $path or die "Failed to open $path: $!";
      binmode $fh;
      my $file_hasher = Digest::SHA->new(256);
      $file_hasher->addfile($fh);
      close $fh or die "Failed to close $path";
      my $hash = $file_hasher->hexdigest;
      $aggregate->add("f\\0", $path, "\\0", $mode, "\\0", $hash, "\\0");
      next;
    }
  }

  print $aggregate->hexdigest;
'
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
