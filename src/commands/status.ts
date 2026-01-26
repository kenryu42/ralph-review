/**
 * Status command - show current review status
 */

import * as p from "@clack/prompts";
import { STATE_PATH } from "@/lib/config";
import {
  type DerivedRunStatus,
  deriveRunStatus,
  getLatestProjectLogSession,
  readLog,
} from "@/lib/logger";
import { getSessionOutput, listRalphSessions } from "@/lib/tmux";
import type { FixEntry, RunState, Severity } from "@/lib/types";
import { lockfileExists } from "./run";

/**
 * Load run state from disk
 */
async function loadState(): Promise<RunState | null> {
  const file = Bun.file(STATE_PATH);
  if (!(await file.exists())) {
    return null;
  }
  try {
    return JSON.parse(await file.text()) as RunState;
  } catch {
    return null;
  }
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
 * Load fix entries from the most recent log session
 */
async function loadFixEntries(sessionPath: string): Promise<FixEntry[]> {
  const entries = await readLog(sessionPath);
  const fixes: FixEntry[] = [];

  for (const entry of entries) {
    if (entry.type === "iteration" && entry.fixes) {
      fixes.push(...entry.fixes.fixes);
    }
  }

  return fixes;
}

/**
 * Severity order for sorting (higher severity first)
 */
const SEVERITY_ORDER: Record<Severity, number> = {
  HIGH: 0,
  MED: 1,
  LOW: 2,
  NIT: 3,
};

/**
 * Format fix entries for display
 */
function formatFixEntries(fixes: FixEntry[]): string {
  if (fixes.length === 0) {
    return "  No fixes applied";
  }

  // Sort by severity
  const sorted = [...fixes].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  return sorted.map((fix) => `  [#${fix.id}][${fix.severity}] ${fix.title}`).join("\n");
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
 * Main status command handler
 */
export async function runStatus(): Promise<void> {
  // Check for running sessions
  const sessions = await listRalphSessions();
  const hasLockfile = await lockfileExists();
  const state = await loadState();

  // Get the latest log session for the CURRENT project
  const currentProject = process.cwd();
  const latestSession = await getLatestProjectLogSession(undefined, currentProject);

  if (sessions.length === 0 && !hasLockfile) {
    p.log.info("No active review session.");

    if (latestSession) {
      // Derive status from log entries (project-specific)
      const entries = await readLog(latestSession.path);
      const status = deriveRunStatus(entries);

      // Get iteration count and max from log entries
      const iterations = entries.filter((e) => e.type === "iteration");
      const systemEntry = entries.find((e) => e.type === "system");
      const maxIterations = systemEntry?.type === "system" ? systemEntry.maxIterations : "?";

      p.log.message(`Last run: ${formatStatus(status)}`);
      p.log.message(`Iterations: ${iterations.length}/${maxIterations}`);

      // Show fix summary from last run
      const fixes = await loadFixEntries(latestSession.path);
      const summary = formatFixEntries(fixes);
      p.note(summary, `Fixes Applied (${fixes.length} total)`);
    }

    p.log.message('Start a review with "rr run"');
    return;
  }

  p.intro("Review Status");

  const sessionName = sessions.at(-1);
  if (sessionName) {
    p.log.step(`Session: ${sessionName}`);
    p.log.success("Status: Running");

    if (state) {
      const elapsed = Date.now() - state.startTime;
      p.log.message(`Iteration: ${state.iteration}`);
      p.log.message(`Elapsed: ${formatDuration(elapsed)}`);

      // Show fixes applied so far
      if (latestSession) {
        const fixes = await loadFixEntries(latestSession.path);
        if (fixes.length > 0) {
          const summary = formatFixEntries(fixes);
          p.note(summary, `Fixes Applied (${fixes.length} so far)`);
        }
      }

      // Get recent output
      const output = await getSessionOutput(sessionName, 10);
      if (output) {
        const recentLines = output.split("\n").slice(-5).join("\n");
        p.note(recentLines, "Recent output");
      }
    }

    p.note("rr attach  - View live progress\n" + "rr stop    - Stop the review", "Commands");
  } else if (hasLockfile) {
    p.log.warn("Lockfile exists but no session found");
    p.log.message('Run "rr stop" to clean up');
  }
}
