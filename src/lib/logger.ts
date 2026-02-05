import { basename, dirname, join } from "node:path";
import { getAgentDisplayName, getModelDisplayName } from "./agents/display";
import { LOGS_DIR } from "./config";
import type {
  AgentStats,
  AgentType,
  DashboardData,
  DerivedRunStatus,
  IterationEntry,
  LogEntry,
  ModelStats,
  Priority,
  ProjectStats,
  SessionEndEntry,
  SessionStats,
  SessionSummary,
  SystemEntry,
} from "./types";

const LOG_FILE_EXTENSION = ".jsonl";
const SUMMARY_FILE_SUFFIX = ".summary.json";
const SUMMARY_SCHEMA_VERSION = 1 as const;

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
  const filename = generateLogFilename(new Date(), gitBranch);
  return join(logsDir, projectName, filename);
}

export function getSummaryPath(logPath: string): string {
  if (logPath.endsWith(LOG_FILE_EXTENSION)) {
    return `${logPath.slice(0, -LOG_FILE_EXTENSION.length)}${SUMMARY_FILE_SUFFIX}`;
  }
  return `${logPath}${SUMMARY_FILE_SUFFIX}`;
}

function parseLogContent(content: string): LogEntry[] {
  if (!content.trim()) {
    return [];
  }

  const lines = content.split("\n").filter(Boolean);
  const entries: LogEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as LogEntry);
    } catch {
      // Ignore malformed lines and keep valid entries
    }
  }
  return entries;
}

