/**
 * SessionPanel component - displays session status, iterations, and fixes
 */

import type { LockData } from "@/lib/lockfile";
import type {
  DerivedRunStatus,
  FixEntry,
  Priority,
  ProjectStats,
  SessionStats,
  SkippedEntry,
} from "@/lib/types";
import { Spinner } from "./Spinner";

interface SessionPanelProps {
  session: LockData | null;
  fixes: FixEntry[];
  skipped: SkippedEntry[];
  maxIterations: number;
  isLoading: boolean;
  lastSessionStats: SessionStats | null;
  projectStats: ProjectStats | null;
  isGitRepo: boolean;
}

/**
 * Format a timestamp as relative time (e.g., "2h ago", "yesterday")
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 1) return `${days}d ago`;
  if (days === 1) return "yesterday";
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

/**
 * Get display text and color for a session status
 */
function getStatusDisplay(status: DerivedRunStatus): { text: string; color: string } {
  switch (status) {
    case "completed":
      return { text: "completed", color: "#22c55e" }; // green
    case "failed":
      return { text: "failed", color: "#ef4444" }; // red
    case "interrupted":
      return { text: "interrupted", color: "#f97316" }; // orange
    case "running":
      return { text: "running", color: "#22c55e" }; // green
    default:
      return { text: "unknown", color: "#6b7280" }; // gray
  }
}

/**
 * Format priority counts as a compact string (e.g., "P1:1 P2:2")
 */
function formatPriorityCounts(counts: Record<Priority, number>): string {
  const parts: string[] = [];
  for (const p of ["P1", "P2", "P3", "P4"] as Priority[]) {
    if (counts[p] > 0) {
      parts.push(`${p}:${counts[p]}`);
    }
  }
  return parts.join(" ");
}

/**
 * Priority colors for display
 */
const PRIORITY_COLORS: Record<Priority, string> = {
  P1: "#ef4444", // red
  P2: "#f97316", // orange
  P3: "#eab308", // yellow
  P4: "#22c55e", // green
};

/**
 * Count fixes by priority
 */
function countByPriority(fixes: FixEntry[]): Record<Priority, number> {
  const counts: Record<Priority, number> = { P1: 0, P2: 0, P3: 0, P4: 0 };
  for (const fix of fixes) {
    counts[fix.priority]++;
  }
  return counts;
}

export function SessionPanel({
  session,
  fixes,
  skipped,
  maxIterations,
  isLoading,
  lastSessionStats,
  projectStats,
  isGitRepo,
}: SessionPanelProps) {
  const minWidth = 40;

  if (isLoading) {
    return (
      <box border borderColor="#374151" padding={1} flexGrow={1} minWidth={minWidth}>
        <text fg="#9ca3af">Loading...</text>
      </box>
    );
  }

  if (!session) {
    if (!lastSessionStats) {
      return (
        <box
          border
          borderColor="#374151"
          padding={1}
          flexGrow={1}
          minWidth={minWidth}
          flexDirection="column"
          gap={1}
        >
          {!isGitRepo && (
            <box flexDirection="column" paddingBottom={1}>
              <text fg="#f97316">
                <strong>Not a git repository</strong>
              </text>
              <text fg="#6b7280">Run "git init" to initialize</text>
            </box>
          )}
          <text fg="#9ca3af">No active session</text>

          <text fg="#6b7280">Start a review with "rr run"</text>
        </box>
      );
    }

    // Has previous sessions - show full info
    const statusDisplay = getStatusDisplay(lastSessionStats.status);
    const priorityStr = formatPriorityCounts(lastSessionStats.priorityCounts);

    return (
      <box
        border
        borderColor="#374151"
        padding={1}
        flexGrow={1}
        minWidth={minWidth}
        flexDirection="column"
        gap={1}
      >
        {!isGitRepo && (
          <box flexDirection="column" paddingBottom={1}>
            <text fg="#f97316">
              <strong>Not a git repository</strong>
            </text>
            <text fg="#6b7280">Run "git init" to initialize</text>
          </box>
        )}
        <text fg="#9ca3af">No active session</text>

        {/* Last run */}
        <box flexDirection="column">
          <box flexDirection="row" gap={1}>
            <text fg="#9ca3af">Last run:</text>
            <text fg={statusDisplay.color}>{statusDisplay.text}</text>
            <text fg="#6b7280">({formatRelativeTime(lastSessionStats.timestamp)})</text>
          </box>
          {lastSessionStats.totalFixes > 0 && (
            <text fg="#6b7280" paddingLeft={2}>
              {lastSessionStats.totalFixes} fixes{priorityStr ? ` (${priorityStr})` : ""}
            </text>
          )}
          <text fg="#6b7280" paddingLeft={2}>
            {lastSessionStats.iterations} iteration{lastSessionStats.iterations !== 1 ? "s" : ""}
          </text>
        </box>

        {/* Project stats */}
        {projectStats && projectStats.totalFixes > 0 && (
          <box flexDirection="column">
            <text fg="#9ca3af">Project stats:</text>
            <text fg="#6b7280" paddingLeft={2}>
              {projectStats.totalFixes} total fixes
            </text>
          </box>
        )}
      </box>
    );
  }

  const iteration = session.iteration ?? 0;
  const statusColor = session.status === "running" ? "#22c55e" : "#eab308";
  const statusText = session.status ?? "unknown";
  const priorityCounts = countByPriority(fixes);

  return (
    <box
      border
      borderColor="#374151"
      padding={1}
      flexGrow={1}
      minWidth={minWidth}
      flexDirection="column"
      gap={1}
    >
      {/* Status */}
      <box flexDirection="row" gap={1}>
        <text fg="#9ca3af">Status:</text>
        {session.status === "running" && <Spinner color={statusColor} />}
        <text fg={statusColor}>
          <strong>{statusText}</strong>
        </text>
      </box>

      {/* Iteration progress */}
      <box flexDirection="row" gap={1}>
        <text fg="#9ca3af">Iteration:</text>
        <text fg="#f9fafb">
          {iteration}/{maxIterations || "?"}
        </text>
      </box>

      {/* Fixes applied */}
      <box flexDirection="column">
        <text fg="#9ca3af">Fixes Applied ({fixes.length}):</text>
        {fixes.length === 0 ? (
          <text fg="#6b7280" paddingLeft={2}>
            None yet
          </text>
        ) : (
          <box flexDirection="row" gap={2} paddingLeft={2}>
            {(["P1", "P2", "P3", "P4"] as Priority[]).map((p) =>
              priorityCounts[p] > 0 ? (
                <text key={p} fg={PRIORITY_COLORS[p]}>
                  {p}: {priorityCounts[p]}
                </text>
              ) : null
            )}
          </box>
        )}
      </box>

      {/* Skipped items */}
      {skipped.length > 0 && (
        <box flexDirection="row" gap={1}>
          <text fg="#9ca3af">Skipped:</text>
          <text fg="#6b7280">{skipped.length}</text>
        </box>
      )}
    </box>
  );
}
