import { platform } from "node:os";
import * as p from "@clack/prompts";
import { $ } from "bun";
import { isUnknownEmptySession, normalizeBranch } from "@/commands/logs";
import { LOGS_DIR } from "@/lib/config";
import { type ActiveSession, listAllActiveSessions } from "@/lib/lockfile";
import {
  buildAgentStats,
  buildDashboardData,
  buildModelStats,
  deleteSessionFiles,
  getProjectName,
} from "@/lib/logger";
import { startDashboardServer } from "@/lib/server";
import type { DashboardData, Priority, SessionStats } from "@/lib/types";

type BrowserOpenCommand = "open" | "xdg-open" | "start";

interface RunOpenCommandDeps {
  open?: (filePath: string) => Promise<void>;
  xdgOpen?: (filePath: string) => Promise<void>;
  start?: (filePath: string) => Promise<void>;
}

export async function runOpenCommand(
  command: BrowserOpenCommand,
  filePath: string,
  deps: RunOpenCommandDeps = {}
): Promise<void> {
  if (command === "open") {
    if (deps.open) {
      await deps.open(filePath);
    } else {
      await $`open ${filePath}`.quiet();
    }
    return;
  }

  if (command === "xdg-open") {
    if (deps.xdgOpen) {
      await deps.xdgOpen(filePath);
    } else {
      await $`xdg-open ${filePath}`.quiet();
    }
    return;
  }

  if (deps.start) {
    await deps.start(filePath);
  } else {
    await $`start ${filePath}`.quiet();
  }
}

interface DashboardRuntime {
  cwd: string;
  buildDashboardData: (logsDir: string, currentProjectPath: string) => Promise<DashboardData>;
  listAllActiveSessions: (logsDir: string) => Promise<ActiveSession[]>;
  deleteSessionFiles: (sessionPath: string) => Promise<void>;
  startDashboardServer: (options: {
    data: DashboardData;
  }) => Pick<ReturnType<typeof startDashboardServer>, "port">;
  platform: NodeJS.Platform;
  runOpen: (command: BrowserOpenCommand, filePath: string) => Promise<void>;
  spinner: {
    start: (message: string) => void;
    stop: (message: string) => void;
  };
  log: {
    info: (message: string) => void;
    message: (message: string) => void;
    success: (message: string) => void;
  };
  waitForever: Promise<unknown>;
}

export interface DashboardRuntimeOverrides extends Partial<Omit<DashboardRuntime, "log">> {
  log?: Partial<DashboardRuntime["log"]>;
}

function createDashboardRuntime(overrides: DashboardRuntimeOverrides = {}): DashboardRuntime {
  return {
    cwd: overrides.cwd ?? process.cwd(),
    buildDashboardData: overrides.buildDashboardData ?? buildDashboardData,
    listAllActiveSessions: overrides.listAllActiveSessions ?? listAllActiveSessions,
    deleteSessionFiles: overrides.deleteSessionFiles ?? deleteSessionFiles,
    startDashboardServer: overrides.startDashboardServer ?? startDashboardServer,
    platform: overrides.platform ?? platform(),
    runOpen: overrides.runOpen ?? runOpenCommand,
    spinner: overrides.spinner ?? p.spinner(),
    log: {
      info: overrides.log?.info ?? p.log.info,
      message: overrides.log?.message ?? p.log.message,
      success: overrides.log?.success ?? p.log.success,
    },
    waitForever: overrides.waitForever ?? new Promise<never>(() => {}),
  };
}

function emptyPriorityCounts(): Record<Priority, number> {
  return { P0: 0, P1: 0, P2: 0, P3: 0 };
}

function accumulatePriorityCounts(
  target: Record<Priority, number>,
  source: Record<Priority, number>
): void {
  target.P0 += source.P0;
  target.P1 += source.P1;
  target.P2 += source.P2;
  target.P3 += source.P3;
}

function recomputeProjectAggregates(project: DashboardData["projects"][number]): void {
  const totalFixes = project.sessions.reduce((sum, s) => sum + s.totalFixes, 0);
  const totalSkipped = project.sessions.reduce((sum, s) => sum + s.totalSkipped, 0);
  const totalIterations = project.sessions.reduce((sum, s) => sum + s.iterations, 0);
  const priorityCounts = emptyPriorityCounts();

  for (const session of project.sessions) {
    accumulatePriorityCounts(priorityCounts, session.priorityCounts);
  }

  project.totalFixes = totalFixes;
  project.totalSkipped = totalSkipped;
  project.priorityCounts = priorityCounts;
  project.sessionCount = project.sessions.length;
  project.averageIterations =
    project.sessions.length > 0 ? totalIterations / project.sessions.length : 0;
  project.fixRate = totalFixes + totalSkipped > 0 ? totalFixes / (totalFixes + totalSkipped) : 0;
}

