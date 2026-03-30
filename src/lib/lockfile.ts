import { access, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_DIR } from "./config";
import { getProjectName, getProjectStorageDir } from "./logger";
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
  worktreeProjectPath?: string;
  worktreeBranch?: string;
  endTime?: number;
  reason?: string;
}

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
  worktreeProjectPath?: string;
  worktreeBranch?: string;
  endTime?: number;
  reason?: string;
  iteration?: number;
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

async function readLockfileByPath(lockPath: string): Promise<LockData | null> {
  try {
    const content = await readFile(lockPath, "utf-8");
    const raw = JSON.parse(content) as LockData;

    if (
      !raw.sessionName ||
      typeof raw.startTime !== "number" ||
      typeof raw.projectPath !== "string" ||
      !raw.sessionId ||
      !isLockState(raw.state)
    ) {
      return null;
    }

    return raw;
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
      await unlink(lockPath);
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

export function getLockPath(storageRoot: string = CONFIG_DIR, projectPath: string): string {
  const projectName = getProjectName(projectPath);
  return join(getProjectStorageDir(storageRoot, projectPath), `${projectName}.lock`);
}

export async function createLockfile(
  storageRoot: string = CONFIG_DIR,
  projectPath: string,
  sessionName: string,
  branchOrOptions?: string | CreateLockfileOptions
): Promise<void> {
  const lockPath = getLockPath(storageRoot, projectPath);
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
    worktreeProjectPath: options.worktreeProjectPath,
    worktreeBranch: options.worktreeBranch,
    endTime: options.endTime,
    reason: options.reason,
    currentAgent: null,
  };

  await queueLockWrite(lockPath, async () => {
    await mkdir(getProjectStorageDir(storageRoot, projectPath), { recursive: true });
    await writeFile(lockPath, JSON.stringify(lockData, null, 2));
  });
}

export async function readLockfile(
  storageRoot: string = CONFIG_DIR,
  projectPath: string
): Promise<LockData | null> {
  const lockPath = getLockPath(storageRoot, projectPath);
  return readLockfileByPath(lockPath);
}

export async function removeLockfile(
  storageRoot: string = CONFIG_DIR,
  projectPath: string,
  options: LockfileGuardOptions = {}
): Promise<boolean> {
  const lockPath = getLockPath(storageRoot, projectPath);
  return removeLockfileByPath(lockPath, options);
}

export async function updateLockfile(
  storageRoot: string = CONFIG_DIR,
  projectPath: string,
  updates: Partial<LockData>,
  options: LockfileGuardOptions = {}
): Promise<boolean> {
  const lockPath = getLockPath(storageRoot, projectPath);

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

    merged.schemaVersion = LOCK_SCHEMA_VERSION;

    await writeFile(lockPath, JSON.stringify(merged, null, 2));
    return true;
  });
}

export async function touchHeartbeat(
  storageRoot: string = CONFIG_DIR,
  projectPath: string,
  expectedSessionId?: string
): Promise<boolean> {
  return updateLockfile(
    storageRoot,
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
  storageRoot: string = CONFIG_DIR,
  projectPath: string
): Promise<boolean> {
  const lockPath = getLockPath(storageRoot, projectPath);
  try {
    await access(lockPath);
    return true;
  } catch {
    return false;
  }
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
  storageRoot: string = CONFIG_DIR,
  projectPath: string
): Promise<boolean> {
  const lockData = await readLockfile(storageRoot, projectPath);
  if (!lockData) {
    return false;
  }

  if (await isLockDataStale(lockData)) {
    return await removeLockfile(storageRoot, projectPath, {
      expectedSessionId: lockData.sessionId,
    });
  }

  return false;
}

export async function hasActiveLockfile(
  storageRoot: string = CONFIG_DIR,
  projectPath: string
): Promise<boolean> {
  const lockData = await readLockfile(storageRoot, projectPath);
  if (!lockData) {
    return false;
  }

  if (!isActiveState(lockData.state)) {
    return false;
  }

  if (await isLockDataStale(lockData)) {
    await removeLockfile(storageRoot, projectPath, {
      expectedSessionId: lockData.sessionId,
    });
    return false;
  }

  return true;
}

async function listProjectLockPaths(storageRoot: string): Promise<string[]> {
  const lockPaths: string[] = [];
  const entries = await readdir(storageRoot, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const projectDir = join(storageRoot, entry.name);
    const projectEntries = await readdir(projectDir, { withFileTypes: true }).catch(() => []);
    for (const projectEntry of projectEntries) {
      if (!projectEntry.isFile() || !projectEntry.name.endsWith(".lock")) {
        continue;
      }

      lockPaths.push(join(projectDir, projectEntry.name));
    }
  }

  return lockPaths;
}

export async function listAllActiveSessions(
  storageRoot: string = CONFIG_DIR
): Promise<ActiveSession[]> {
  const sessions: ActiveSession[] = [];

  try {
    for (const lockPath of await listProjectLockPaths(storageRoot)) {
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

export async function removeAllLockfiles(storageRoot: string = CONFIG_DIR): Promise<void> {
  try {
    for (const lockPath of await listProjectLockPaths(storageRoot)) {
      const lockData = await readLockfileByPath(lockPath);

      if (lockData?.sessionId) {
        await removeLockfileByPath(lockPath, { expectedSessionId: lockData.sessionId });
      } else {
        try {
          await unlink(lockPath);
        } catch {
          // Ignore
        }
      }
    }
  } catch {
    // Storage root doesn't exist.
  }
}
