import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import * as p from "@clack/prompts";
import { getCommandDef } from "@/cli";
import { resolvePendingHandoffSelection } from "@/commands/handoff-selection";
import { parseCommand } from "@/lib/cli-parser";
import { CONFIG_DIR } from "@/lib/config";
import { deleteSessionRefs } from "@/lib/git";
import { discardPendingHandoff, listProjectPendingHandoffs } from "@/lib/handoff";
import { appendLog, getProjectStorageDir, getProjectWorktreesDir } from "@/lib/logging";

type SessionRef = {
  kind: "baseline" | "source" | "final";
  ref: string;
  sessionId: string;
};

type StoredArtifactSummary = {
  sessionId: string;
  projectPath: string;
  artifactPath: string;
  logPath?: string;
  baselineCommitSha?: string;
  updatedAt?: number;
};

interface ParsedPruneOptions {
  dryRun: boolean;
  discard: boolean;
  sessionId?: string;
  olderThanMs?: number;
  allProjects: boolean;
  force: boolean;
  yes: boolean;
}

interface PruneCandidate {
  sessionId: string;
  projectPath: string;
  reason: string;
  artifactPath?: string;
  logPath?: string;
  pendingMetadataPath?: string;
  pendingPatchPath?: string;
  timestampMs: number;
}

export interface PruneCommandDeps {
  getCommandDef: typeof getCommandDef;
  parseCommand: typeof parseCommand;
  cwd: () => string;
  storageRoot: string;
  now: () => number;
  listProjectPendingHandoffs: typeof listProjectPendingHandoffs;
  discardPendingHandoff: typeof discardPendingHandoff;
  appendLog: typeof appendLog;
  logInfo: (message: string) => void;
  logStep: (message: string) => void;
  logSuccess: (message: string) => void;
  logWarn: (message: string) => void;
  logError: (message: string) => void;
  exit: (code: number) => void;
  isTTY: () => boolean;
  select: (input: {
    message: string;
    options: Array<{ value: string; label: string; hint: string }>;
  }) => Promise<unknown>;
  confirm: (input: { message: string }) => Promise<unknown>;
  isCancel: (value: unknown) => boolean;
}

const DEFAULT_PRUNE_DEPS: PruneCommandDeps = {
  getCommandDef,
  parseCommand,
  cwd: () => process.cwd(),
  storageRoot: CONFIG_DIR,
  now: () => Date.now(),
  listProjectPendingHandoffs,
  discardPendingHandoff,
  appendLog,
  logInfo: (message: string) => p.log.info(message),
  logStep: (message: string) => p.log.step(message),
  logSuccess: (message: string) => p.log.success(message),
  logWarn: (message: string) => p.log.warn(message),
  logError: (message: string) => p.log.error(message),
  exit: (code: number) => process.exit(code),
  isTTY: () => process.stdout.isTTY === true,
  select: (input) => p.select(input),
  confirm: (input) => p.confirm(input),
  isCancel: (value) => p.isCancel(value),
};

function parseOlderThan(value: string): number {
  const match = /^(\d+)([mhd])$/u.exec(value.trim());
  if (!match) {
    throw new Error('Invalid --older-than value. Use formats like "30m", "12h", or "14d".');
  }

  const amount = Number.parseInt(match[1] ?? "0", 10);
  const unit = match[2];
  const multiplier = unit === "m" ? 60_000 : unit === "h" ? 60 * 60_000 : 24 * 60 * 60_000;
  return amount * multiplier;
}

function parsePruneOptions(args: string[], deps: PruneCommandDeps): ParsedPruneOptions {
  const commandDef = deps.getCommandDef("prune");
  if (!commandDef) {
    throw new Error("Prune command definition is missing.");
  }

  const parsed = deps.parseCommand(commandDef, args);
  return {
    dryRun: parsed.values["dry-run"] === true,
    discard: parsed.values.discard === true,
    sessionId: typeof parsed.values.session === "string" ? parsed.values.session : undefined,
    olderThanMs:
      typeof parsed.values["older-than"] === "string"
        ? parseOlderThan(parsed.values["older-than"])
        : undefined,
    allProjects: parsed.values["all-projects"] === true,
    force: parsed.values.force === true,
    yes: parsed.values.yes === true,
  };
}

function rejectInvalidPruneOptions(options: ParsedPruneOptions, deps: PruneCommandDeps): boolean {
  if (options.dryRun && options.yes) {
    deps.logError("Cannot combine --dry-run and --yes. Choose one mode and try again.");
    deps.exit(1);
    return true;
  }

  return false;
}

