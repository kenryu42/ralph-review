import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_DIR } from "@/lib/config";
import { getProjectStorageDir } from "@/lib/logging";
import { sessionExists } from "@/lib/tmux";
import type { HandoffStatus, ReviewOutcome, ReviewPhase, ReviewSummary } from "@/lib/types";

const DEFAULT_BRANCH = "default";

export const SESSION_STATE_SCHEMA_VERSION = 2 as const;
export const HEARTBEAT_INTERVAL_MS = 5_000;
export const RUNNING_STALE_AFTER_MS = 20_000;
export const PENDING_STARTUP_TIMEOUT_MS = 45_000;
export const STOPPING_STALE_AFTER_MS = 20_000;

const SESSION_STATE_WRITE_QUEUES = new Map<string, Promise<void>>();

export type SessionStatus =
  | "pending"
  | "running"
  | "stopping"
  | "completed"
  | "failed"
  | "interrupted"
  | "stopped";

export type SessionMode = "background" | "foreground";

const ACTIVE_STATUSES: readonly SessionStatus[] = ["pending", "running", "stopping"];
const TERMINAL_STATUSES: readonly SessionStatus[] = [
  "completed",
  "failed",
  "interrupted",
  "stopped",
];

interface SessionStateGuardOptions {
  expectedSessionId?: string;
}

interface CreateSessionStateOptions {
  branch?: string;
  sessionId: string;
  state?: SessionStatus;
  mode?: SessionMode;
  pid?: number;
  startTime?: number;
  lastHeartbeat?: number;
  sessionPath?: string;
  worktreeProjectPath?: string;
  worktreeBranch?: string;
  worktreeMergeReady?: boolean;
  worktreeCommitSha?: string;
  endTime?: number;
  reason?: string;
  phase?: ReviewPhase;
  reviewOutcome?: ReviewOutcome;
  handoffStatus?: HandoffStatus;
  handoffUpdatedAt?: number;
  commitSha?: string;
  artifactPath?: string;
}

export interface SessionState {
  schemaVersion: 2;
  sessionId: string;
  sessionName: string;
  startTime: number;
  lastHeartbeat: number;
  pid: number;
  projectPath: string;
  branch: string;
  state: SessionStatus;
  mode: SessionMode;
  sessionPath?: string;
  worktreeProjectPath?: string;
  worktreeBranch?: string;
  worktreeMergeReady?: boolean;
  worktreeCommitSha?: string;
  endTime?: number;
  reason?: string;
  phase?: ReviewPhase;
  reviewOutcome?: ReviewOutcome;
  handoffStatus?: HandoffStatus;
  handoffUpdatedAt?: number;
  commitSha?: string;
  artifactPath?: string;
  iteration?: number;
  currentAgent?: "reviewer" | "fixer" | "code-simplifier" | null;
  reviewSummary?: ReviewSummary;
  codexReviewText?: string;
}

export interface ActiveSession extends SessionState {
  sessionStatePath: string;
}

function queueSessionStateWrite<T>(sessionStatePath: string, task: () => Promise<T>): Promise<T> {
  const previous = SESSION_STATE_WRITE_QUEUES.get(sessionStatePath) ?? Promise.resolve();

  let releaseQueue: (() => void) | undefined;
  const queued = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  SESSION_STATE_WRITE_QUEUES.set(sessionStatePath, queued);

  return previous
    .catch(() => {
      // Keep queue progressing even if a previous write failed.
    })
    .then(task)
    .finally(() => {
      releaseQueue?.();
      if (SESSION_STATE_WRITE_QUEUES.get(sessionStatePath) === queued) {
        SESSION_STATE_WRITE_QUEUES.delete(sessionStatePath);
      }
    });
}

function isSessionStatus(value: unknown): value is SessionStatus {
  return (
    value === "pending" ||
    value === "running" ||
    value === "stopping" ||
    value === "completed" ||
    value === "failed" ||
    value === "interrupted" ||
    value === "stopped"
  );
}

function isActiveState(state: SessionStatus): boolean {
  return ACTIVE_STATUSES.includes(state);
}

function isTerminalState(state: SessionStatus): boolean {
  return TERMINAL_STATUSES.includes(state);
}

function sortSessionsNewestFirst<T extends SessionState>(sessions: T[]): T[] {
  return [...sessions].sort((left, right) => {
    if (left.startTime !== right.startTime) {
      return right.startTime - left.startTime;
    }

    return right.sessionId.localeCompare(left.sessionId);
  });
}

async function readJsonFile(path: string): Promise<string> {
  return await Bun.file(path).text();
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await Bun.write(path, JSON.stringify(value, null, 2));
}

async function removeFile(path: string): Promise<void> {
  await rm(path, { force: true });
}

