/**
 * Log storage for ralph-review
 * Stores review and fix output as JSONL files
 */

import { mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { LOGS_DIR } from "./config";
import type { LogEntry } from "./types";

/**
 * Create a new log session directory
 * Returns the path to the session directory
 */
export async function createLogSession(
  logsDir: string = LOGS_DIR,
  sessionName: string
): Promise<string> {
  const sessionPath = join(logsDir, sessionName);
  await mkdir(sessionPath, { recursive: true });
  return sessionPath;
}

/**
 * Get the log file path for a session
 */
function getLogFilePath(sessionPath: string): string {
  return join(sessionPath, "log.jsonl");
}

/**
 * Append a log entry to the session log
 * Uses JSONL format (newline-delimited JSON)
 */
export async function appendLog(sessionPath: string, entry: LogEntry): Promise<void> {
  const logPath = getLogFilePath(sessionPath);
  const line = `${JSON.stringify(entry)}\n`;

  // Append to file
  const file = Bun.file(logPath);
  let content = "";
  if (await file.exists()) {
    content = await file.text();
  }
  await Bun.write(logPath, content + line);
}

/**
 * Read all log entries from a session
 */
export async function readLog(sessionPath: string): Promise<LogEntry[]> {
  const logPath = getLogFilePath(sessionPath);
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
  timestamp: number;
}

/**
 * List all log sessions
 * Returns sorted by timestamp descending (most recent first)
 */
export async function listLogSessions(logsDir: string = LOGS_DIR): Promise<LogSession[]> {
  try {
    const entries = await readdir(logsDir, { withFileTypes: true });
    const sessions: LogSession[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const sessionPath = join(logsDir, entry.name);
        const stats = await stat(sessionPath);
        sessions.push({
          path: sessionPath,
          name: entry.name,
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
 * Get the most recent log session
 */
export async function getLatestLogSession(logsDir: string = LOGS_DIR): Promise<LogSession | null> {
  const sessions = await listLogSessions(logsDir);
  return sessions.length > 0 ? (sessions[0] ?? null) : null;
}
