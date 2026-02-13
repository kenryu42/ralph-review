import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { LOGS_DIR } from "./config";
import { getProjectName } from "./logger";
import { sessionExists } from "./tmux";
import type { ReviewSummary } from "./types";

const DEFAULT_BRANCH = "default";

export const LOCK_SCHEMA_VERSION = 2 as const;
export const HEARTBEAT_INTERVAL_MS = 5_000;
export const RUNNING_STALE_AFTER_MS = 20_000;
export const PENDING_STARTUP_TIMEOUT_MS = 45_000;
export const STOPPING_STALE_AFTER_MS = 20_000;

const LOCK_WRITE_QUEUES = new Map<string, Promise<void>>();

export type LockState =
  | "pending"
  | "running"
  | "stopping"
  | "completed"
  | "failed"
  | "interrupted"
  | "stopped";

export type LockMode = "background" | "foreground";

type LockStatus =
  | "pending"
  | "running"
  | "stopping"
  | "completed"
  | "failed"
  | "interrupted"
  | "stopped";

const ACTIVE_STATES: readonly LockState[] = ["pending", "running", "stopping"];
const TERMINAL_STATES: readonly LockState[] = ["completed", "failed", "interrupted", "stopped"];

interface LockfileGuardOptions {
  expectedSessionId?: string;
}

interface CreateLockfileOptions {
  branch?: string;
  sessionId?: string;
  state?: LockState;
  mode?: LockMode;
  pid?: number;
  startTime?: number;
  lastHeartbeat?: number;
  sessionPath?: string;
  endTime?: number;
  reason?: string;
}

type LegacyLockData = Omit<Partial<LockData>, "schemaVersion" | "state" | "status"> & {
  schemaVersion?: number;
  state?: string;
  status?: string;
};

export interface LockData {
  schemaVersion: 2;
  sessionId: string;
  sessionName: string;
  startTime: number;
  lastHeartbeat: number;
  pid: number;
  projectPath: string;
  branch: string;
  state: LockState;
  mode: LockMode;
  sessionPath?: string;
  endTime?: number;
  reason?: string;
  iteration?: number;
  status?: LockStatus;
  currentAgent?: "reviewer" | "fixer" | "code-simplifier" | null;
  reviewSummary?: ReviewSummary;
  codexReviewText?: string;
}

export interface ActiveSession extends LockData {
  lockPath: string;
}

function queueLockWrite<T>(lockPath: string, task: () => Promise<T>): Promise<T> {
  const previous = LOCK_WRITE_QUEUES.get(lockPath) ?? Promise.resolve();

  let releaseQueue: (() => void) | undefined;
  const queued = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  LOCK_WRITE_QUEUES.set(lockPath, queued);

  return previous
    .catch(() => {
      // Keep queue progressing even if previous write failed.
    })
    .then(task)
    .finally(() => {
      releaseQueue?.();
      if (LOCK_WRITE_QUEUES.get(lockPath) === queued) {
        LOCK_WRITE_QUEUES.delete(lockPath);
      }
    });
}

function parseCreateLockfileOptions(
  branchOrOptions?: string | CreateLockfileOptions
): CreateLockfileOptions {
  if (typeof branchOrOptions === "string") {
    return { branch: branchOrOptions };
  }

  return branchOrOptions ?? {};
}

function isLockState(value: unknown): value is LockState {
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

function mapLegacyStatusToState(status: unknown): LockState {
  if (status === "pending") return "pending";
  if (status === "running") return "running";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "interrupted") return "interrupted";
  if (status === "stopped") return "stopped";
  if (status === "stopping") return "stopping";
  return "running";
}

function deriveLegacySessionId(raw: LegacyLockData): string {
  const projectPath = raw.projectPath ?? "unknown";
  const sessionName = raw.sessionName ?? "unknown";
  const startTime = raw.startTime ?? 0;
  return `legacy:${projectPath}:${sessionName}:${startTime}`;
}

function lockStateToStatus(state: LockState): LockStatus {
  return state;
}

async function readLockfileByPath(lockPath: string): Promise<LockData | null> {
  const file = Bun.file(lockPath);

  if (!(await file.exists())) {
    return null;
  }

  try {
    const content = await file.text();
    const raw = JSON.parse(content) as LegacyLockData;
    return normalizeLegacyLockData(raw);
  } catch {
    return null;
  }
}