function rejectInvalidDiscardOptions(options: ParsedPruneOptions, deps: PruneCommandDeps): boolean {
  if (!options.discard) {
    return false;
  }

  if (
    options.dryRun ||
    options.yes ||
    options.force ||
    options.olderThanMs !== undefined ||
    options.allProjects
  ) {
    deps.logError(
      "--discard can only be combined with --session. Remove cleanup options and try again."
    );
    deps.exit(1);
    return true;
  }

  return false;
}

async function runDiscardMode(options: ParsedPruneOptions, deps: PruneCommandDeps): Promise<void> {
  const projectPath = deps.cwd();
  const handoffs = await deps.listProjectPendingHandoffs(deps.storageRoot, projectPath);

  if (handoffs.length === 0) {
    deps.logInfo("No pending review handoffs for current working directory.");
    return;
  }

  const selection = await resolvePendingHandoffSelection({
    handoffs,
    selector: options.sessionId,
    action: "discard",
    isTTY: deps.isTTY(),
    select: deps.select,
    isCancel: deps.isCancel,
  });

  if (!selection.handoff) {
    if (selection.error) {
      deps.logError(selection.error);
      deps.exit(1);
    }
    return;
  }

  deps.logStep(`Discarding handoff: ${selection.handoff.handoffId}`);
  const artifact = await deps.discardPendingHandoff(
    deps.storageRoot,
    projectPath,
    selection.handoff.handoffId
  );
  await deps.appendLog(artifact.logPath, {
    type: "handoff",
    timestamp: deps.now(),
    handoffId: artifact.handoffId,
    handoffStatus: "discarded",
    commitSha: artifact.commitSha,
  });
  deps.logSuccess("Review handoff discarded.");
}

async function readStoredArtifacts(
  storageRoot: string,
  projectPath: string
): Promise<Map<string, StoredArtifactSummary>> {
  const findingsDir = join(getProjectStorageDir(storageRoot, projectPath), "findings");
  const artifacts = new Map<string, StoredArtifactSummary>();
  const entries = await readdir(findingsDir).catch(() => []);

  for (const entry of entries) {
    if (!entry.endsWith(".json")) {
      continue;
    }

    const artifactPath = join(findingsDir, entry);
    const raw = await Bun.file(artifactPath)
      .json()
      .catch(() => null);
    if (!raw || typeof raw !== "object") {
      continue;
    }

    const candidate = raw as Record<string, unknown>;
    const sessionId = candidate.sessionId;
    const storedProjectPath = candidate.projectPath;
    if (typeof sessionId !== "string" || typeof storedProjectPath !== "string") {
      continue;
    }

    artifacts.set(sessionId, {
      sessionId,
      projectPath: storedProjectPath,
      artifactPath,
      logPath: typeof candidate.logPath === "string" ? candidate.logPath : undefined,
      baselineCommitSha:
        typeof candidate.baselineCommitSha === "string" ? candidate.baselineCommitSha : undefined,
      updatedAt:
        typeof candidate.updatedAt === "string"
          ? new Date(candidate.updatedAt).getTime()
          : undefined,
    });
  }

  return artifacts;
}

function buildPendingMetadataPath(
  storageRoot: string,
  projectPath: string,
  handoffId: string
): string {
  return join(getProjectStorageDir(storageRoot, projectPath), "handoffs", `${handoffId}.json`);
}

async function collectProjectPaths(
  storageRoot: string,
  currentProjectPath: string,
  allProjects: boolean
): Promise<Set<string>> {
  if (!allProjects) {
    return new Set([currentProjectPath]);
  }

  const paths = new Set<string>();
  const projectDirs = await readdir(storageRoot).catch(() => []);

  for (const projectDir of projectDirs) {
    const findingsDir = join(storageRoot, projectDir, "findings");
    const handoffsDir = join(storageRoot, projectDir, "handoffs");
    const jsonPaths = [
      ...(await readdir(findingsDir).catch(() => [])).map((entry) => join(findingsDir, entry)),
      ...(await readdir(handoffsDir).catch(() => [])).map((entry) => join(handoffsDir, entry)),
    ].filter((path) => path.endsWith(".json"));

    for (const candidatePath of jsonPaths) {
      const raw = await Bun.file(candidatePath)
        .json()
        .catch(() => null);
      const projectPath =
        raw && typeof raw === "object" && "projectPath" in raw ? raw.projectPath : undefined;
      if (typeof projectPath === "string" && projectPath.length > 0) {
        paths.add(projectPath);
      }
    }
  }

  if (paths.size === 0) {
    paths.add(currentProjectPath);
  }

  return paths;
}

