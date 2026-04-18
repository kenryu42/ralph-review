import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import * as p from "@clack/prompts";
import { getCommandDef } from "@/cli";
import { parseCommand } from "@/lib/cli-parser";
import { CONFIG_DIR } from "@/lib/config";
import { deleteSessionRefs } from "@/lib/git";
import { listProjectArchivedHandoffs, listProjectPendingHandoffs } from "@/lib/handoff";
import { getProjectStorageDir, getProjectWorktreesDir } from "@/lib/logging";

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
  keepArchivedHistory: boolean;
  pendingMetadataPath?: string;
  pendingPatchPath?: string;
  archivedMetadataPath?: string;
  archivedPatchPath?: string;
  refs: SessionRef[];
  timestampMs: number;
}

export interface PruneCommandDeps {
  getCommandDef: typeof getCommandDef;
  parseCommand: typeof parseCommand;
  cwd: () => string;
  storageRoot: string;
  now: () => number;
  listProjectPendingHandoffs: typeof listProjectPendingHandoffs;
  listProjectArchivedHandoffs: typeof listProjectArchivedHandoffs;
  logInfo: (message: string) => void;
  logSuccess: (message: string) => void;
  logWarn: (message: string) => void;
  logError: (message: string) => void;
  exit: (code: number) => void;
}

const DEFAULT_PRUNE_DEPS: PruneCommandDeps = {
  getCommandDef,
  parseCommand,
  cwd: () => process.cwd(),
  storageRoot: CONFIG_DIR,
  now: () => Date.now(),
  listProjectPendingHandoffs,
  listProjectArchivedHandoffs,
  logInfo: (message: string) => p.log.info(message),
  logSuccess: (message: string) => p.log.success(message),
  logWarn: (message: string) => p.log.warn(message),
  logError: (message: string) => p.log.error(message),
  exit: (code: number) => process.exit(code),
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
    sessionId: typeof parsed.values.session === "string" ? parsed.values.session : undefined,
    olderThanMs:
      typeof parsed.values["older-than"] === "string"
        ? parseOlderThan(parsed.values["older-than"])
        : undefined,
    allProjects: parsed.values["all-projects"] === true,
    force: parsed.values.force === true,
  };
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
  sessionId: string
): string {
  return join(getProjectStorageDir(storageRoot, projectPath), "handoffs", `${sessionId}.json`);
}

function buildArchivedMetadataPath(
  storageRoot: string,
  projectPath: string,
  sessionId: string
): string {
  return join(
    getProjectStorageDir(storageRoot, projectPath),
    "handoff-history",
    `${sessionId}.json`
  );
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
    const historyDir = join(storageRoot, projectDir, "handoff-history");
    const jsonPaths = [
      ...(await readdir(findingsDir).catch(() => [])).map((entry) => join(findingsDir, entry)),
      ...(await readdir(handoffsDir).catch(() => [])).map((entry) => join(handoffsDir, entry)),
      ...(await readdir(historyDir).catch(() => [])).map((entry) => join(historyDir, entry)),
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
  const result = Bun.spawnSync(
    ["git", "for-each-ref", "--format=%(refname)", "refs/ralph-review/sessions"],
    {
      cwd: projectPath,
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  if (result.exitCode !== 0) {
    return new Map();
  }

  const refsBySession = new Map<string, SessionRef[]>();
  for (const line of result.stdout
    .toString()
    .split("\n")
    .map((entry) => entry.trim())) {
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
  return (
    Bun.spawnSync(["git", "cat-file", "-e", `${baselineCommitSha}^{commit}`], {
      cwd: projectPath,
      stdout: "ignore",
      stderr: "ignore",
    }).exitCode === 0
  );
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

function pickTimestamp(candidate: {
  artifact?: StoredArtifactSummary;
  pendingUpdatedAt?: number;
  archivedAppliedAt?: number;
}): number {
  if (candidate.pendingUpdatedAt !== undefined) {
    return candidate.pendingUpdatedAt;
  }

  if (candidate.archivedAppliedAt !== undefined) {
    return candidate.archivedAppliedAt;
  }

  return candidate.artifact?.updatedAt ?? 0;
}

async function collectPruneCandidatesForProject(
  storageRoot: string,
  projectPath: string,
  options: ParsedPruneOptions,
  now: number,
  deps: Pick<PruneCommandDeps, "listProjectPendingHandoffs" | "listProjectArchivedHandoffs">
): Promise<PruneCandidate[]> {
  const artifactsById = await readStoredArtifacts(storageRoot, projectPath);
  const pendingHandoffs = await deps.listProjectPendingHandoffs(storageRoot, projectPath);
  const archivedHandoffs = await deps.listProjectArchivedHandoffs(storageRoot, projectPath);
  const refsBySession = await listProjectSessionRefs(projectPath);

  const sessionIds = new Set<string>([
    ...artifactsById.keys(),
    ...pendingHandoffs.map((handoff) => handoff.sessionId),
    ...archivedHandoffs.map((handoff) => handoff.sessionId),
    ...refsBySession.keys(),
  ]);

  const candidates: PruneCandidate[] = [];

  for (const sessionId of sessionIds) {
    if (options.sessionId && sessionId !== options.sessionId) {
      continue;
    }

    const artifact = artifactsById.get(sessionId);
    const pending = pendingHandoffs.find((handoff) => handoff.sessionId === sessionId);
    const archived = archivedHandoffs.find((handoff) => handoff.sessionId === sessionId);
    const refs = refsBySession.get(sessionId) ?? [];
    const activeWorktree = await hasSessionWorktree(storageRoot, projectPath, sessionId);

    let reason: string | undefined;
    let keepArchivedHistory = true;

    if (options.force && options.sessionId === sessionId) {
      reason = "forced session cleanup";
      keepArchivedHistory = false;
    } else if (pending || activeWorktree) {
      continue;
    } else if (artifact?.baselineCommitSha) {
      const baselineExists = await baselineCommitExists(projectPath, artifact.baselineCommitSha);
      if (!baselineExists) {
        reason = "artifact baseline is missing";
      } else if (archived) {
        reason = "applied session artifacts";
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
      archivedAppliedAt: archived?.appliedAt,
    });
    if (options.olderThanMs !== undefined && now - timestampMs < options.olderThanMs) {
      continue;
    }

    candidates.push({
      sessionId,
      projectPath,
      reason,
      artifactPath: artifact?.artifactPath,
      logPath: artifact?.logPath ?? pending?.logPath ?? archived?.logPath,
      keepArchivedHistory,
      pendingMetadataPath: pending
        ? buildPendingMetadataPath(storageRoot, projectPath, sessionId)
        : undefined,
      pendingPatchPath: pending ? pending.patchPath : undefined,
      archivedMetadataPath: archived
        ? buildArchivedMetadataPath(storageRoot, projectPath, sessionId)
        : undefined,
      archivedPatchPath: archived ? archived.patchPath : undefined,
      refs,
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
  deleteSessionRefs(candidate.projectPath, candidate.sessionId);
  await removePath(candidate.pendingMetadataPath);
  await removePath(candidate.pendingPatchPath);
  if (!candidate.keepArchivedHistory) {
    await removePath(candidate.archivedMetadataPath);
    await removePath(candidate.archivedPatchPath);
  }
  await removePath(candidate.artifactPath);
  await removePath(candidate.logPath);
}

export async function runPrune(
  args: string[],
  deps: Partial<PruneCommandDeps> = {}
): Promise<void> {
  const pruneDeps = { ...DEFAULT_PRUNE_DEPS, ...deps };
  const options = parsePruneOptions(args, pruneDeps);
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