async function removeLockfileByPath(
  lockPath: string,
  options: LockfileGuardOptions = {}
): Promise<boolean> {
  return queueLockWrite(lockPath, async () => {
    const existing = await readLockfileByPath(lockPath);
    if (!existing) {
      return false;
    }

    if (options.expectedSessionId && existing.sessionId !== options.expectedSessionId) {
      return false;
    }

    try {
      await Bun.file(lockPath).delete();
      return true;
    } catch {
      return false;
    }
  });
}

export function createSessionId(): string {
  return crypto.randomUUID();
}

function isActiveState(state: LockState): boolean {
  return ACTIVE_STATES.includes(state);
}

function isTerminalState(state: LockState): boolean {
  return TERMINAL_STATES.includes(state);
}

function normalizeLegacyLockData(lockData: LegacyLockData): LockData | null {
  if (
    !lockData.sessionName ||
    typeof lockData.startTime !== "number" ||
    typeof lockData.projectPath !== "string"
  ) {
    return null;
  }

  const state = isLockState(lockData.state)
    ? lockData.state
    : mapLegacyStatusToState(lockData.status);
  const mode: LockMode = lockData.mode === "foreground" ? "foreground" : "background";
  const startTime = lockData.startTime;

  return {
    schemaVersion: LOCK_SCHEMA_VERSION,
    sessionId: lockData.sessionId ?? deriveLegacySessionId(lockData),
    sessionName: lockData.sessionName,
    startTime,
    lastHeartbeat: lockData.lastHeartbeat ?? startTime,
    pid: typeof lockData.pid === "number" ? lockData.pid : 0,
    projectPath: lockData.projectPath,
    branch: lockData.branch?.trim() || DEFAULT_BRANCH,
    state,
    mode,
    sessionPath: lockData.sessionPath,
    endTime: lockData.endTime,
    reason: lockData.reason,
    iteration: lockData.iteration,
    status: isLockState(lockData.status) ? lockData.status : lockStateToStatus(state),
    currentAgent: lockData.currentAgent ?? null,
    reviewSummary: lockData.reviewSummary,
    codexReviewText: lockData.codexReviewText,
  };
}

export function getLockPath(logsDir: string = LOGS_DIR, projectPath: string): string {
  const projectName = getProjectName(projectPath);
  return join(logsDir, `${projectName}.lock`);
}

export async function createLockfile(
  logsDir: string = LOGS_DIR,
  projectPath: string,
  sessionName: string,
  branchOrOptions?: string | CreateLockfileOptions
): Promise<void> {
  const lockPath = getLockPath(logsDir, projectPath);
  const options = parseCreateLockfileOptions(branchOrOptions);
  const now = Date.now();
  const state = options.state ?? "pending";
  const startTime = options.startTime ?? now;

  const lockData: LockData = {
    schemaVersion: LOCK_SCHEMA_VERSION,
    sessionId: options.sessionId ?? createSessionId(),
    sessionName,
    startTime,
    lastHeartbeat: options.lastHeartbeat ?? startTime,
    pid: options.pid ?? process.pid,
    projectPath,
    branch: options.branch?.trim() || DEFAULT_BRANCH,
    state,
    mode: options.mode ?? "background",
    sessionPath: options.sessionPath,
    endTime: options.endTime,
    reason: options.reason,
    status: lockStateToStatus(state),
    currentAgent: null,
  };

  await queueLockWrite(lockPath, async () => {
    await Bun.write(lockPath, JSON.stringify(lockData, null, 2));
  });
}

export async function readLockfile(
  logsDir: string = LOGS_DIR,
  projectPath: string
): Promise<LockData | null> {
  const lockPath = getLockPath(logsDir, projectPath);
  return readLockfileByPath(lockPath);
}

export async function removeLockfile(
  logsDir: string = LOGS_DIR,
  projectPath: string,
  options: LockfileGuardOptions = {}
): Promise<boolean> {
  const lockPath = getLockPath(logsDir, projectPath);
  return removeLockfileByPath(lockPath, options);
}

