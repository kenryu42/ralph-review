/**
 * Dash command - open productivity dashboard in browser
 */

import { platform } from "node:os";
import * as p from "@clack/prompts";
import { $ } from "bun";
import { getCommandDef } from "@/cli";
import { parseCommand } from "@/lib/cli-parser";
import { LOGS_DIR } from "@/lib/config";
import { getDashboardPath, writeDashboardHtml } from "@/lib/html";
import { type ActiveSession, listAllActiveSessions } from "@/lib/lockfile";
import { buildDashboardData, getProjectName, listLogSessions } from "@/lib/logger";
import type { DashboardData } from "@/lib/types";

/**
 * Options for dash command
 */
interface DashOptions {
  list: boolean;
}

/**
 * Normalize branch names from lockfiles
 * Lockfiles use "default" when branch is unavailable, but logs store undefined
 */
function normalizeBranch(branch: string | undefined): string | undefined {
  const trimmed = branch?.trim();
  if (!trimmed || trimmed === "default") {
    return undefined;
  }
  return trimmed;
}

/**
 * Mark sessions as running based on active lockfiles
 * Uses project + branch matching and prefers the most recent session
 */
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

/**
 * Open a file in the default browser
 */
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

/**
 * Format timestamp for display
 */
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

/**
 * Main dash command handler
 */
export async function runDash(args: string[]): Promise<void> {
  // Parse options
  const dashDef = getCommandDef("dash");
  if (!dashDef) {
    p.log.error("Internal error: dash command definition not found");
    process.exit(1);
  }

  let options: DashOptions;
  try {
    const result = parseCommand<DashOptions>(dashDef, args);
    options = result.values;
  } catch (error) {
    p.log.error(`${error}`);
    process.exit(1);
  }

  // Handle --list flag
  if (options.list) {
    const sessions = await listLogSessions();

    if (sessions.length === 0) {
      p.log.info("No sessions found.");
      p.log.message('Start a review with "rr run" first.');
      return;
    }

    p.intro("Review Sessions");

    for (const session of sessions) {
      p.log.step(session.name);
      p.log.message(`  Project: ${session.projectName}`);
      p.log.message(`  Modified: ${formatDate(session.timestamp)}`);
      p.log.message(`  Path: ${session.path}`);
    }
    return;
  }

  // Default: open dashboard
  const s = p.spinner();
  s.start("Building dashboard...");

  // Get current project path from cwd
  const currentProjectPath = process.cwd();

  // Build dashboard data
  const data = await buildDashboardData(LOGS_DIR, currentProjectPath);

  // Overlay active session status from lockfiles to avoid showing running sessions as completed
  const activeSessions = await listAllActiveSessions(LOGS_DIR);
  markRunningSessions(data, activeSessions);

  if (data.projects.length === 0) {
    s.stop("Done");
    p.log.info("No review data found.");
    p.log.message('Start a review with "rr run" first.');
    return;
  }

  // Generate and write dashboard HTML
  const dashboardPath = getDashboardPath(LOGS_DIR);
  await writeDashboardHtml(dashboardPath, data);

  s.stop("Dashboard ready");

  p.log.success(`Opening dashboard (${data.globalStats.totalFixes} issues resolved)`);
  await openInBrowser(dashboardPath);
}