function recomputeDashboardAggregates(data: DashboardData): void {
  let totalFixes = 0;
  let totalSkipped = 0;
  let totalIterations = 0;
  const priorityCounts = emptyPriorityCounts();
  let totalSessions = 0;

  for (const project of data.projects) {
    totalFixes += project.totalFixes;
    totalSkipped += project.totalSkipped;
    totalSessions += project.sessionCount;
    totalIterations += project.averageIterations * project.sessionCount;
    accumulatePriorityCounts(priorityCounts, project.priorityCounts);
  }

  const averageIterations = totalSessions > 0 ? totalIterations / totalSessions : 0;
  const fixRate = totalFixes + totalSkipped > 0 ? totalFixes / (totalFixes + totalSkipped) : 0;

  data.globalStats = {
    totalFixes,
    totalSkipped,
    priorityCounts,
    totalSessions,
    averageIterations,
    fixRate,
  };

  // Recompute agent/model breakdowns from current (possibly pruned) projects
  data.reviewerAgentStats = buildAgentStats(data.projects, "reviewer");
  data.fixerAgentStats = buildAgentStats(data.projects, "fixer");
  data.reviewerModelStats = buildModelStats(data.projects, "reviewer");
  data.fixerModelStats = buildModelStats(data.projects, "fixer");

  if (data.currentProject && !data.projects.some((p) => p.projectName === data.currentProject)) {
    data.currentProject = undefined;
  }

  data.projects.sort((a, b) => b.totalFixes - a.totalFixes);
}

export function markRunningSessions(data: DashboardData, activeSessions: ActiveSession[]): void {
  for (const active of activeSessions) {
    if (active.sessionId) {
      let matchedBySessionId = false;
      for (const project of data.projects) {
        const session = project.sessions.find((s) => s.sessionId === active.sessionId);
        if (!session) {
          continue;
        }

        session.status = "running";
        matchedBySessionId = true;
        break;
      }

      if (matchedBySessionId) {
        continue;
      }
    }

    const projectName = getProjectName(active.projectPath);
    const project = data.projects.find((p) => p.projectName === projectName);
    if (!project) {
      continue;
    }

    const activeBranch = normalizeBranch(active.branch);
    const session = project.sessions.find(
      (s) => !s.sessionId && (activeBranch ? s.gitBranch === activeBranch : !s.gitBranch)
    );

    if (session) {
      session.status = "running";
    }
  }
}

export function removeSession(data: DashboardData, sessionPath: string): boolean {
  for (const project of data.projects) {
    const idx = project.sessions.findIndex((s) => s.sessionPath === sessionPath);
    if (idx === -1) continue;
    project.sessions.splice(idx, 1);
    recomputeProjectAggregates(project);
    data.projects = data.projects.filter((p) => p.sessions.length > 0);
    recomputeDashboardAggregates(data);
    return true;
  }
  return false;
}

export function pruneUnknownEmptySessions(data: DashboardData): SessionStats[] {
  const removed: SessionStats[] = [];

  for (const project of data.projects) {
    const kept: SessionStats[] = [];
    for (const session of project.sessions) {
      if (isUnknownEmptySession(session)) {
        removed.push(session);
      } else {
        kept.push(session);
      }
    }
    project.sessions = kept;
    recomputeProjectAggregates(project);
  }

  data.projects = data.projects.filter((project) => project.sessions.length > 0);
  recomputeDashboardAggregates(data);

  return removed;
}

async function openInBrowser(filePath: string, runtime: DashboardRuntime): Promise<void> {
  const os = runtime.platform;

  try {
    if (os === "darwin") {
      await runtime.runOpen("open", filePath);
    } else if (os === "linux") {
      await runtime.runOpen("xdg-open", filePath);
    } else if (os === "win32") {
      await runtime.runOpen("start", filePath);
    } else {
      runtime.log.info(`Open this file in your browser: ${filePath}`);
    }
  } catch {
    runtime.log.info(`Open this file in your browser: ${filePath}`);
  }
}

export async function runDashboard(
  _args: string[],
  overrides: DashboardRuntimeOverrides = {}
): Promise<void> {
  const runtime = createDashboardRuntime(overrides);
  const s = runtime.spinner;
  s.start("Building dashboard...");

  const currentProjectPath = runtime.cwd;
  const data = await runtime.buildDashboardData(LOGS_DIR, currentProjectPath);

  const activeSessions = await runtime.listAllActiveSessions(LOGS_DIR);
  markRunningSessions(data, activeSessions);
  const removed = pruneUnknownEmptySessions(data);

  await Promise.all(removed.map((session) => runtime.deleteSessionFiles(session.sessionPath)));

  if (data.projects.length === 0) {
    s.stop("Done");
    runtime.log.info("No review data found.");
    runtime.log.message('Start a review with "rr run" first.');
    return;
  }

  const server = runtime.startDashboardServer({ data });
  const url = `http://127.0.0.1:${server.port}`;

  s.stop("Dashboard ready");

  runtime.log.success(`Opening dashboard (${data.globalStats.totalFixes} issues resolved)`);
  runtime.log.info(url);
  runtime.log.info("Press Ctrl+C to stop the dashboard.");
  await openInBrowser(url, runtime);
  await runtime.waitForever;
}