export async function updateLockfile(
  logsDir: string = LOGS_DIR,
  projectPath: string,
  updates: Partial<LockData>,
  options: LockfileGuardOptions = {}
): Promise<boolean> {
  const lockPath = getLockPath(logsDir, projectPath);

  return queueLockWrite(lockPath, async () => {
    const existing = await readLockfileByPath(lockPath);
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

    if (typeof merged.state === "string" && isLockState(merged.state)) {
      merged.status = lockStateToStatus(merged.state);
    } else if (typeof merged.status === "string") {
      const resolvedState = mapLegacyStatusToState(merged.status);
      merged.state = resolvedState;
      merged.status = lockStateToStatus(resolvedState);
    }

    merged.schemaVersion = LOCK_SCHEMA_VERSION;

    await Bun.write(lockPath, JSON.stringify(merged, null, 2));
    return true;
  });
}

export async function touchHeartbeat(
  logsDir: string = LOGS_DIR,
  projectPath: string,
  expectedSessionId?: string
): Promise<boolean> {
  return updateLockfile(
    logsDir,
    projectPath,
    {
      lastHeartbeat: Date.now(),
    },
    {
      expectedSessionId,
    }
  );
}

export async function lockfileExists(
  logsDir: string = LOGS_DIR,
  projectPath: string
): Promise<boolean> {
  const lockPath = getLockPath(logsDir, projectPath);
  return await Bun.file(lockPath).exists();
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

async function isLockDataStale(lockData: LockData): Promise<boolean> {
  const now = Date.now();

  if (isTerminalState(lockData.state)) {
    return true;
  }

  if (lockData.state === "pending") {
    const pendingAge = now - lockData.startTime;
    if (pendingAge < PENDING_STARTUP_TIMEOUT_MS) {
      return false;
    }
    return !(await sessionExists(lockData.sessionName));
  }

  if (lockData.state === "running") {
    const heartbeatAge = now - lockData.lastHeartbeat;
    if (heartbeatAge <= RUNNING_STALE_AFTER_MS) {
      return false;
    }

    const alive = isProcessAlive(lockData.pid);
    const hasTmuxSession = await sessionExists(lockData.sessionName);
    return !alive || !hasTmuxSession;
  }

  if (lockData.state === "stopping") {
    const heartbeatAge = now - lockData.lastHeartbeat;
    if (heartbeatAge <= STOPPING_STALE_AFTER_MS) {
      return false;
    }

    const hasTmuxSession = await sessionExists(lockData.sessionName);
    return !hasTmuxSession;
  }

  return false;
}

export async function cleanupStaleLockfile(
  logsDir: string = LOGS_DIR,
  projectPath: string
): Promise<boolean> {
  const lockData = await readLockfile(logsDir, projectPath);
  if (!lockData) {
    return false;
  }

  if (await isLockDataStale(lockData)) {
    return await removeLockfile(logsDir, projectPath, { expectedSessionId: lockData.sessionId });
  }

  return false;
}

export async function hasActiveLockfile(
  logsDir: string = LOGS_DIR,
  projectPath: string
): Promise<boolean> {
  const lockData = await readLockfile(logsDir, projectPath);
  if (!lockData) {
    return false;
  }

  if (!isActiveState(lockData.state)) {
    return false;
  }

  if (await isLockDataStale(lockData)) {
    await removeLockfile(logsDir, projectPath, { expectedSessionId: lockData.sessionId });
    return false;
  }

  return true;
}

export async function listAllActiveSessions(logsDir: string = LOGS_DIR): Promise<ActiveSession[]> {
  const sessions: ActiveSession[] = [];

  try {
    const entries = await readdir(logsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".lock")) {
        continue;
      }

      const lockPath = join(logsDir, entry.name);
      const lockData = await readLockfileByPath(lockPath);
      if (!lockData) {
        continue;
      }

      if (await isLockDataStale(lockData)) {
        await removeLockfileByPath(lockPath, { expectedSessionId: lockData.sessionId });
        continue;
      }

      if (!isActiveState(lockData.state)) {
        continue;
      }

      sessions.push({
        ...lockData,
        lockPath,
      });
    }
  } catch {
    // Logs dir doesn't exist
  }

  return sessions;
}

export async function removeAllLockfiles(logsDir: string = LOGS_DIR): Promise<void> {
  try {
    const entries = await readdir(logsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".lock")) {
        continue;
      }

      const lockPath = join(logsDir, entry.name);
      const lockData = await readLockfileByPath(lockPath);

      if (lockData?.sessionId) {
        await removeLockfileByPath(lockPath, { expectedSessionId: lockData.sessionId });
      } else {
        try {
          await Bun.file(lockPath).delete();
        } catch {
          // Ignore
        }
      }
    }
  } catch {
    // Logs dir doesn't exist
  }
}
