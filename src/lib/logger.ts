/**
 * Log storage for ralph-review
 * Stores review and fix output as JSONL files
 *
 * Structure: ~/.config/ralph-review/logs/<sanitized-project-path>/<timestamp>_<branch>.jsonl
 */

import { appendFile, mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { LOGS_DIR } from "./config";
import type {
  DashboardData,
  DerivedRunStatus,
  IterationEntry,
  LogEntry,
  Priority,
  ProjectStats,
  SessionStats,
  SystemEntry,
} from "./types";

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

    sessions.sort((a, b) => b.timestamp - a.timestamp);

    return sessions;
  } catch {
    return [];
  }
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
 * Derive run status from log entries
 * This replaces reading status from state.json, making it project-aware
 *
 * - completed: run finished normally (fixes applied or code was clean)
 * - failed: agent crashed/errored
 * - interrupted: user stopped it
 * - unknown: no iteration entries found
 */
function deriveRunStatus(entries: LogEntry[]): DerivedRunStatus {
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

  if (lastIteration.error) {
    if (lastIteration.error.message.toLowerCase().includes("interrupt")) {
      return "interrupted";
    }
    return "failed";
  }

  return "completed";
}

/**
 * Create empty priority counts object
 */
function emptyPriorityCounts(): Record<Priority, number> {
  return { P1: 0, P2: 0, P3: 0, P4: 0 };
}

/**
 * Compute statistics for a single session
 */
export async function computeSessionStats(session: LogSession): Promise<SessionStats> {
  const entries = await readLog(session.path);
  const status = deriveRunStatus(entries);

  const systemEntry = entries.find((e): e is SystemEntry => e.type === "system");
  const gitBranch = systemEntry?.gitBranch;

  const iterations = entries.filter((e): e is IterationEntry => e.type === "iteration");
  let totalFixes = 0;
  let totalSkipped = 0;
  const priorityCounts = emptyPriorityCounts();
  let totalDuration: number | undefined;

  for (const iter of iterations) {
    if (iter.fixes) {
      totalFixes += iter.fixes.fixes.length;
      totalSkipped += iter.fixes.skipped.length;

      for (const fix of iter.fixes.fixes) {
        priorityCounts[fix.priority]++;
      }
    }

    if (iter.duration !== undefined) {
      totalDuration = (totalDuration ?? 0) + iter.duration;
    }
  }

  return {
    sessionPath: session.path,
    sessionName: session.name,
    timestamp: session.timestamp,
    gitBranch,
    status,
    totalFixes,
    totalSkipped,
    priorityCounts,
    iterations: iterations.length,
    totalDuration,
    entries,
  };
}

/**
 * Compute statistics for a project (collection of sessions)
 */
export async function computeProjectStats(
  projectName: string,
  sessions: LogSession[]
): Promise<ProjectStats> {
  const sessionStats = await Promise.all(sessions.map(computeSessionStats));

  // Derive display name from original project path (first available SystemEntry)
  // Falls back to sanitized projectName if no SystemEntry found
  let displayName = projectName;
  for (const stats of sessionStats) {
    const systemEntry = stats.entries.find((e): e is SystemEntry => e.type === "system");
    if (!systemEntry?.projectPath) {
      continue;
    }

    const segments = systemEntry.projectPath.split(/[/\\]/);
    displayName = segments.at(-1) || projectName;
    break;
  }

  let totalFixes = 0;
  let totalSkipped = 0;
  const priorityCounts = emptyPriorityCounts();
  let successCount = 0;

  for (const stats of sessionStats) {
    totalFixes += stats.totalFixes;
    totalSkipped += stats.totalSkipped;

    for (const priority of ["P1", "P2", "P3", "P4"] as Priority[]) {
      priorityCounts[priority] += stats.priorityCounts[priority];
    }

    if (stats.status === "completed") {
      successCount++;
    }
  }

  return {
    projectName,
    displayName,
    totalFixes,
    totalSkipped,
    priorityCounts,
    sessionCount: sessions.length,
    successCount,
    sessions: sessionStats,
  };
}

/**
 * Build dashboard data from all projects
 */
export async function buildDashboardData(
  logsDir: string = LOGS_DIR,
  currentProjectPath?: string
): Promise<DashboardData> {
  const requestedProject = currentProjectPath ? getProjectName(currentProjectPath) : undefined;

  const allSessions = await listLogSessions(logsDir);
  const sessionsByProject = new Map<string, LogSession[]>();

  for (const session of allSessions) {
    const existing = sessionsByProject.get(session.projectName) || [];
    existing.push(session);
    sessionsByProject.set(session.projectName, existing);
  }

  const projects: ProjectStats[] = [];
  for (const [projectName, sessions] of sessionsByProject) {
    const stats = await computeProjectStats(projectName, sessions);
    projects.push(stats);
  }

  projects.sort((a, b) => b.totalFixes - a.totalFixes);
  let totalFixes = 0;
  let totalSkipped = 0;
  const priorityCounts = emptyPriorityCounts();
  let totalSessions = 0;
  let totalSuccessful = 0;

  for (const project of projects) {
    totalFixes += project.totalFixes;
    totalSkipped += project.totalSkipped;
    totalSessions += project.sessionCount;

    for (const priority of ["P1", "P2", "P3", "P4"] as Priority[]) {
      priorityCounts[priority] += project.priorityCounts[priority];
    }

    totalSuccessful += project.successCount;
  }

  const successRate = totalSessions > 0 ? Math.round((totalSuccessful / totalSessions) * 100) : 0;
  const currentProject =
    requestedProject && projects.some((project) => project.projectName === requestedProject)
      ? requestedProject
      : undefined;

  return {
    generatedAt: Date.now(),
    currentProject,
    globalStats: {
      totalFixes,
      totalSkipped,
      priorityCounts,
      totalSessions,
      successRate,
    },
    projects,
  };
}