async function listProjectSessionRefs(projectPath: string): Promise<Map<string, SessionRef[]>> {
  let result: ReturnType<typeof Bun.spawnSync>;
  try {
    result = Bun.spawnSync(
      ["git", "for-each-ref", "--format=%(refname)", "refs/ralph-review/sessions"],
      {
        cwd: projectPath,
        stdout: "pipe",
        stderr: "pipe",
      }
    );
  } catch {
    return new Map();
  }

  if (result.exitCode !== 0) {
    return new Map();
  }

  const stdout = result.stdout?.toString() ?? "";
  const refsBySession = new Map<string, SessionRef[]>();
  for (const line of stdout.split("\n").map((entry) => entry.trim())) {
    const match = /^refs\/ralph-review\/sessions\/([^/]+)\/(baseline|source|final)$/u.exec(line);
    if (!match) {
      continue;
    }

    const sessionId = match[1] ?? "";
    const kind = (match[2] ?? "baseline") as SessionRef["kind"];
    const refs = refsBySession.get(sessionId) ?? [];
    refs.push({ kind, ref: line, sessionId });
    refsBySession.set(sessionId, refs);
  }

  return refsBySession;
}

async function baselineCommitExists(
  projectPath: string,
  baselineCommitSha: string
): Promise<boolean> {
  try {
    return (
      Bun.spawnSync(["git", "cat-file", "-e", `${baselineCommitSha}^{commit}`], {
        cwd: projectPath,
        stdout: "ignore",
        stderr: "ignore",
      }).exitCode === 0
    );
  } catch {
    return false;
  }
}

function isGitRepository(projectPath: string): boolean {
  try {
    return (
      Bun.spawnSync(["git", "rev-parse", "--is-inside-work-tree"], {
        cwd: projectPath,
        stdout: "ignore",
        stderr: "ignore",
      }).exitCode === 0
    );
  } catch {
    return false;
  }
}

async function hasSessionWorktree(
  storageRoot: string,
  projectPath: string,
  sessionId: string
): Promise<boolean> {
  const worktreesDir = getProjectWorktreesDir(storageRoot, projectPath);
  const entries = await readdir(worktreesDir).catch(() => []);
  return entries.some((entry) => entry.startsWith(sessionId));
}

function extractSessionIdFromWorktreeEntry(entry: string): string | undefined {
  const match = /^(.*)-\d{13}-[0-9a-f]{8}$/u.exec(entry);
  const sessionId = match?.[1];
  return sessionId && sessionId.length > 0 ? sessionId : undefined;
}

async function listSessionIdsFromWorktrees(
  storageRoot: string,
  projectPath: string
): Promise<Set<string>> {
  const worktreesDir = getProjectWorktreesDir(storageRoot, projectPath);
  const entries = await readdir(worktreesDir).catch(() => []);
  const sessionIds = new Set<string>();

  for (const entry of entries) {
    const sessionId = extractSessionIdFromWorktreeEntry(entry);
    if (sessionId) {
      sessionIds.add(sessionId);
    }
  }

  return sessionIds;
}

function pickTimestamp(candidate: {
  artifact?: StoredArtifactSummary;
  pendingUpdatedAt?: number;
}): number {
  if (candidate.pendingUpdatedAt !== undefined) {
    return candidate.pendingUpdatedAt;
  }

  return candidate.artifact?.updatedAt ?? 0;
}