async function readSessionStateByPath(sessionStatePath: string): Promise<SessionState | null> {
  try {
    const content = await readJsonFile(sessionStatePath);
    const raw = JSON.parse(content) as SessionState;

    if (
      !raw.sessionName ||
      typeof raw.startTime !== "number" ||
      typeof raw.projectPath !== "string" ||
      !raw.sessionId ||
      !isSessionStatus(raw.state)
    ) {
      return null;
    }

    return raw;
  } catch {
    return null;
  }
}

async function removeSessionStateByPath(
  sessionStatePath: string,
  options: SessionStateGuardOptions = {}
): Promise<boolean> {
  return queueSessionStateWrite(sessionStatePath, async () => {
    const existing = await readSessionStateByPath(sessionStatePath);
    if (!existing) {
      return false;
    }

    if (options.expectedSessionId && existing.sessionId !== options.expectedSessionId) {
      return false;
    }

    try {
      await removeFile(sessionStatePath);
      return true;
    } catch {
      return false;
    }
  });
}

async function listProjectSessionStatePaths(
  storageRoot: string,
  projectPath: string
): Promise<string[]> {
  const projectDir = getProjectStorageDir(storageRoot, projectPath);
  const entries = await readdir(projectDir, { withFileTypes: true }).catch(() => []);

  return entries
    .filter(
      (entry) => entry.isFile() && entry.name.startsWith("session-") && entry.name.endsWith(".json")
    )
    .map((entry) => join(projectDir, entry.name));
}

async function listAllProjectSessionStatePaths(storageRoot: string): Promise<string[]> {
  const sessionStatePaths: string[] = [];
  const entries = await readdir(storageRoot, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const projectDir = join(storageRoot, entry.name);
    const projectEntries = await readdir(projectDir, { withFileTypes: true }).catch(() => []);
    for (const projectEntry of projectEntries) {
      if (
        !projectEntry.isFile() ||
        !projectEntry.name.startsWith("session-") ||
        !projectEntry.name.endsWith(".json")
      ) {
        continue;
      }

      sessionStatePaths.push(join(projectDir, projectEntry.name));
    }
  }

  return sessionStatePaths;
}

export function createSessionId(): string {
  return crypto.randomUUID();
}

export function getSessionStatePath(
  storageRoot: string = CONFIG_DIR,
  projectPath: string,
  sessionId: string
): string {
  return join(getProjectStorageDir(storageRoot, projectPath), `session-${sessionId}.json`);
}

export async function createSessionState(
  storageRoot: string = CONFIG_DIR,
  projectPath: string,
  sessionName: string,
  options: CreateSessionStateOptions
): Promise<void> {
  const normalizedSessionId = options.sessionId.trim();
  if (normalizedSessionId.length === 0) {
    throw new Error("sessionId is required");
  }

  const sessionStatePath = getSessionStatePath(storageRoot, projectPath, normalizedSessionId);
  const now = Date.now();
  const state = options.state ?? "pending";
  const startTime = options.startTime ?? now;

  const sessionState: SessionState = {
    schemaVersion: SESSION_STATE_SCHEMA_VERSION,
    sessionId: normalizedSessionId,
    sessionName,
    startTime,
    lastHeartbeat: options.lastHeartbeat ?? startTime,
    pid: options.pid ?? process.pid,
    projectPath,
    branch: options.branch?.trim() || DEFAULT_BRANCH,
    state,
    mode: options.mode ?? "background",
    sessionPath: options.sessionPath,
    worktreeProjectPath: options.worktreeProjectPath,
    worktreeBranch: options.worktreeBranch,
    worktreeMergeReady: options.worktreeMergeReady,
    worktreeCommitSha: options.worktreeCommitSha,
    endTime: options.endTime,
    reason: options.reason,
    phase: options.phase,
    reviewOutcome: options.reviewOutcome,
    handoffStatus: options.handoffStatus,
    handoffUpdatedAt: options.handoffUpdatedAt,
    commitSha: options.commitSha,
    artifactPath: options.artifactPath,
    currentAgent: null,
  };

  await queueSessionStateWrite(sessionStatePath, async () => {
    await mkdir(getProjectStorageDir(storageRoot, projectPath), { recursive: true });
    await writeJsonFile(sessionStatePath, sessionState);
  });
}

export async function readSessionState(
  storageRoot: string = CONFIG_DIR,
  projectPath: string,
  sessionId: string
): Promise<SessionState | null> {
  return await readSessionStateByPath(getSessionStatePath(storageRoot, projectPath, sessionId));
}

