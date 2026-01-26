/**
 * Lockfile management for ralph-review
 * Supports per-project, per-branch lockfiles for concurrent sessions
 *
 * Lockfile path: ~/.config/ralph-review/logs/<sanitized-project>/<sanitized-branch>.lock
 */

import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { LOGS_DIR } from "./config";
import { getProjectName, sanitizeForFilename } from "./logger";

/**
 * Default branch name when git branch is unavailable (detached HEAD, not a git repo)
 */
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
 * Get the lockfile path for a project and branch
 *
 * @param logsDir - Base logs directory (default: ~/.config/ralph-review/logs)
 * @param projectPath - Absolute path to the project
 * @param branch - Git branch name (uses "default" if undefined/empty)
 */
export function getLockPath(
  logsDir: string = LOGS_DIR,
  projectPath: string,
  branch?: string
): string {
  const projectName = getProjectName(projectPath);
  const branchName = branch?.trim() || DEFAULT_BRANCH;
  const sanitizedBranch = sanitizeForFilename(branchName);
  return join(logsDir, projectName, `${sanitizedBranch}.lock`);
}

/**
 * Create a lockfile for a project/branch session
 */
export async function createLockfile(
  logsDir: string = LOGS_DIR,
  projectPath: string,
  branch: string | undefined,
  sessionName: string
): Promise<void> {
  const lockPath = getLockPath(logsDir, projectPath, branch);
  const lockDir = lockPath.substring(0, lockPath.lastIndexOf("/"));

  await mkdir(lockDir, { recursive: true });

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
  projectPath: string,
  branch?: string
): Promise<LockData | null> {
  const lockPath = getLockPath(logsDir, projectPath, branch);
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
 * Remove lockfile for a project/branch
 */
export async function removeLockfile(
  logsDir: string = LOGS_DIR,
  projectPath: string,
  branch?: string
): Promise<void> {
  const lockPath = getLockPath(logsDir, projectPath, branch);
  try {
    await Bun.file(lockPath).delete();
  } catch {
    // Ignore if doesn't exist
  }
}

/**
 * Update lockfile with partial data (e.g., iteration progress)
 */
export async function updateLockfile(
  logsDir: string = LOGS_DIR,
  projectPath: string,
  branch: string | undefined,
  updates: Partial<LockData>
): Promise<void> {
  const existing = await readLockfile(logsDir, projectPath, branch);
  if (!existing) {
    return; // No lockfile to update
  }

  const updated: LockData = { ...existing, ...updates };
  const lockPath = getLockPath(logsDir, projectPath, branch);
  await Bun.write(lockPath, JSON.stringify(updated, null, 2));
}

/**
 * Check if lockfile exists for a project/branch
 */
export async function lockfileExists(
  logsDir: string = LOGS_DIR,
  projectPath: string,
  branch?: string
): Promise<boolean> {
  const lockPath = getLockPath(logsDir, projectPath, branch);
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

/**
 * Maximum age for a "pending" lockfile before it's considered stale (30 seconds)
 * This handles the case where tmux fails to start and never updates the lockfile
 */
const PENDING_LOCKFILE_MAX_AGE_MS = 30_000;

/**
 * Check if lock data represents a stale session
 * Used internally for both isLockfileStale and listAllActiveSessions
 */
function isLockDataStale(lockData: LockData): boolean {
  // Pending lockfiles get a grace period before PID check
  if (lockData.status === "pending") {
    const age = Date.now() - lockData.startTime;
    if (age < PENDING_LOCKFILE_MAX_AGE_MS) {
      return false; // Still within startup grace period
    }
    // Pending lockfile is too old, treat as stale
    return true;
  }

  // For running/completed/failed/legacy lockfiles, check PID
  return !isProcessAlive(lockData.pid);
}

/**
 * Check if a lockfile is stale (PID is dead or pending lockfile is too old)
 *
 * A lockfile is NOT stale if:
 * - Status is "pending" and created less than PENDING_LOCKFILE_MAX_AGE_MS ago
 *   (tmux session is starting up and hasn't updated the PID yet)
 * - Status is "running" and PID is alive
 *
 * A lockfile IS stale if:
 * - Status is "pending" but older than PENDING_LOCKFILE_MAX_AGE_MS
 * - Status is "running" (or undefined for legacy) and PID is dead
 */
async function isLockfileStale(
  logsDir: string = LOGS_DIR,
  projectPath: string,
  branch?: string
): Promise<boolean> {
  const lockData = await readLockfile(logsDir, projectPath, branch);
  if (!lockData) {
    return false; // No lockfile = not stale
  }

  return isLockDataStale(lockData);
}

/**
 * Clean up stale lockfile if PID is dead
 * Returns true if lockfile was removed, false otherwise
 */
export async function cleanupStaleLockfile(
  logsDir: string = LOGS_DIR,
  projectPath: string,
  branch?: string
): Promise<boolean> {
  const isStale = await isLockfileStale(logsDir, projectPath, branch);
  if (isStale) {
    await removeLockfile(logsDir, projectPath, branch);
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
    const projectDirs = await readdir(logsDir, { withFileTypes: true });

    for (const projectDir of projectDirs) {
      if (!projectDir.isDirectory()) continue;

      const projectPath = join(logsDir, projectDir.name);

      try {
        const files = await readdir(projectPath, { withFileTypes: true });

        for (const file of files) {
          if (!file.isFile() || !file.name.endsWith(".lock")) continue;

          const lockPath = join(projectPath, file.name);

          try {
            const content = await Bun.file(lockPath).text();
            const lockData = JSON.parse(content) as LockData;

            // Skip stale sessions (using same logic as isLockfileStale)
            if (isLockDataStale(lockData)) {
              continue;
            }

            sessions.push({
              ...lockData,
              lockPath,
            });
          } catch {
            // Invalid lockfile, skip
          }
        }
      } catch {
        // Can't read project dir, skip
      }
    }
  } catch {
    // Logs dir doesn't exist yet
  }

  return sessions;
}

/**
 * Remove all lockfiles (used by stop --all)
 */
export async function removeAllLockfiles(logsDir: string = LOGS_DIR): Promise<void> {
  try {
    const projectDirs = await readdir(logsDir, { withFileTypes: true });

    for (const projectDir of projectDirs) {
      if (!projectDir.isDirectory()) continue;

      const projectPath = join(logsDir, projectDir.name);

      try {
        const files = await readdir(projectPath, { withFileTypes: true });

        for (const file of files) {
          if (!file.isFile() || !file.name.endsWith(".lock")) continue;

          const lockPath = join(projectPath, file.name);
          try {
            await Bun.file(lockPath).delete();
          } catch {
            // Ignore deletion errors
          }
        }
      } catch {
        // Can't read project dir, skip
      }
    }
  } catch {
    // Logs dir doesn't exist yet
  }
}