function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function formatRelativeAge(timestampMs: number, now: number): string {
  if (timestampMs <= 0) {
    return "updated unknown";
  }

  const elapsedMs = Math.max(0, now - timestampMs);
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  if (elapsedMinutes < 60) {
    return `updated ${pluralize(elapsedMinutes, "minute")} ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 48) {
    return `updated ${pluralize(elapsedHours, "hour")} ago`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `updated ${pluralize(elapsedDays, "day")} ago`;
}

function formatCandidateLine(
  candidate: PruneCandidate,
  currentProjectPath: string,
  now: number
): string {
  const project = candidate.projectPath === currentProjectPath ? "" : ` ${candidate.projectPath}`;
  return `  ${candidate.sessionId}${project} - ${candidate.reason} - ${formatRelativeAge(
    candidate.timestampMs,
    now
  )}`;
}

function logPruneCandidateSummary(
  candidates: PruneCandidate[],
  currentProjectPath: string,
  now: number,
  deps: Pick<PruneCommandDeps, "logInfo">
): void {
  deps.logInfo(`Found ${pluralize(candidates.length, "prunable review session")}.`);

  const currentProjectCandidates = candidates.filter(
    (candidate) => candidate.projectPath === currentProjectPath
  );
  const otherProjectCandidates = candidates.filter(
    (candidate) => candidate.projectPath !== currentProjectPath
  );

  if (currentProjectCandidates.length > 0) {
    deps.logInfo("Current project:");
    for (const candidate of currentProjectCandidates) {
      deps.logInfo(formatCandidateLine(candidate, currentProjectPath, now));
    }
  }

  if (otherProjectCandidates.length > 0) {
    deps.logInfo("Other projects:");
    for (const candidate of otherProjectCandidates) {
      deps.logInfo(formatCandidateLine(candidate, currentProjectPath, now));
    }
  }
}

function formatNoCandidatesMessage(options: ParsedPruneOptions): string {
  const scope = options.allProjects ? "across stored projects" : "for the current project";
  const ageFilter = options.olderThanMs === undefined ? "" : ` matching the --older-than filter`;

  return `No prunable review sessions found ${scope}${ageFilter}.`;
}

async function collectPruneCandidatesForProject(
  storageRoot: string,
  projectPath: string,
  options: ParsedPruneOptions,
  now: number,
  deps: Pick<PruneCommandDeps, "listProjectPendingHandoffs">
): Promise<PruneCandidate[]> {
  const artifactsById = await readStoredArtifacts(storageRoot, projectPath);
  const pendingHandoffs = await deps.listProjectPendingHandoffs(storageRoot, projectPath);
  const refsBySession = await listProjectSessionRefs(projectPath);
  const worktreeSessionIds = await listSessionIdsFromWorktrees(storageRoot, projectPath);

  const sessionIds = new Set<string>([
    ...artifactsById.keys(),
    ...pendingHandoffs.map((handoff) => handoff.sessionId),
    ...pendingHandoffs.map((handoff) => handoff.handoffId),
    ...refsBySession.keys(),
    ...worktreeSessionIds,
  ]);

  const candidates: PruneCandidate[] = [];

  for (const sessionId of sessionIds) {
    if (options.sessionId && sessionId !== options.sessionId) {
      continue;
    }

    const artifact = artifactsById.get(sessionId);
    const pending = pendingHandoffs.find(
      (handoff) => handoff.sessionId === sessionId || handoff.handoffId === sessionId
    );
    const refs = refsBySession.get(sessionId) ?? [];
    const activeWorktree = await hasSessionWorktree(storageRoot, projectPath, sessionId);

    let reason: string | undefined;

    if (options.force && options.sessionId === sessionId) {
      reason = "forced session cleanup";
    } else if (pending || activeWorktree) {
      continue;
    } else if (artifact?.baselineCommitSha) {
      const baselineExists = await baselineCommitExists(projectPath, artifact.baselineCommitSha);
      if (!baselineExists) {
        reason = "artifact baseline is missing";
      }
    } else if (refs.length > 0) {
      reason = "orphan session refs";
    }

    if (!reason) {
      continue;
    }

    const timestampMs = pickTimestamp({
      artifact,
      pendingUpdatedAt: pending?.updatedAt,
    });
    if (options.olderThanMs !== undefined && now - timestampMs < options.olderThanMs) {
      continue;
    }

    candidates.push({
      sessionId,
      projectPath,
      reason,
      artifactPath: artifact?.artifactPath,
      logPath: artifact?.logPath ?? pending?.logPath,
      pendingMetadataPath: pending
        ? buildPendingMetadataPath(storageRoot, projectPath, pending.handoffId)
        : undefined,
      pendingPatchPath: pending ? pending.patchPath : undefined,
      timestampMs,
    });
  }

  return candidates.sort((left, right) => left.sessionId.localeCompare(right.sessionId));
}

async function removePath(path: string | undefined): Promise<string | null> {
  if (!path) {
    return null;
  }

  const file = Bun.file(path);
  if (!(await file.exists())) {
    return null;
  }

  try {
    await file.delete();
    return null;
  } catch (error) {
    return `Failed to delete ${path}: ${error}`;
  }
}

async function removeSessionWorktreeDir(
  storageRoot: string,
  projectPath: string,
  sessionId: string
): Promise<string[]> {
  const worktreesDir = getProjectWorktreesDir(storageRoot, projectPath);
  const entries = await readdir(worktreesDir).catch(() => []);
  const errors: string[] = [];
  for (const entry of entries) {
    if (!entry.startsWith(sessionId)) {
      continue;
    }
    const worktreePath = join(worktreesDir, entry);
    try {
      await rm(worktreePath, { recursive: true, force: true });
    } catch (error) {
      errors.push(`Failed to delete ${worktreePath}: ${error}`);
    }
  }

  return errors;
}

async function pruneCandidate(candidate: PruneCandidate, storageRoot: string): Promise<string[]> {
  const errors = await removeSessionWorktreeDir(
    storageRoot,
    candidate.projectPath,
    candidate.sessionId
  );

  if (isGitRepository(candidate.projectPath)) {
    try {
      deleteSessionRefs(candidate.projectPath, candidate.sessionId);
    } catch (error) {
      errors.push(`${error}`);
    }
  }

  for (const pathError of await Promise.all([
    removePath(candidate.pendingMetadataPath),
    removePath(candidate.pendingPatchPath),
    removePath(candidate.artifactPath),
    removePath(candidate.logPath),
  ])) {
    if (pathError) {
      errors.push(pathError);
    }
  }

  return errors;
}

export async function runPrune(
  args: string[],
  deps: Partial<PruneCommandDeps> = {}
): Promise<void> {
  const pruneDeps = { ...DEFAULT_PRUNE_DEPS, ...deps };
  const options = parsePruneOptions(args, pruneDeps);
  if (rejectInvalidPruneOptions(options, pruneDeps)) {
    return;
  }
  if (rejectInvalidDiscardOptions(options, pruneDeps)) {
    return;
  }

  if (options.discard) {
    await runDiscardMode(options, pruneDeps);
    return;
  }

  const currentProjectPath = pruneDeps.cwd();
  const projectPaths = await collectProjectPaths(
    pruneDeps.storageRoot,
    currentProjectPath,
    options.allProjects
  );
  const now = pruneDeps.now();

  const candidates = (
    await Promise.all(
      [...projectPaths].map((projectPath) =>
        collectPruneCandidatesForProject(
          pruneDeps.storageRoot,
          projectPath,
          options,
          now,
          pruneDeps
        )
      )
    )
  ).flat();

  if (options.sessionId && candidates.length === 0) {
    pruneDeps.logError(`No prunable review session matches "${options.sessionId}".`);
    pruneDeps.exit(1);
    return;
  }

  if (candidates.length === 0) {
    pruneDeps.logInfo(formatNoCandidatesMessage(options));
    return;
  }

  if (options.dryRun) {
    logPruneCandidateSummary(candidates, currentProjectPath, now, pruneDeps);
    pruneDeps.logInfo("Run rr prune to delete these artifacts.");
    return;
  }

  if (!options.yes) {
    if (!pruneDeps.isTTY()) {
      pruneDeps.logError(
        "Cannot prune without confirmation in a non-interactive terminal. Re-run with --yes to delete or --dry-run to preview."
      );
      pruneDeps.exit(1);
      return;
    }

    logPruneCandidateSummary(candidates, currentProjectPath, now, pruneDeps);
    pruneDeps.logInfo(`This will delete ${pluralize(candidates.length, "artifact set")}.`);
    const confirmed = await pruneDeps.confirm({
      message: `Delete ${pluralize(candidates.length, "prunable review session artifact set")}?`,
    });

    if (pruneDeps.isCancel(confirmed) || confirmed !== true) {
      pruneDeps.logInfo("Prune cancelled. No artifacts were deleted.");
      return;
    }
  }

  const failures: Array<{ candidate: PruneCandidate; errors: string[] }> = [];
  for (const candidate of candidates) {
    const errors = await pruneCandidate(candidate, pruneDeps.storageRoot);
    if (errors.length > 0) {
      failures.push({ candidate, errors });
    }
  }

  if (failures.length > 0) {
    pruneDeps.logError(
      `Failed to prune ${pluralize(failures.length, "review session")} out of ${candidates.length}.`
    );
    for (const failure of failures) {
      pruneDeps.logError(`  ${failure.candidate.sessionId}: ${failure.errors.join("; ")}`);
    }
    pruneDeps.exit(1);
    return;
  }

  pruneDeps.logSuccess(`Pruned ${candidates.length} review session(s).`);
}
