/**
 * Lockfile management for ralph-review
 * Supports per-project lockfiles for concurrent sessions
 *
 * Lockfile path: ~/.config/ralph-review/logs/<sanitized-project>.lock
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { LOGS_DIR } from "./config";
import { getProjectName } from "./logger";

const DEFAULT_BRANCH = "default";

/**
 * Data stored in lockfile
 */
export interface LockData {
  sessionName: string;
  startTime: number;
  pid: number;
  projectPath: string;
  branch: string;
  iteration?: number;
  status?: "pending" | "running" | "completed" | "failed";
}

/**
 * Active session info returned by listAllActiveSessions
 */
export interface ActiveSession extends LockData {
  lockPath: string;
}

/**
 * Get the lockfile path for a project
 *
 * @param logsDir - Base logs directory (default: ~/.config/ralph-review/logs)
 * @param projectPath - Absolute path to the project
 */
export function getLockPath(logsDir: string = LOGS_DIR, projectPath: string): string {
  const projectName = getProjectName(projectPath);
  return join(logsDir, `${projectName}.lock`);
}

/**
 * Create a lockfile for a project session
 */
export async function createLockfile(
  logsDir: string = LOGS_DIR,
  projectPath: string,
  sessionName: string,
  branch?: string
): Promise<void> {
  const lockPath = getLockPath(logsDir, projectPath);

  const lockData: LockData = {
    sessionName,
    startTime: Date.now(),
    pid: process.pid,
    projectPath,
    branch: branch?.trim() || DEFAULT_BRANCH,
    status: "pending",
  };

  await Bun.write(lockPath, JSON.stringify(lockData, null, 2));
}

/**
 * Read lockfile data
 * Returns null if lockfile doesn't exist or is invalid
 */
export async function readLockfile(
  logsDir: string = LOGS_DIR,
  projectPath: string
): Promise<LockData | null> {
  const lockPath = getLockPath(logsDir, projectPath);
  const file = Bun.file(lockPath);

  if (!(await file.exists())) {
    return null;
  }

  try {
    const content = await file.text();
    return JSON.parse(content) as LockData;
  } catch {
    return null;
  }
}

/**
 * Remove lockfile for a project
 */
export async function removeLockfile(
  logsDir: string = LOGS_DIR,
  projectPath: string
): Promise<void> {
  const lockPath = getLockPath(logsDir, projectPath);
  try {
    await Bun.file(lockPath).delete();
  } catch {
    // Ignore
  }
}

/**
 * Update lockfile with partial data (e.g., iteration progress)
 */
export async function updateLockfile(
  logsDir: string = LOGS_DIR,
  projectPath: string,
  updates: Partial<LockData>
): Promise<void> {
  const existing = await readLockfile(logsDir, projectPath);
  if (!existing) {
    return; // No lockfile to update
  }

  const updated: LockData = { ...existing, ...updates };
  const lockPath = getLockPath(logsDir, projectPath);
  await Bun.write(lockPath, JSON.stringify(updated, null, 2));
}

/**
 * Check if lockfile exists for a project
 */
export async function lockfileExists(
  logsDir: string = LOGS_DIR,
  projectPath: string
): Promise<boolean> {
  const lockPath = getLockPath(logsDir, projectPath);
  return await Bun.file(lockPath).exists();
}

/**
 * Check if a process is alive by sending signal 0
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const PENDING_LOCKFILE_MAX_AGE_MS = 30_000;

function isLockDataStale(lockData: LockData): boolean {
  if (lockData.status === "pending") {
    const age = Date.now() - lockData.startTime;
    if (age < PENDING_LOCKFILE_MAX_AGE_MS) {
      return false;
    }
    return true;
  }

  return !isProcessAlive(lockData.pid);
}

async function isLockfileStale(logsDir: string = LOGS_DIR, projectPath: string): Promise<boolean> {
  const lockData = await readLockfile(logsDir, projectPath);
  if (!lockData) {
    return false;
  }

  return isLockDataStale(lockData);
}

/**
 * Clean up stale lockfile if PID is dead
 * Returns true if lockfile was removed, false otherwise
 */
export async function cleanupStaleLockfile(
  logsDir: string = LOGS_DIR,
  projectPath: string
): Promise<boolean> {
  const isStale = await isLockfileStale(logsDir, projectPath);
  if (isStale) {
    await removeLockfile(logsDir, projectPath);
    return true;
  }
  return false;
}

/**
 * List all active sessions across all projects
 * Filters out stale sessions (dead PIDs or expired pending status)
 */
export async function listAllActiveSessions(logsDir: string = LOGS_DIR): Promise<ActiveSession[]> {
  const sessions: ActiveSession[] = [];

  try {
    const entries = await readdir(logsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".lock")) continue;

      const lockPath = join(logsDir, entry.name);

      try {
        const content = await Bun.file(lockPath).text();
        const lockData = JSON.parse(content) as LockData;

        if (isLockDataStale(lockData)) {
          continue;
        }

        sessions.push({
          ...lockData,
          lockPath,
        });
      } catch {
        // Invalid lockfile
      }
    }
  } catch {
    // Logs dir doesn't exist
  }

  return sessions;
}

/**
 * Remove all lockfiles (used by stop --all)
 */
export async function removeAllLockfiles(logsDir: string = LOGS_DIR): Promise<void> {
  try {
    const entries = await readdir(logsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".lock")) continue;

      const lockPath = join(logsDir, entry.name);
      try {
        await Bun.file(lockPath).delete();
      } catch {
        // Ignore
      }
    }
  } catch {
    // Logs dir doesn't exist
  }
}
