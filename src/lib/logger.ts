/**
 * Log storage for ralph-review
 * Stores review and fix output as JSONL files
 *
 * Structure: ~/.config/ralph-review/logs/<sanitized-project-path>/<timestamp>_<branch>.jsonl
 */

import { appendFile, mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { LOGS_DIR } from "./config";
import type { LogEntry } from "./types";

/**
 * Sanitize a string for use in a filename
 * Replaces problematic characters with hyphens
 */
export function sanitizeForFilename(input: string): string {
  return input
    .replace(/[/\\:*?"<>|]/g, "-") // Replace filesystem-unsafe chars
    .replace(/\s+/g, "-") // Replace whitespace
    .replace(/-+/g, "-") // Collapse multiple hyphens
    .replace(/^-|-$/g, "") // Trim leading/trailing hyphens
    .toLowerCase();
}

/**
 * Get the project folder name from an absolute path
 * Uses the full path, sanitized for filesystem (ensures uniqueness)
 */
export function getProjectName(projectPath: string): string {
  const sanitized = sanitizeForFilename(projectPath);
  return sanitized || "unknown-project";
}

/**
 * Get the current git branch name
 * Returns undefined if not a git repo or git is not available
 */
export async function getGitBranch(cwd?: string): Promise<string | undefined> {
  try {
    const result = Bun.spawnSync(["git", "branch", "--show-current"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode === 0) {
      const branch = result.stdout.toString().trim();
      return branch || undefined;
    }
  } catch {
    // Git not installed or not a git repo - graceful fallback
  }
  return undefined;
}

/**
 * Generate a log filename from timestamp and optional branch
 * Format: <timestamp>_<branch>.jsonl or <timestamp>.jsonl
 */
export function generateLogFilename(timestamp: Date, gitBranch?: string): string {
  // Format: YYYY-MM-DDTHH-MM-SS (filesystem safe)
  const ts = timestamp.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  if (gitBranch) {
    const sanitizedBranch = sanitizeForFilename(gitBranch);
    return `${ts}_${sanitizedBranch}.jsonl`;
  }
  return `${ts}.jsonl`;
}

/**
 * Create a new log session
 * Returns the path to the log file (not directory)
 *
 * @param logsDir - Base logs directory (default: ~/.config/ralph-review/logs)
 * @param projectPath - Path to the project being reviewed (used for folder name)
 * @param gitBranch - Optional git branch name (included in filename)
 */
export async function createLogSession(
  logsDir: string = LOGS_DIR,
  projectPath: string,
  gitBranch?: string
): Promise<string> {
  const projectName = getProjectName(projectPath);
  const projectDir = join(logsDir, projectName);
  await mkdir(projectDir, { recursive: true });

  const filename = generateLogFilename(new Date(), gitBranch);
  return join(projectDir, filename);
}

/**
 * Append a log entry to the session log
 * Uses JSONL format (newline-delimited JSON)
 */
export async function appendLog(logPath: string, entry: LogEntry): Promise<void> {
  const line = `${JSON.stringify(entry)}\n`;
  await appendFile(logPath, line);
}

/**
 * Read all log entries from a session
 */
export async function readLog(logPath: string): Promise<LogEntry[]> {
  const file = Bun.file(logPath);

  if (!(await file.exists())) {
    return [];
  }

  const content = await file.text();
  const lines = content.trim().split("\n").filter(Boolean);

  return lines.map((line) => JSON.parse(line) as LogEntry);
}

/**
 * Session info returned by listLogSessions
 */
export interface LogSession {
  path: string;
  name: string;
  projectName: string;
  timestamp: number;
}

/**
 * List all log sessions across all projects
 * Returns sorted by timestamp descending (most recent first)
 */
export async function listLogSessions(logsDir: string = LOGS_DIR): Promise<LogSession[]> {
  try {
    const projectDirs = await readdir(logsDir, { withFileTypes: true });
    const sessions: LogSession[] = [];

    for (const projectDir of projectDirs) {
      if (!projectDir.isDirectory()) continue;

      const projectPath = join(logsDir, projectDir.name);
      const files = await readdir(projectPath, { withFileTypes: true });

      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;

        const filePath = join(projectPath, file.name);
        const stats = await stat(filePath);
        sessions.push({
          path: filePath,
          name: file.name,
          projectName: projectDir.name,
          timestamp: stats.mtimeMs,
        });
      }
    }

    // Sort by timestamp descending
    sessions.sort((a, b) => b.timestamp - a.timestamp);

    return sessions;
  } catch {
    return [];
  }
}

/**
 * List log sessions for a specific project
 * Returns sorted by timestamp descending (most recent first)
 */
export async function listProjectLogSessions(
  logsDir: string = LOGS_DIR,
  projectPath: string
): Promise<LogSession[]> {
  const projectName = getProjectName(projectPath);
  const projectDir = join(logsDir, projectName);

  try {
    const files = await readdir(projectDir, { withFileTypes: true });
    const sessions: LogSession[] = [];

    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;

      const filePath = join(projectDir, file.name);
      const stats = await stat(filePath);
      sessions.push({
        path: filePath,
        name: file.name,
        projectName,
        timestamp: stats.mtimeMs,
      });
    }

    // Sort by timestamp descending
    sessions.sort((a, b) => b.timestamp - a.timestamp);

    return sessions;
  } catch {
    return [];
  }
}

/**
 * Get the most recent log session
 */
export async function getLatestLogSession(logsDir: string = LOGS_DIR): Promise<LogSession | null> {
  const sessions = await listLogSessions(logsDir);
  return sessions.length > 0 ? (sessions[0] ?? null) : null;
}

/**
 * Get the most recent log session for a specific project
 */
export async function getLatestProjectLogSession(
  logsDir: string = LOGS_DIR,
  projectPath: string
): Promise<LogSession | null> {
  const sessions = await listProjectLogSessions(logsDir, projectPath);
  return sessions.length > 0 ? (sessions[0] ?? null) : null;
}

/**
 * Run status derived from log entries
 */
export type DerivedRunStatus = "completed" | "failed" | "interrupted" | "unknown";

/**
 * Derive run status from log entries
 * This replaces reading status from state.json, making it project-aware
 *
 * - completed: run finished normally (fixes applied or code was clean)
 * - failed: agent crashed/errored
 * - interrupted: user stopped it
 * - unknown: no iteration entries found
 */
export function deriveRunStatus(entries: LogEntry[]): DerivedRunStatus {
  // Find all iteration entries
  const iterations = entries.filter(
    (e): e is import("./types").IterationEntry => e.type === "iteration"
  );

  if (iterations.length === 0) {
    return "unknown";
  }

  const lastIteration = iterations.at(-1);
  if (!lastIteration) {
    return "unknown";
  }

  // Check for errors
  if (lastIteration.error) {
    // Check if it was an interrupt
    if (lastIteration.error.message.toLowerCase().includes("interrupt")) {
      return "interrupted";
    }
    return "failed";
  }

  // No errors = completed (whether fixes were applied or code was already clean)
  return "completed";
}
