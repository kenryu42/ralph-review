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

export async function runDashboard(_args: string[]): Promise<void> {
  const s = p.spinner();
  s.start("Building dashboard...");

  const currentProjectPath = process.cwd();
  const data = await buildDashboardData(LOGS_DIR, currentProjectPath);

  const activeSessions = await listAllActiveSessions(LOGS_DIR);
  markRunningSessions(data, activeSessions);
  const removed = pruneUnknownEmptySessions(data);

  await Promise.all(removed.map((s) => deleteSessionFiles(s.sessionPath)));

  if (data.projects.length === 0) {
    s.stop("Done");
    p.log.info("No review data found.");
    p.log.message('Start a review with "rr run" first.');
    return;
  }

  const server = startDashboardServer({ data });
  const url = `http://127.0.0.1:${server.port}`;

  s.stop("Dashboard ready");

  p.log.success(`Opening dashboard (${data.globalStats.totalFixes} issues resolved)`);
  p.log.info(url);
  await openInBrowser(url);
  await new Promise<never>(() => {});
}
