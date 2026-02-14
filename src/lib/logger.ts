import { rename } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { getAgentDisplayName, getAgentModelStatsKey, getModelDisplayName } from "./agents/models";
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
const SUMMARY_TEMP_SUFFIX = ".tmp";

export type LogIncrementalMode = "reset" | "incremental" | "unchanged";

export interface LogIncrementalState {
  logPath: string;
  offsetBytes: number;
  lastModified: number;
  trailingPartialLine: string;
  boundaryProbe?: string;
}

export interface LogIncrementalResult {
  mode: LogIncrementalMode;
  entries: LogEntry[];
  state: LogIncrementalState;
}

const LOG_FILE_TEXT_ENCODER = new TextEncoder();
const LOG_INCREMENTAL_BOUNDARY_BYTE_LENGTH = 256;

interface LogSink {
  write(
    chunk: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer
  ): number | Promise<number>;
  flush(): number | Promise<number>;
  end(error?: Error): number | Promise<number>;
}

const LOG_SINKS = new Map<string, LogSink>();
const LOG_WRITE_QUEUES = new Map<string, Promise<void>>();
const SUMMARY_CACHE = new Map<string, SessionSummary>();

function queueLogWrite<T>(logPath: string, task: () => Promise<T>): Promise<T> {
  const previous = LOG_WRITE_QUEUES.get(logPath) ?? Promise.resolve();

  let releaseQueue: (() => void) | undefined;
  const queued = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  LOG_WRITE_QUEUES.set(logPath, queued);

  return previous
    .catch(() => {
      // Keep queue progressing even if previous append failed.
    })
    .then(task)
    .finally(() => {
      releaseQueue?.();
      if (LOG_WRITE_QUEUES.get(logPath) === queued) {
        LOG_WRITE_QUEUES.delete(logPath);
      }
    });
}

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

export function getHtmlPath(logPath: string): string {
  if (logPath.endsWith(".jsonl")) {
    return `${logPath.slice(0, -".jsonl".length)}.html`;
  }
  return `${logPath}.html`;
}

export function getSummaryPath(logPath: string): string {
  if (logPath.endsWith(LOG_FILE_EXTENSION)) {
    return `${logPath.slice(0, -LOG_FILE_EXTENSION.length)}${SUMMARY_FILE_SUFFIX}`;
  }
  return `${logPath}${SUMMARY_FILE_SUFFIX}`;
}

export async function deleteSessionFiles(sessionPath: string): Promise<void> {
  await closeLogSink(sessionPath);
  SUMMARY_CACHE.delete(sessionPath);

  const paths = [sessionPath, getHtmlPath(sessionPath), getSummaryPath(sessionPath)];
  await Promise.all(
    paths.map(async (p) => {
      try {
        await Bun.file(p).delete();
      } catch {
        // Ignore — file may not exist
      }
    })
  );
}

function parseLogLine(line: string): LogEntry | null {
  if (!line) {
    return null;
  }

  try {
    return JSON.parse(line) as LogEntry;
  } catch {
    return null;
  }
}

function parseLogChunk(
  chunk: string,
  trailingPartialLine: string = ""
): { entries: LogEntry[]; trailingPartialLine: string } {
  const combined = `${trailingPartialLine}${chunk}`;
  if (!combined) {
    return { entries: [], trailingPartialLine: "" };
  }

  const lines = combined.split("\n");
  const endsWithNewline = combined.endsWith("\n");
  let nextTrailingPartialLine = "";

  if (!endsWithNewline) {
    nextTrailingPartialLine = lines.pop() ?? "";
  } else if (lines.at(-1) === "") {
    lines.pop();
  }

  const entries: LogEntry[] = [];
  for (const line of lines) {
    const parsed = parseLogLine(line);
    if (parsed) {
      entries.push(parsed);
    }
  }

  if (nextTrailingPartialLine) {
    const parsedTrailing = parseLogLine(nextTrailingPartialLine);
    if (parsedTrailing) {
      entries.push(parsedTrailing);
      nextTrailingPartialLine = "";
    }
  }

  return { entries, trailingPartialLine: nextTrailingPartialLine };
}

function parseLogContent(content: string): LogEntry[] {
  return parseLogChunk(content).entries;
}

function encodeBytesAsHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function buildBoundaryProbeFromBytes(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return "";
  }

  const start = Math.max(0, bytes.length - LOG_INCREMENTAL_BOUNDARY_BYTE_LENGTH);
  return encodeBytesAsHex(bytes.slice(start));
}

async function readBoundaryProbe(logPath: string, offsetBytes: number): Promise<string> {
  if (offsetBytes <= 0) {
    return "";
  }

  const start = Math.max(0, offsetBytes - LOG_INCREMENTAL_BOUNDARY_BYTE_LENGTH);
  const buffer = await Bun.file(logPath).slice(start, offsetBytes).arrayBuffer();
  return encodeBytesAsHex(new Uint8Array(buffer));
}

interface IterationMetrics {
  iterations: IterationEntry[];
  lastIteration: IterationEntry | undefined;
  totalFixes: number;
  totalSkipped: number;
  priorityCounts: Record<Priority, number>;
  totalDuration?: number;
  rollbackCount: number;
  rollbackFailures: number;
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
  let rollbackCount = 0;
  let rollbackFailures = 0;

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

    if (iteration.rollback?.attempted) {
      rollbackCount += 1;
      if (!iteration.rollback.success) {
        rollbackFailures += 1;
      }
    }
  }

  return {
    iterations,
    lastIteration,
    totalFixes,
    totalSkipped,
    priorityCounts,
    totalDuration,
    rollbackCount,
    rollbackFailures,
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
    sessionId: systemEntry?.sessionId,
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
    rollbackCount: metrics.rollbackCount,
    rollbackFailures: metrics.rollbackFailures,
  };
}

function createEmptySessionSummary(logPath: string): SessionSummary {
  return {
    schemaVersion: SUMMARY_SCHEMA_VERSION,
    logPath,
    summaryPath: getSummaryPath(logPath),
    projectName: basename(dirname(logPath)),
    status: "unknown",
    iterations: 0,
    hasIteration: false,
    totalFixes: 0,
    totalSkipped: 0,
    priorityCounts: emptyPriorityCounts(),
    updatedAt: Date.now(),
    rollbackCount: 0,
    rollbackFailures: 0,
  };
}

function deriveRunStatusFromIteration(iteration: IterationEntry): DerivedRunStatus {
  if (!iteration.error) {
    return "completed";
  }
  if (iteration.error.message.toLowerCase().includes("interrupt")) {
    return "interrupted";
  }
  return "failed";
}

function applyEntryToSummary(
  summary: SessionSummary,
  entry: LogEntry,
  logPath: string
): SessionSummary {
  const projectName =
    entry.type === "system" ? getProjectName(entry.projectPath) : summary.projectName;
  const updatedAt = entry.timestamp ?? Date.now();

  const next: SessionSummary = {
    ...summary,
    schemaVersion: SUMMARY_SCHEMA_VERSION,
    logPath,
    summaryPath: getSummaryPath(logPath),
    projectName,
    startedAt: summary.startedAt ?? entry.timestamp,
    updatedAt,
    priorityCounts: { ...summary.priorityCounts },
    rollbackCount: summary.rollbackCount ?? 0,
    rollbackFailures: summary.rollbackFailures ?? 0,
  };

  if (entry.type === "system") {
    next.sessionId = entry.sessionId;
    next.projectPath = entry.projectPath;
    next.gitBranch = entry.gitBranch;
    next.startedAt = summary.startedAt ?? entry.timestamp;
    return next;
  }

  if (entry.type === "iteration") {
    next.iterations = summary.iterations + 1;
    next.hasIteration = true;
    next.status = deriveRunStatusFromIteration(entry);
    next.endedAt = undefined;
    next.reason = undefined;

    if (entry.fixes) {
      next.totalFixes = summary.totalFixes + entry.fixes.fixes.length;
      next.totalSkipped = summary.totalSkipped + entry.fixes.skipped.length;

      for (const fix of entry.fixes.fixes) {
        if (Object.hasOwn(next.priorityCounts, fix.priority)) {
          next.priorityCounts[fix.priority]++;
        }
      }

      if (entry.fixes.stop_iteration !== undefined) {
        next.stop_iteration = entry.fixes.stop_iteration;
      }
    }

    if (entry.duration !== undefined) {
      next.totalDuration = (summary.totalDuration ?? 0) + entry.duration;
    }

    if (entry.rollback?.attempted) {
      next.rollbackCount = (summary.rollbackCount ?? 0) + 1;
      if (!entry.rollback.success) {
        next.rollbackFailures = (summary.rollbackFailures ?? 0) + 1;
      }
    }

    return next;
  }

  next.status = entry.status;
  next.reason = entry.reason;
  next.endedAt = entry.timestamp;
  return next;
}

