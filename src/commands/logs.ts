import { platform } from "node:os";
import * as p from "@clack/prompts";
import { $ } from "bun";
import { getCommandDef } from "@/cli";
import { parseCommand } from "@/lib/cli-parser";
import { LOGS_DIR } from "@/lib/config";
import { getDashboardPath, writeDashboardHtml } from "@/lib/html";
import { type ActiveSession, listAllActiveSessions } from "@/lib/lockfile";
import {
  buildDashboardData,
  computeSessionStats,
  getProjectName,
  listLogSessions,
  listProjectLogSessions,
} from "@/lib/logger";
import type {
  AgentSettings,
  DashboardData,
  DerivedRunStatus,
  FixEntry,
  IterationEntry,
  Priority,
  SessionStats,
  SkippedEntry,
  SystemEntry,
} from "@/lib/types";

interface LogsOptions {
  html: boolean;
  json: boolean;
  last: number;
  global: boolean;
}

// Lockfiles use "default" when branch is unavailable, but logs store undefined
function normalizeBranch(branch: string | undefined): string | undefined {
  const trimmed = branch?.trim();
  if (!trimmed || trimmed === "default") {
    return undefined;
  }
  return trimmed;
}

export function markRunningSessions(data: DashboardData, activeSessions: ActiveSession[]): void {
  for (const active of activeSessions) {
    const projectName = getProjectName(active.projectPath);
    const project = data.projects.find((p) => p.projectName === projectName);
    if (!project) {
      continue;
    }

    const activeBranch = normalizeBranch(active.branch);
    const session = project.sessions.find((s) =>
      activeBranch ? s.gitBranch === activeBranch : !s.gitBranch
    );

    if (session) {
      session.status = "running";
    }
  }
}

