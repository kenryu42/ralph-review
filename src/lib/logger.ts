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

export function sanitizeForFilename(input: string): string {
  return input
    .replace(/[/\\:*?"<>|]/g, "-") // Replace filesystem-unsafe chars
    .replace(/\s+/g, "-") // Replace whitespace
    .replace(/-+/g, "-") // Collapse multiple hyphens
    .replace(/^-|-$/g, "") // Trim leading/trailing hyphens
    .toLowerCase();
}

export function getProjectName(projectPath: string): string {
  const sanitized = sanitizeForFilename(projectPath);
  return sanitized || "unknown-project";
}

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

export function generateLogFilename(timestamp: Date, gitBranch?: string): string {
  const ts = timestamp.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  if (gitBranch) {
    const sanitizedBranch = sanitizeForFilename(gitBranch);
    return `${ts}_${sanitizedBranch}.jsonl`;
  }
  return `${ts}.jsonl`;
}

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

export async function appendLog(logPath: string, entry: LogEntry): Promise<void> {
  const line = `${JSON.stringify(entry)}\n`;
  await appendFile(logPath, line);
}

export async function readLog(logPath: string): Promise<LogEntry[]> {
  const file = Bun.file(logPath);

  if (!(await file.exists())) {
    return [];
  }

  const content = await file.text();
  const lines = content.trim().split("\n").filter(Boolean);

  return lines.map((line) => JSON.parse(line) as LogEntry);
}

export interface LogSession {
  path: string;
  name: string;
  projectName: string;
  timestamp: number;
}

async function buildSessionsFromDir(
  projectDir: string,
  projectName: string
): Promise<LogSession[]> {
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
}

export async function listLogSessions(logsDir: string = LOGS_DIR): Promise<LogSession[]> {
  try {
    const projectDirs = await readdir(logsDir, { withFileTypes: true });
    const sessionLists = await Promise.all(
      projectDirs
        .filter((dir) => dir.isDirectory())
        .map((dir) => buildSessionsFromDir(join(logsDir, dir.name), dir.name))
    );

    const sessions = sessionLists.flat();
    sessions.sort((a, b) => b.timestamp - a.timestamp);
    return sessions;
  } catch {
    return [];
  }
}

export async function listProjectLogSessions(
  logsDir: string = LOGS_DIR,
  projectPath: string
): Promise<LogSession[]> {
  const projectName = getProjectName(projectPath);
  const projectDir = join(logsDir, projectName);

  try {
    return await buildSessionsFromDir(projectDir, projectName);
  } catch {
    return [];
  }
}

export async function getLatestProjectLogSession(
  logsDir: string = LOGS_DIR,
  projectPath: string
): Promise<LogSession | null> {
  const sessions = await listProjectLogSessions(logsDir, projectPath);
  return sessions.length > 0 ? (sessions[0] ?? null) : null;
}

function deriveRunStatus(entries: LogEntry[]): DerivedRunStatus {
  const lastIteration = entries.filter((e): e is IterationEntry => e.type === "iteration").at(-1);

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

const PRIORITIES: Priority[] = ["P0", "P1", "P2", "P3"];

function emptyPriorityCounts(): Record<Priority, number> {
  return { P0: 0, P1: 0, P2: 0, P3: 0 };
}

function aggregatePriorityCounts(
  target: Record<Priority, number>,
  source: Record<Priority, number>
): void {
  for (const priority of PRIORITIES) {
    target[priority] += source[priority];
  }
}

export async function computeSessionStats(session: LogSession): Promise<SessionStats> {
  const entries = await readLog(session.path);
  const status = deriveRunStatus(entries);

  const systemEntry = entries.find((e): e is SystemEntry => e.type === "system");
  const gitBranch = systemEntry?.gitBranch;

  const iterations = entries.filter((e): e is IterationEntry => e.type === "iteration");
  const lastIteration = iterations.at(-1);
  let totalFixes = 0;
  let totalSkipped = 0;
  const priorityCounts = emptyPriorityCounts();
  let totalDuration: number | undefined;

  for (const iter of iterations) {
    if (iter.fixes) {
      totalFixes += iter.fixes.fixes.length;
      totalSkipped += iter.fixes.skipped.length;

      for (const fix of iter.fixes.fixes) {
        if (Object.hasOwn(priorityCounts, fix.priority)) {
          priorityCounts[fix.priority]++;
        }
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
    stop_iteration: lastIteration?.fixes?.stop_iteration,
    totalFixes,
    totalSkipped,
    priorityCounts,
    iterations: iterations.length,
    totalDuration,
    entries,
  };
}

export async function computeProjectStats(
  projectName: string,
  sessions: LogSession[]
): Promise<ProjectStats> {
  const sessionStats = await Promise.all(sessions.map(computeSessionStats));

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
    aggregatePriorityCounts(priorityCounts, stats.priorityCounts);
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
    aggregatePriorityCounts(priorityCounts, project.priorityCounts);
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