interface IterationMetrics {
  iterations: IterationEntry[];
  lastIteration: IterationEntry | undefined;
  totalFixes: number;
  totalSkipped: number;
  priorityCounts: Record<Priority, number>;
  totalDuration?: number;
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

function computeIterationMetrics(entries: LogEntry[]): IterationMetrics {
  const iterations = entries.filter((entry): entry is IterationEntry => entry.type === "iteration");
  const lastIteration = iterations.at(-1);
  let totalFixes = 0;
  let totalSkipped = 0;
  const priorityCounts = emptyPriorityCounts();
  let totalDuration: number | undefined;

  for (const iteration of iterations) {
    if (iteration.fixes) {
      totalFixes += iteration.fixes.fixes.length;
      totalSkipped += iteration.fixes.skipped.length;

      for (const fix of iteration.fixes.fixes) {
        if (Object.hasOwn(priorityCounts, fix.priority)) {
          priorityCounts[fix.priority]++;
        }
      }
    }

    if (iteration.duration !== undefined) {
      totalDuration = (totalDuration ?? 0) + iteration.duration;
    }
  }

  return {
    iterations,
    lastIteration,
    totalFixes,
    totalSkipped,
    priorityCounts,
    totalDuration,
  };
}

function getLastSessionEnd(entries: LogEntry[]): SessionEndEntry | undefined {
  return entries.filter((entry): entry is SessionEndEntry => entry.type === "session_end").at(-1);
}

function deriveRunStatusFromEntries(
  entries: LogEntry[],
  metrics: IterationMetrics
): DerivedRunStatus {
  const sessionEnd = getLastSessionEnd(entries);
  if (sessionEnd) {
    return sessionEnd.status;
  }

  if (!metrics.lastIteration) {
    return "unknown";
  }

  if (metrics.lastIteration.error) {
    if (metrics.lastIteration.error.message.toLowerCase().includes("interrupt")) {
      return "interrupted";
    }
    return "failed";
  }

  return "completed";
}

function buildSessionSummary(logPath: string, entries: LogEntry[]): SessionSummary {
  const metrics = computeIterationMetrics(entries);
  const systemEntry = entries.find((entry): entry is SystemEntry => entry.type === "system");
  const sessionEnd = getLastSessionEnd(entries);
  const lastTimestamp = [...entries]
    .reverse()
    .find((entry) => entry.timestamp !== undefined)?.timestamp;
  const projectName = systemEntry?.projectPath
    ? getProjectName(systemEntry.projectPath)
    : basename(dirname(logPath));

  return {
    schemaVersion: SUMMARY_SCHEMA_VERSION,
    logPath,
    summaryPath: getSummaryPath(logPath),
    projectName,
    projectPath: systemEntry?.projectPath,
    gitBranch: systemEntry?.gitBranch,
    startedAt: systemEntry?.timestamp ?? entries[0]?.timestamp,
    updatedAt: sessionEnd?.timestamp ?? lastTimestamp ?? Date.now(),
    endedAt: sessionEnd?.timestamp,
    status: deriveRunStatusFromEntries(entries, metrics),
    reason: sessionEnd?.reason,
    iterations: metrics.iterations.length,
    hasIteration: metrics.iterations.length > 0,
    stop_iteration: metrics.lastIteration?.fixes?.stop_iteration,
    totalFixes: metrics.totalFixes,
    totalSkipped: metrics.totalSkipped,
    priorityCounts: metrics.priorityCounts,
    totalDuration: metrics.totalDuration,
  };
}

export async function readSessionSummary(logPath: string): Promise<SessionSummary | null> {
  const summaryPath = getSummaryPath(logPath);
  const file = Bun.file(summaryPath);

  if (!(await file.exists())) {
    return null;
  }

  try {
    const content = await file.text();
    const parsed = JSON.parse(content) as SessionSummary;
    if (parsed.schemaVersion !== SUMMARY_SCHEMA_VERSION) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Check if the summary file is fresh (not older than the log file).
 * Returns true if summary exists and is at least as new as the log file.
 */
async function isSummaryFresh(logPath: string): Promise<boolean> {
  const summaryPath = getSummaryPath(logPath);
  const logFile = Bun.file(logPath);
  const summaryFile = Bun.file(summaryPath);

  if (!(await summaryFile.exists())) {
    return false;
  }

  const logMtime = logFile.lastModified;
  const summaryMtime = summaryFile.lastModified;

  // Summary is fresh if it was modified at or after the log file
  return summaryMtime >= logMtime;
}

async function writeSessionSummary(logPath: string, summary: SessionSummary): Promise<void> {
  const summaryPath = getSummaryPath(logPath);
  await Bun.write(summaryPath, JSON.stringify(summary, null, 2), { createPath: true });
}

async function rebuildSessionSummary(logPath: string): Promise<SessionSummary | null> {
  const file = Bun.file(logPath);
  if (!(await file.exists())) {
    return null;
  }

  const entries = await readLog(logPath);
  const summary = buildSessionSummary(logPath, entries);
  await writeSessionSummary(logPath, summary);
  return summary;
}

export async function appendLog(logPath: string, entry: LogEntry): Promise<void> {
  const line = `${JSON.stringify(entry)}\n`;
  const file = Bun.file(logPath);
  const existing = (await file.exists()) ? await file.text() : "";
  const content = `${existing}${line}`;
  await Bun.write(logPath, content, { createPath: true });

  const summary = buildSessionSummary(logPath, parseLogContent(content));
  await writeSessionSummary(logPath, summary);
}

export async function readLog(logPath: string): Promise<LogEntry[]> {
  const file = Bun.file(logPath);

  if (!(await file.exists())) {
    return [];
  }

  const content = await file.text();
  return parseLogContent(content);
}

export interface LogSession {
  path: string;
  name: string;
  projectName: string;
  timestamp: number;
}

async function buildSessionsFromDir(logsDir: string): Promise<LogSession[]> {
  const sessions: LogSession[] = [];
  const pattern = `**/*${LOG_FILE_EXTENSION}`;
  const glob = new Bun.Glob(pattern);

  for await (const relativePath of glob.scan({ cwd: logsDir })) {
    if (!relativePath.endsWith(LOG_FILE_EXTENSION)) {
      continue;
    }

    const filePath = join(logsDir, relativePath);
    const inferredProjectName = relativePath.split("/")[0];
    const resolvedProjectName = inferredProjectName || basename(dirname(filePath));
    const timestamp = Bun.file(filePath).lastModified;
    sessions.push({
      path: filePath,
      name: basename(filePath),
      projectName: resolvedProjectName,
      timestamp,
    });
  }

  sessions.sort((a, b) => b.timestamp - a.timestamp);
  return sessions;
}

export async function listLogSessions(logsDir: string = LOGS_DIR): Promise<LogSession[]> {
  try {
    return await buildSessionsFromDir(logsDir);
  } catch {
    return [];
  }
}

export async function listProjectLogSessions(
  logsDir: string = LOGS_DIR,
  projectPath: string
): Promise<LogSession[]> {
  const projectName = getProjectName(projectPath);

  try {
    const sessions = await buildSessionsFromDir(logsDir);
    return sessions.filter((session) => session.projectName === projectName);
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

export async function computeSessionStats(session: LogSession): Promise<SessionStats> {
  const entries = await readLog(session.path);
  const metrics = computeIterationMetrics(entries);

  // Only use cached summary if it's fresh (not older than the log file)
  // This handles the case where a crash occurred between log write and summary write
  let summary: SessionSummary | null = null;
  if (await isSummaryFresh(session.path)) {
    summary = await readSessionSummary(session.path);
  }
  if (!summary) {
    summary = await rebuildSessionSummary(session.path);
  }

  const systemEntry = entries.find((e): e is SystemEntry => e.type === "system");

  const reviewer = systemEntry?.reviewer?.agent ?? "claude";
  const reviewerModel = systemEntry?.reviewer?.model ?? "unknown";
  const fixer = systemEntry?.fixer?.agent ?? "claude";
  const fixerModel = systemEntry?.fixer?.model ?? "unknown";

  return {
    sessionPath: session.path,
    sessionName: session.name,
    timestamp: session.timestamp,
    gitBranch: summary?.gitBranch ?? systemEntry?.gitBranch,
    status: summary?.status ?? deriveRunStatusFromEntries(entries, metrics),
    stop_iteration: summary?.stop_iteration ?? metrics.lastIteration?.fixes?.stop_iteration,
    totalFixes: summary?.totalFixes ?? metrics.totalFixes,
    totalSkipped: summary?.totalSkipped ?? metrics.totalSkipped,
    priorityCounts: summary?.priorityCounts ?? metrics.priorityCounts,
    iterations: summary?.iterations ?? metrics.iterations.length,
    totalDuration: summary?.totalDuration ?? metrics.totalDuration,
    entries,
    reviewer,
    reviewerModel,
    reviewerDisplayName: getAgentDisplayName(reviewer),
    reviewerModelDisplayName: getModelDisplayName(reviewer, reviewerModel),
    fixer,
    fixerModel,
    fixerDisplayName: getAgentDisplayName(fixer),
    fixerModelDisplayName: getModelDisplayName(fixer, fixerModel),
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
  let totalIterations = 0;
  const priorityCounts = emptyPriorityCounts();

  for (const stats of sessionStats) {
    totalFixes += stats.totalFixes;
    totalSkipped += stats.totalSkipped;
    totalIterations += stats.iterations;
    aggregatePriorityCounts(priorityCounts, stats.priorityCounts);
  }

  const averageIterations = sessionStats.length > 0 ? totalIterations / sessionStats.length : 0;
  const fixRate = totalFixes + totalSkipped > 0 ? totalFixes / (totalFixes + totalSkipped) : 0;

  return {
    projectName,
    displayName,
    totalFixes,
    totalSkipped,
    priorityCounts,
    sessionCount: sessions.length,
    averageIterations,
    fixRate,
    sessions: sessionStats,
  };
}

export function buildAgentStats(projects: ProjectStats[]): AgentStats[] {
  const agentMap = new Map<AgentType, AgentStats>();

  for (const project of projects) {
    for (const session of project.sessions) {
      if (!session.reviewer) continue;

      const existing = agentMap.get(session.reviewer);
      if (existing) {
        existing.sessionCount++;
        existing.totalFixes += session.totalFixes;
        existing.totalSkipped += session.totalSkipped;
      } else {
        agentMap.set(session.reviewer, {
          agent: session.reviewer,
          sessionCount: 1,
          totalFixes: session.totalFixes,
          totalSkipped: session.totalSkipped,
          averageIterations: 0,
        });
      }
    }
  }

  // Compute average iterations per agent
  for (const project of projects) {
    for (const session of project.sessions) {
      if (!session.reviewer) continue;
      const stats = agentMap.get(session.reviewer);
      if (stats) {
        stats.averageIterations += session.iterations;
      }
    }
  }

  for (const stats of agentMap.values()) {
    if (stats.sessionCount > 0) {
      stats.averageIterations = stats.averageIterations / stats.sessionCount;
    }
  }

  return Array.from(agentMap.values()).sort((a, b) => b.sessionCount - a.sessionCount);
}

export function buildModelStats(
  projects: ProjectStats[],
  role: "reviewer" | "fixer"
): ModelStats[] {
  const modelMap = new Map<string, ModelStats>();
  const modelField = role === "reviewer" ? "reviewerModel" : "fixerModel";

  for (const project of projects) {
    for (const session of project.sessions) {
      const model = session[modelField];
      if (!model) continue;

      const existing = modelMap.get(model);
      if (existing) {
        existing.sessionCount++;
        existing.totalFixes += session.totalFixes;
        existing.totalSkipped += session.totalSkipped;
      } else {
        modelMap.set(model, {
          model,
          sessionCount: 1,
          totalFixes: session.totalFixes,
          totalSkipped: session.totalSkipped,
          averageIterations: 0,
        });
      }
    }
  }

  // Compute average iterations per model
  for (const project of projects) {
    for (const session of project.sessions) {
      const model = session[modelField];
      if (!model) continue;
      const stats = modelMap.get(model);
      if (stats) {
        stats.averageIterations += session.iterations;
      }
    }
  }

  for (const stats of modelMap.values()) {
    if (stats.sessionCount > 0) {
      stats.averageIterations = stats.averageIterations / stats.sessionCount;
    }
  }

  return Array.from(modelMap.values()).sort((a, b) => b.sessionCount - a.sessionCount);
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
  let totalIterations = 0;
  const priorityCounts = emptyPriorityCounts();
  let totalSessions = 0;

  for (const project of projects) {
    totalFixes += project.totalFixes;
    totalSkipped += project.totalSkipped;
    totalSessions += project.sessionCount;
    totalIterations += project.averageIterations * project.sessionCount;
    aggregatePriorityCounts(priorityCounts, project.priorityCounts);
  }

  const averageIterations = totalSessions > 0 ? totalIterations / totalSessions : 0;
  const fixRate = totalFixes + totalSkipped > 0 ? totalFixes / (totalFixes + totalSkipped) : 0;
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
      averageIterations,
      fixRate,
    },
    projects,
    agentStats: buildAgentStats(projects),
    reviewerModelStats: buildModelStats(projects, "reviewer"),
    fixerModelStats: buildModelStats(projects, "fixer"),
  };
}