export async function updateSessionState(
  storageRoot: string = CONFIG_DIR,
  projectPath: string,
  sessionId: string,
  updates: Partial<SessionState>,
  options: SessionStateGuardOptions = {}
): Promise<boolean> {
  const sessionStatePath = getSessionStatePath(storageRoot, projectPath, sessionId);

  return await queueSessionStateWrite(sessionStatePath, async () => {
    const existing = await readSessionStateByPath(sessionStatePath);
    if (!existing) {
      return false;
    }

    if (options.expectedSessionId && existing.sessionId !== options.expectedSessionId) {
      return false;
    }

    const merged = { ...existing } as Record<string, unknown>;
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) {
        delete merged[key];
      } else {
        merged[key] = value;
      }
    }

    merged.schemaVersion = SESSION_STATE_SCHEMA_VERSION;

    await writeJsonFile(sessionStatePath, merged);
    return true;
  });
}

export async function touchSessionHeartbeat(
  storageRoot: string = CONFIG_DIR,
  projectPath: string,
  sessionId: string
): Promise<boolean> {
  return await updateSessionState(storageRoot, projectPath, sessionId, {
    lastHeartbeat: Date.now(),
  });
}

export async function removeSessionState(
  storageRoot: string = CONFIG_DIR,
  projectPath: string,
  sessionId: string,
  options: SessionStateGuardOptions = {}
): Promise<boolean> {
  return await removeSessionStateByPath(
    getSessionStatePath(storageRoot, projectPath, sessionId),
    options
  );
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function isSessionStateStale(sessionState: SessionState): Promise<boolean> {
  const now = Date.now();

  if (isTerminalState(sessionState.state)) {
    return true;
  }

  if (sessionState.state === "pending") {
    const pendingAge = now - sessionState.startTime;
    if (pendingAge < PENDING_STARTUP_TIMEOUT_MS) {
      return false;
    }
    return !(await sessionExists(sessionState.sessionName));
  }

  if (sessionState.state === "running") {
    const heartbeatAge = now - sessionState.lastHeartbeat;
    if (heartbeatAge <= RUNNING_STALE_AFTER_MS) {
      return false;
    }

    const alive = isProcessAlive(sessionState.pid);
    const hasTmuxSession = await sessionExists(sessionState.sessionName);
    return !alive || !hasTmuxSession;
  }

  if (sessionState.state === "stopping") {
    const heartbeatAge = now - sessionState.lastHeartbeat;
    if (heartbeatAge <= STOPPING_STALE_AFTER_MS) {
      return false;
    }

    const hasTmuxSession = await sessionExists(sessionState.sessionName);
    return !hasTmuxSession;
  }

  return false;
}

async function collectActiveSessions(sessionStatePaths: string[]): Promise<ActiveSession[]> {
  const sessions: ActiveSession[] = [];

  for (const sessionStatePath of sessionStatePaths) {
    const sessionState = await readSessionStateByPath(sessionStatePath);
    if (!sessionState) {
      continue;
    }

    if (await isSessionStateStale(sessionState)) {
      await removeSessionStateByPath(sessionStatePath, {
        expectedSessionId: sessionState.sessionId,
      });
      continue;
    }

    if (!isActiveState(sessionState.state)) {
      continue;
    }

    sessions.push({
      ...sessionState,
      sessionStatePath,
    });
  }

  return sortSessionsNewestFirst(sessions);
}

export async function cleanupStaleSessionStates(
  storageRoot: string = CONFIG_DIR,
  projectPath: string
): Promise<boolean> {
  let removedAny = false;

  for (const sessionStatePath of await listProjectSessionStatePaths(storageRoot, projectPath)) {
    const sessionState = await readSessionStateByPath(sessionStatePath);
    if (!sessionState) {
      continue;
    }

    if (await isSessionStateStale(sessionState)) {
      const removed = await removeSessionStateByPath(sessionStatePath, {
        expectedSessionId: sessionState.sessionId,
      });
      removedAny = removed || removedAny;
    }
  }

  return removedAny;
}

export async function listProjectActiveSessions(
  storageRoot: string = CONFIG_DIR,
  projectPath: string
): Promise<ActiveSession[]> {
  return await collectActiveSessions(await listProjectSessionStatePaths(storageRoot, projectPath));
}

export async function getLatestProjectActiveSession(
  storageRoot: string = CONFIG_DIR,
  projectPath: string
): Promise<ActiveSession | null> {
  const sessions = await listProjectActiveSessions(storageRoot, projectPath);
  return sessions[0] ?? null;
}

export async function listAllActiveSessions(
  storageRoot: string = CONFIG_DIR
): Promise<ActiveSession[]> {
  return await collectActiveSessions(await listAllProjectSessionStatePaths(storageRoot));
}

export async function removeAllSessionStates(storageRoot: string = CONFIG_DIR): Promise<void> {
  for (const sessionStatePath of await listAllProjectSessionStatePaths(storageRoot)) {
    const sessionState = await readSessionStateByPath(sessionStatePath);
    if (!sessionState) {
      continue;
    }

    await removeSessionStateByPath(sessionStatePath, {
      expectedSessionId: sessionState.sessionId,
    });
  }
}
