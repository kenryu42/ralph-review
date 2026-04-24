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
  apply: boolean;
  discard: boolean;
  sessionId?: string;
  olderThanMs?: number;
  allProjects: boolean;
  force: boolean;
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
    apply: parsed.values.apply === true,
    discard: parsed.values.discard === true,
    sessionId: typeof parsed.values.session === "string" ? parsed.values.session : undefined,
    olderThanMs:
      typeof parsed.values["older-than"] === "string"
        ? parseOlderThan(parsed.values["older-than"])
        : undefined,
    allProjects: parsed.values["all-projects"] === true,
    force: parsed.values.force === true,
  };
}

function rejectInvalidDiscardOptions(options: ParsedPruneOptions, deps: PruneCommandDeps): boolean {
  if (!options.discard) {
    return false;
  }

  if (options.apply || options.force || options.olderThanMs !== undefined || options.allProjects) {
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

async function removePath(path: string | undefined): Promise<void> {
  if (!path) {
    return;
  }

  await Bun.file(path)
    .delete()
    .catch(() => {});
}

async function removeSessionWorktreeDir(
  storageRoot: string,
  projectPath: string,
  sessionId: string
): Promise<void> {
  const worktreesDir = getProjectWorktreesDir(storageRoot, projectPath);
  const entries = await readdir(worktreesDir).catch(() => []);
  for (const entry of entries) {
    if (!entry.startsWith(sessionId)) {
      continue;
    }
    await rm(join(worktreesDir, entry), { recursive: true, force: true });
  }
}

async function applyCandidate(candidate: PruneCandidate, storageRoot: string): Promise<void> {
  await removeSessionWorktreeDir(storageRoot, candidate.projectPath, candidate.sessionId);
  if (isGitRepository(candidate.projectPath)) {
    deleteSessionRefs(candidate.projectPath, candidate.sessionId);
  }
  await removePath(candidate.pendingMetadataPath);
  await removePath(candidate.pendingPatchPath);
  await removePath(candidate.artifactPath);
  await removePath(candidate.logPath);
}

export async function runPrune(
  args: string[],
  deps: Partial<PruneCommandDeps> = {}
): Promise<void> {
  const pruneDeps = { ...DEFAULT_PRUNE_DEPS, ...deps };
  const options = parsePruneOptions(args, pruneDeps);
  if (rejectInvalidDiscardOptions(options, pruneDeps)) {
    return;
  }

  if (options.discard) {
    await runDiscardMode(options, pruneDeps);
    return;
  }

  const projectPaths = await collectProjectPaths(
    pruneDeps.storageRoot,
    pruneDeps.cwd(),
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
    pruneDeps.logInfo("No prunable review sessions found.");
    return;
  }

  if (!options.apply) {
    for (const candidate of candidates) {
      pruneDeps.logInfo(
        `Would prune ${candidate.sessionId} in ${candidate.projectPath}: ${candidate.reason}`
      );
    }
    return;
  }

  for (const candidate of candidates) {
    await applyCandidate(candidate, pruneDeps.storageRoot);
  }

  pruneDeps.logSuccess(`Pruned ${candidates.length} review session(s).`);
}