async function awaitSinkResult(result: number | Promise<number>): Promise<void> {
  await Promise.resolve(result);
}

async function getOrCreateLogSink(logPath: string): Promise<LogSink> {
  const existingSink = LOG_SINKS.get(logPath);
  if (existingSink) {
    return existingSink;
  }

  const file = Bun.file(logPath);
  if (!(await file.exists())) {
    await Bun.write(logPath, "", { createPath: true });
  }

  const sink = Bun.file(logPath).writer();
  LOG_SINKS.set(logPath, sink);
  return sink;
}

async function appendLogLine(logPath: string, line: string): Promise<void> {
  const sink = await getOrCreateLogSink(logPath);
  await awaitSinkResult(sink.write(line));
  await awaitSinkResult(sink.flush());
}

async function closeLogSink(logPath: string): Promise<void> {
  const sink = LOG_SINKS.get(logPath);
  LOG_SINKS.delete(logPath);

  if (!sink) {
    return;
  }

  try {
    await awaitSinkResult(sink.end());
  } catch {
    // Ignore sink close failures during cleanup.
  }
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
  const tempPath = `${summaryPath}${SUMMARY_TEMP_SUFFIX}.${process.pid}.${Date.now()}`;
  const content = JSON.stringify(summary, null, 2);

  await Bun.write(tempPath, content, { createPath: true });
  try {
    await rename(tempPath, summaryPath);
  } catch (error) {
    await Bun.file(tempPath)
      .delete()
      .catch(() => {});
    throw error;
  }
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

async function getSummaryForAppend(logPath: string): Promise<SessionSummary> {
  const cached = SUMMARY_CACHE.get(logPath);
  if (cached) {
    return cached;
  }

  const file = Bun.file(logPath);
  if (!(await file.exists()) || file.size === 0) {
    const empty = createEmptySessionSummary(logPath);
    SUMMARY_CACHE.set(logPath, empty);
    return empty;
  }

  if (await isSummaryFresh(logPath)) {
    const summary = await readSessionSummary(logPath);
    if (summary) {
      SUMMARY_CACHE.set(logPath, summary);
      return summary;
    }
  }

  const rebuilt = await rebuildSessionSummary(logPath);
  if (rebuilt) {
    SUMMARY_CACHE.set(logPath, rebuilt);
    return rebuilt;
  }

  const empty = createEmptySessionSummary(logPath);
  SUMMARY_CACHE.set(logPath, empty);
  return empty;
}

/**
 * Append to an existing log file when no active writer is available (e.g. after
 * a process restart). Bun.file().writer() starts at byte 0, so we must
 * read-then-rewrite to preserve prior entries.
 */
async function appendByRewrite(logPath: string, line: string): Promise<void> {
  const file = Bun.file(logPath);
  const existing = (await file.exists()) ? await file.text() : "";
  const content = `${existing}${line}`;
  await Bun.write(logPath, content, { createPath: true });

  const summary = buildSessionSummary(logPath, parseLogContent(content));
  await writeSessionSummary(logPath, summary);
  SUMMARY_CACHE.set(logPath, summary);
}

export async function appendLog(logPath: string, entry: LogEntry): Promise<void> {
  return queueLogWrite(logPath, async () => {
    const line = `${JSON.stringify(entry)}\n`;
    const file = Bun.file(logPath);
    const hasActiveSink = LOG_SINKS.has(logPath);
    const fileExists = await file.exists();

    if (!hasActiveSink && fileExists && file.size > 0) {
      await appendByRewrite(logPath, line);
    } else {
      const baseSummary = await getSummaryForAppend(logPath);
      await appendLogLine(logPath, line);
      const updatedSummary = applyEntryToSummary(baseSummary, entry, logPath);
      await writeSessionSummary(logPath, updatedSummary);
      SUMMARY_CACHE.set(logPath, updatedSummary);
    }

    if (entry.type === "session_end") {
      await closeLogSink(logPath);
      SUMMARY_CACHE.delete(logPath);
    }
  });
}

function createIncrementalState(
  logPath: string,
  offsetBytes: number,
  lastModified: number,
  trailingPartialLine: string,
  boundaryProbe: string = ""
): LogIncrementalState {
  return {
    logPath,
    offsetBytes,
    lastModified,
    trailingPartialLine,
    boundaryProbe,
  };
}

function createResetResultFromContent(logPath: string, content: string): LogIncrementalResult {
  const parsed = parseLogChunk(content);
  const contentBytes = LOG_FILE_TEXT_ENCODER.encode(content);
  const snapshotOffsetBytes = contentBytes.byteLength;
  const snapshotLastModified = Bun.file(logPath).lastModified;
  const boundaryProbe = buildBoundaryProbeFromBytes(contentBytes);
  return {
    mode: "reset",
    entries: parsed.entries,
    state: createIncrementalState(
      logPath,
      snapshotOffsetBytes,
      snapshotLastModified,
      parsed.trailingPartialLine,
      boundaryProbe
    ),
  };
}

export async function readLogIncremental(
  logPath: string,
  previous?: LogIncrementalState
): Promise<LogIncrementalResult> {
  const file = Bun.file(logPath);

  if (!(await file.exists())) {
    return {
      mode: "reset",
      entries: [],
      state: createIncrementalState(logPath, 0, 0, ""),
    };
  }

  const fileSize = file.size;
  const fileLastModified = file.lastModified;
  const canUsePreviousState =
    previous &&
    previous.logPath === logPath &&
    typeof previous.boundaryProbe === "string" &&
    Number.isFinite(previous.offsetBytes) &&
    previous.offsetBytes >= 0 &&
    previous.offsetBytes <= fileSize;

  if (!canUsePreviousState || !previous) {
    const content = await file.text();
    return createResetResultFromContent(logPath, content);
  }

  if (fileSize === previous.offsetBytes) {
    if (fileLastModified === previous.lastModified) {
      return {
        mode: "unchanged",
        entries: [],
        state: createIncrementalState(
          logPath,
          previous.offsetBytes,
          fileLastModified,
          previous.trailingPartialLine,
          previous.boundaryProbe
        ),
      };
    }

    const content = await file.text();
    return createResetResultFromContent(logPath, content);
  }

  if (fileSize < previous.offsetBytes || fileLastModified < previous.lastModified) {
    const content = await file.text();
    return createResetResultFromContent(logPath, content);
  }

  const boundaryProbe = await readBoundaryProbe(logPath, previous.offsetBytes);
  if (boundaryProbe !== previous.boundaryProbe) {
    const content = await file.text();
    return createResetResultFromContent(logPath, content);
  }

  const appendedChunk = await file.slice(previous.offsetBytes, fileSize).text();
  const parsed = parseLogChunk(appendedChunk, previous.trailingPartialLine);
  const nextBoundaryProbe = await readBoundaryProbe(logPath, fileSize);
  return {
    mode: "incremental",
    entries: parsed.entries,
    state: createIncrementalState(
      logPath,
      fileSize,
      fileLastModified,
      parsed.trailingPartialLine,
      nextBoundaryProbe
    ),
  };
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
  const reviewerReasoning = systemEntry?.reviewer?.reasoning;
  const fixer = systemEntry?.fixer?.agent ?? "claude";
  const fixerModel = systemEntry?.fixer?.model ?? "unknown";
  const fixerReasoning = systemEntry?.fixer?.reasoning;

  return {
    sessionPath: session.path,
    sessionName: session.name,
    sessionId: summary?.sessionId ?? systemEntry?.sessionId,
    timestamp: session.timestamp,
    gitBranch: summary?.gitBranch ?? systemEntry?.gitBranch,
    status: summary?.status ?? deriveRunStatusFromEntries(entries, metrics),
    stop_iteration: summary?.stop_iteration ?? metrics.lastIteration?.fixes?.stop_iteration,
    totalFixes: summary?.totalFixes ?? metrics.totalFixes,
    totalSkipped: summary?.totalSkipped ?? metrics.totalSkipped,
    priorityCounts: summary?.priorityCounts ?? metrics.priorityCounts,
    iterations: summary?.iterations ?? metrics.iterations.length,
    totalDuration: summary?.totalDuration ?? metrics.totalDuration,
    rollbackCount: summary?.rollbackCount ?? metrics.rollbackCount,
    rollbackFailures: summary?.rollbackFailures ?? metrics.rollbackFailures,
    entries,
    reviewer,
    reviewerModel,
    reviewerReasoning,
    reviewerDisplayName: getAgentDisplayName(reviewer),
    reviewerModelDisplayName: getModelDisplayName(reviewer, reviewerModel),
    fixer,
    fixerModel,
    fixerReasoning,
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

export function buildAgentStats(
  projects: ProjectStats[],
  role: "reviewer" | "fixer"
): AgentStats[] {
  const agentMap = new Map<AgentType, AgentStats>();
  const agentField = role === "reviewer" ? "reviewer" : "fixer";

  for (const project of projects) {
    for (const session of project.sessions) {
      const agent = session[agentField];
      if (!agent) continue;

      // For reviewers: issues found = fixes + skipped (all issues discovered)
      // For fixers: issues fixed = fixes only (issues actually resolved)
      const issueCount =
        role === "reviewer" ? session.totalFixes + session.totalSkipped : session.totalFixes;

      const existing = agentMap.get(agent);
      if (existing) {
        existing.sessionCount++;
        existing.totalIssues += issueCount;
        existing.totalSkipped += session.totalSkipped;
      } else {
        agentMap.set(agent, {
          agent,
          sessionCount: 1,
          totalIssues: issueCount,
          totalSkipped: session.totalSkipped,
          averageIterations: 0,
        });
      }
    }
  }

  // Compute average iterations per agent
  for (const project of projects) {
    for (const session of project.sessions) {
      const agent = session[agentField];
      if (!agent) continue;
      const stats = agentMap.get(agent);
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
  const agentField = role === "reviewer" ? "reviewer" : "fixer";
  const modelField = role === "reviewer" ? "reviewerModel" : "fixerModel";
  const displayField = role === "reviewer" ? "reviewerModelDisplayName" : "fixerModelDisplayName";
  const reasoningField = role === "reviewer" ? "reviewerReasoning" : "fixerReasoning";

  for (const project of projects) {
    for (const session of project.sessions) {
      const agent = session[agentField];
      const model = session[modelField];
      if (!agent || !model) continue;
      const issueCount =
        role === "reviewer" ? session.totalFixes + session.totalSkipped : session.totalFixes;
      const modelKey = getAgentModelStatsKey(agent, model);
      const reasoningLevel = session[reasoningField];

      const existing = modelMap.get(modelKey);
      if (existing) {
        existing.sessionCount++;
        existing.totalIssues += issueCount;
        existing.totalSkipped += session.totalSkipped;
        if (reasoningLevel) {
          if (existing.reasoningLevel === "default") {
            existing.reasoningLevel = reasoningLevel;
          } else if (existing.reasoningLevel !== reasoningLevel) {
            existing.reasoningLevel = "mixed";
          }
        }
      } else {
        modelMap.set(modelKey, {
          agent,
          model,
          displayName: session[displayField],
          reasoningLevel: reasoningLevel ?? "default",
          sessionCount: 1,
          totalIssues: issueCount,
          totalSkipped: session.totalSkipped,
          averageIterations: 0,
        });
      }
    }
  }

  // Compute average iterations per model
  for (const project of projects) {
    for (const session of project.sessions) {
      const agent = session[agentField];
      const model = session[modelField];
      if (!agent || !model) continue;
      const modelKey = getAgentModelStatsKey(agent, model);
      const stats = modelMap.get(modelKey);
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
    reviewerAgentStats: buildAgentStats(projects, "reviewer"),
    fixerAgentStats: buildAgentStats(projects, "fixer"),
    reviewerModelStats: buildModelStats(projects, "reviewer"),
    fixerModelStats: buildModelStats(projects, "fixer"),
  };
}