async function openInBrowser(filePath: string): Promise<void> {
  const os = platform();

  try {
    if (os === "darwin") {
      await $`open ${filePath}`.quiet();
    } else if (os === "linux") {
      await $`xdg-open ${filePath}`.quiet();
    } else if (os === "win32") {
      await $`start ${filePath}`.quiet();
    } else {
      p.log.info(`Open this file in your browser: ${filePath}`);
    }
  } catch {
    p.log.info(`Open this file in your browser: ${filePath}`);
  }
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

export function formatStatus(status: DerivedRunStatus): string {
  return status;
}

export function formatPriorityCounts(counts: Record<Priority, number>): string {
  return `P0: ${counts.P0}  P1: ${counts.P1}  P2: ${counts.P2}  P3: ${counts.P3}`;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function extractSystemEntry(session: SessionStats): SystemEntry | undefined {
  for (const entry of session.entries) {
    if (entry.type === "system") {
      return entry as SystemEntry;
    }
  }
  return undefined;
}

export interface SessionJson {
  project: string;
  branch?: string;
  status: DerivedRunStatus;
  timestamp: number;
  iterations: number;
  duration?: number;
  stop_iteration?: boolean;
  reviewer?: AgentSettings;
  fixer?: AgentSettings;
  summary: {
    totalFixes: number;
    totalSkipped: number;
    priorityCounts: Record<Priority, number>;
  };
  fixes: FixEntry[];
  skipped: SkippedEntry[];
}

export interface ProjectSessionsJson {
  project: string;
  sessions: SessionJson[];
}

export interface GlobalSessionsJson {
  sessions: SessionJson[];
}

export function buildSessionJson(
  projectName: string,
  session: SessionStats,
  fixes: FixEntry[],
  skipped: SkippedEntry[]
): SessionJson {
  const systemEntry = extractSystemEntry(session);

  return {
    project: projectName,
    branch: session.gitBranch,
    status: session.status,
    timestamp: session.timestamp,
    iterations: session.iterations,
    duration: session.totalDuration,
    stop_iteration: session.stop_iteration,
    reviewer: systemEntry?.reviewer,
    fixer: systemEntry?.fixer,
    summary: {
      totalFixes: session.totalFixes,
      totalSkipped: session.totalSkipped,
      priorityCounts: session.priorityCounts,
    },
    fixes,
    skipped,
  };
}

export function buildProjectSessionsJson(
  projectName: string,
  sessions: SessionStats[]
): ProjectSessionsJson {
  const sessionJsons = sessions.map((session) => {
    const { fixes, skipped } = extractFixesAndSkipped(session);
    return buildSessionJson(projectName, session, fixes, skipped);
  });

  return {
    project: projectName,
    sessions: sessionJsons,
  };
}

export function buildGlobalSessionsJson(sessions: SessionStats[]): GlobalSessionsJson {
  const sessionJsons = sessions.map((session) => {
    const systemEntry = extractSystemEntry(session);
    const projectPath = systemEntry?.projectPath ?? "unknown";
    const projectName = getProjectName(projectPath);
    const { fixes, skipped } = extractFixesAndSkipped(session);
    return buildSessionJson(projectName, session, fixes, skipped);
  });

  return {
    sessions: sessionJsons,
  };
}

function extractFixesAndSkipped(session: SessionStats): {
  fixes: FixEntry[];
  skipped: SkippedEntry[];
} {
  const fixes: FixEntry[] = [];
  const skipped: SkippedEntry[] = [];

  for (const entry of session.entries) {
    if (entry.type === "iteration") {
      const iterEntry = entry as IterationEntry;
      if (iterEntry.fixes) {
        fixes.push(...iterEntry.fixes.fixes);
        skipped.push(...iterEntry.fixes.skipped);
      }
    }
  }

  return { fixes, skipped };
}

function formatStatusWithIcon(status: DerivedRunStatus): string {
  return status;
}

function formatAgent(settings: AgentSettings): string {
  return settings.model ? `${settings.agent} (${settings.model})` : settings.agent;
}

function renderTerminalSession(
  projectName: string,
  session: SessionStats,
  fixes: FixEntry[],
  skipped: SkippedEntry[],
  index?: number,
  total?: number
): void {
  const branch = session.gitBranch ?? "no branch";
  const statusDisplay = formatStatusWithIcon(session.status);
  const systemEntry = extractSystemEntry(session);

  const sessionLabel =
    index !== undefined && total !== undefined && total > 1
      ? `Review Session Log (${index} of ${total})`
      : "Review Session Log";

  p.intro(sessionLabel);

  p.log.info(`Project:  ${projectName}`);
  p.log.info(`Branch:   ${branch}`);
  p.log.info(`Status:   ${statusDisplay}`);
  p.log.info(`Time:     ${formatDate(session.timestamp)}`);
  if (session.totalDuration !== undefined) {
    p.log.info(`Duration: ${formatDuration(session.totalDuration)}`);
  }
  if (session.stop_iteration !== undefined) {
    p.log.info(`Stop Iteration: ${session.stop_iteration ? "yes" : "no"}`);
  }

  if (systemEntry) {
    p.log.info(`Reviewer: ${formatAgent(systemEntry.reviewer)}`);
    p.log.info(`Fixer:    ${formatAgent(systemEntry.fixer)}`);
  }

  p.log.message("");
  p.log.step(
    `${session.iterations} iterations · ${session.totalFixes} fixes · ${session.totalSkipped} skipped`
  );
  p.log.message(formatPriorityCounts(session.priorityCounts));

  if (fixes.length > 0) {
    p.log.message("");
    p.log.step(`Fixes (${fixes.length})`);

    for (const fix of fixes) {
      const file = fix.file ? ` ${fix.file}` : "";
      p.log.message(`${fix.priority}  ${fix.title}${file}`);
    }
  } else if (session.totalFixes === 0 && session.status === "completed") {
    p.log.message("");
    p.log.success("No issues found - code is clean!");
  }

  if (skipped.length > 0) {
    p.log.message("");
    p.log.step(`Skipped (${skipped.length})`);

    for (const item of skipped) {
      p.log.message(`  ${item.title} - ${item.reason}`);
    }
  }

  p.outro("");
}

export async function runLogs(args: string[]): Promise<void> {
  const logsDef = getCommandDef("logs");
  if (!logsDef) {
    p.log.error("Internal error: logs command definition not found");
    process.exit(1);
  }

  let options: LogsOptions;
  try {
    const result = parseCommand<LogsOptions>(logsDef, args);
    options = result.values;
  } catch (error) {
    p.log.error(`${error}`);
    process.exit(1);
  }

  if (options.global && !options.json) {
    p.log.error("--global requires --json");
    process.exit(1);
  }

  if (options.last !== undefined && options.last <= 0) {
    p.log.error("-n/--last must be a positive number");
    process.exit(1);
  }

  if (options.html) {
    const s = p.spinner();
    s.start("Building dashboard...");

    const currentProjectPath = process.cwd();
    const data = await buildDashboardData(LOGS_DIR, currentProjectPath);

    const activeSessions = await listAllActiveSessions(LOGS_DIR);
    markRunningSessions(data, activeSessions);

    if (data.projects.length === 0) {
      s.stop("Done");
      p.log.info("No review data found.");
      p.log.message('Start a review with "rr run" first.');
      return;
    }

    const dashboardPath = getDashboardPath(LOGS_DIR);
    await writeDashboardHtml(dashboardPath, data);

    s.stop("Dashboard ready");

    p.log.success(`Opening dashboard (${data.globalStats.totalFixes} issues resolved)`);
    await openInBrowser(dashboardPath);
    return;
  }

  if (options.json && options.global) {
    const allLogSessions = await listLogSessions(LOGS_DIR);

    if (allLogSessions.length === 0) {
      console.log(JSON.stringify({ sessions: [] }, null, 2));
      return;
    }

    const sessionStats = await Promise.all(allLogSessions.map(computeSessionStats));
    const jsonOutput = buildGlobalSessionsJson(sessionStats);
    console.log(JSON.stringify(jsonOutput, null, 2));
    return;
  }

  const currentProjectPath = process.cwd();
  const projectName = getProjectName(currentProjectPath);
  const projectSessions = await listProjectLogSessions(LOGS_DIR, currentProjectPath);

  if (projectSessions.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ project: projectName, sessions: [] }, null, 2));
    } else {
      p.log.info("No review sessions found for current working directory.");
      p.log.message('Start a review with "rr run" first.');
    }
    return;
  }

  const limit = options.last ?? 1;
  const limitedSessions = projectSessions.slice(0, limit);

  const sessionStats = await Promise.all(limitedSessions.map(computeSessionStats));

  if (options.json) {
    const jsonOutput = buildProjectSessionsJson(projectName, sessionStats);
    console.log(JSON.stringify(jsonOutput, null, 2));
    return;
  }

  const total = sessionStats.length;
  for (let i = 0; i < sessionStats.length; i++) {
    const session = sessionStats[i];
    if (!session) continue;

    const { fixes, skipped } = extractFixesAndSkipped(session);
    renderTerminalSession(projectName, session, fixes, skipped, i + 1, total);
  }
}
