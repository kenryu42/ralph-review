/**
 * Status command - show current review status
 */

import * as p from "@clack/prompts";
import { type ActiveSession, listAllActiveSessions, readLockfile } from "@/lib/lockfile";
import { deriveRunStatus, getGitBranch, getLatestProjectLogSession, readLog } from "@/lib/logger";
import { getSessionOutput } from "@/lib/tmux";
import type { DerivedRunStatus, FixEntry, Priority, SkippedEntry } from "@/lib/types";

/**
 * Spinner character to indicate active/running sessions
 */
const SPINNER_CHAR = "⠶";

/**
 * Truncate a string to maxLength, adding "..." if truncated
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return `${str.slice(0, maxLength)}...`;
}

/**
 * Format duration in human readable form
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Result of loading entries from a log session
 */
interface LoadedEntries {
  fixes: FixEntry[];
  skipped: SkippedEntry[];
}

/**
 * Load fix and skipped entries from the most recent log session
 */
async function loadEntries(sessionPath: string): Promise<LoadedEntries> {
  const entries = await readLog(sessionPath);
  const fixes: FixEntry[] = [];
  const skipped: SkippedEntry[] = [];

  for (const entry of entries) {
    if (entry.type === "iteration" && entry.fixes) {
      fixes.push(...entry.fixes.fixes);
      skipped.push(...entry.fixes.skipped);
    }
  }

  return { fixes, skipped };
}

/**
 * Priority order for sorting (higher priority first)
 */
const PRIORITY_ORDER: Record<Priority, number> = {
  P1: 0,
  P2: 1,
  P3: 2,
  P4: 3,
};

/**
 * Format fix entries for display
 */
function formatFixEntries(fixes: FixEntry[]): string {
  if (fixes.length === 0) {
    return "  No fixes applied";
  }

  // Sort by priority
  const sorted = [...fixes].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

  return sorted
    .map((fix) => `  [#${fix.id}][${fix.priority}] ${truncate(fix.title, 25)}`)
    .join("\n");
}

/**
 * Format skipped entries for display
 */
function formatSkippedEntries(skipped: SkippedEntry[]): string {
  if (skipped.length === 0) {
    return "  No items skipped";
  }

  return skipped.map((s) => `  [#${s.id}] ${s.title} - ${truncate(s.reason, 25)}`).join("\n");
}

/**
 * Format derived status for display
 */
function formatStatus(status: DerivedRunStatus): string {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "interrupted":
      return "interrupted";
    default:
      return "unknown";
  }
}

/**
 * Extract a short project name from the full path
 */
function getShortProjectName(projectPath: string): string {
  const parts = projectPath.split("/");
  return parts[parts.length - 1] || projectPath;
}

/**
 * Format a single active session for display
 */
function formatActiveSession(session: ActiveSession, isCurrentProject: boolean): string {
  const projectName = getShortProjectName(session.projectPath);
  const branchStr = session.branch === "default" ? "(no branch)" : session.branch;
  const marker = isCurrentProject ? " *" : "";

  return `  ${SPINNER_CHAR} ${projectName} [${branchStr}]${marker}`;
}

/**
 * Main status command handler
 */
export async function runStatus(): Promise<void> {
  // Get all active sessions
  const activeSessions = await listAllActiveSessions();

  // Get current project info
  const currentProject = process.cwd();
  const currentBranch = await getGitBranch(currentProject);

  // Check if current project has an active session
  const currentLockData = await readLockfile(undefined, currentProject, currentBranch);

  if (activeSessions.length === 0) {
    p.log.info("No active review sessions.");

    // Show last run info for current project
    const latestSession = await getLatestProjectLogSession(undefined, currentProject);
    if (latestSession) {
      const entries = await readLog(latestSession.path);
      const status = deriveRunStatus(entries);

      const iterations = entries.filter((e) => e.type === "iteration");
      const systemEntry = entries.find((e) => e.type === "system");
      const maxIterations = systemEntry?.type === "system" ? systemEntry.maxIterations : "?";

      p.log.message(`Last run: ${formatStatus(status)}`);
      p.log.message(`Iterations: ${iterations.length}/${maxIterations}`);

      const { fixes, skipped } = await loadEntries(latestSession.path);
      const fixesSummary = formatFixEntries(fixes);
      p.note(fixesSummary, `Fixes Applied (${fixes.length} total)`);

      if (skipped.length > 0) {
        const skippedSummary = formatSkippedEntries(skipped);
        p.note(skippedSummary, `Skipped Items (${skipped.length} total)`);
      }
    }

    p.log.message('Start a review with "rr run"');
    return;
  }

  // Show all active sessions
  p.intro("Review Status");

  p.log.step(`Active Sessions (${activeSessions.length})`);

  for (const session of activeSessions) {
    const isCurrentProject =
      session.projectPath === currentProject &&
      (session.branch === (currentBranch ?? "default") || session.branch === currentBranch);
    console.log(formatActiveSession(session, isCurrentProject));
  }

  if (activeSessions.length > 1) {
    p.log.message("\n  * = current project/branch");
  }

  // Show detailed info for current project's session if running
  if (currentLockData) {
    console.log("");
    p.log.step("Current Session Details");

    const elapsed = Date.now() - currentLockData.startTime;
    p.log.message(`Session: ${currentLockData.sessionName}`);
    p.log.message(`Elapsed: ${formatDuration(elapsed)}`);
    if (currentLockData.iteration !== undefined) {
      p.log.message(`Iteration: ${currentLockData.iteration}`);
    }

    // Show fixes applied so far
    const latestSession = await getLatestProjectLogSession(undefined, currentProject);
    if (latestSession) {
      const { fixes, skipped } = await loadEntries(latestSession.path);
      if (fixes.length > 0) {
        const fixesSummary = formatFixEntries(fixes);
        p.note(fixesSummary, `Fixes Applied (${fixes.length} so far)`);
      }
      if (skipped.length > 0) {
        const skippedSummary = formatSkippedEntries(skipped);
        p.note(skippedSummary, `Skipped Items (${skipped.length} so far)`);
      }
    }

    // Get recent output
    const output = await getSessionOutput(currentLockData.sessionName, 10);
    if (output) {
      const recentLines = output.split("\n").slice(-5).join("\n");
      p.note(recentLines, "Recent output");
    }
  }

  p.note("rr attach  - View live progress\n" + "rr stop    - Stop the review", "Commands");
}
