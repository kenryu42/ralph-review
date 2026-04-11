import { formatDuration } from "@/lib/format";
import { TUI_COLORS } from "@/lib/tui/colors";
import {
  extractFixesFromStats,
  formatHandoffCommands,
  formatHandoffSummary,
  formatLastRunIssueSummary,
  formatPriorityBreakdown,
  formatProjectStatsSummary,
  formatRelativeTime,
  PRIORITY_COLORS,
} from "@/lib/tui/session-display-formatters";
import type { ProjectStats, SessionStats } from "@/lib/types";
import { Spinner } from "./Spinner";
import { toSingleLine } from "./session-detail-parts";

const LAST_RUN_FIX_PREVIEW_LIMIT = 3;

function getLastRunStatusDisplay(status: SessionStats["status"]): { text: string; color: string } {
  switch (status) {
    case "completed":
      return { text: "completed", color: TUI_COLORS.status.success };
    case "failed":
      return { text: "failed", color: TUI_COLORS.status.error };
    case "interrupted":
      return { text: "interrupted", color: TUI_COLORS.status.warning };
    case "running":
      return { text: "running", color: TUI_COLORS.status.pending };
    default:
      return { text: "unknown", color: TUI_COLORS.status.inactive };
  }
}

function getLastRunHandoffDisplay(stats: SessionStats): {
  summary: string | null;
  applyCommand: string | null;
} {
  if (stats.handoffStatus === "applied-auto") {
    return {
      summary: "auto applied.",
      applyCommand: null,
    };
  }

  if (stats.handoffStatus === "pending-apply") {
    const [applyCommand] = formatHandoffCommands(stats.sessionId, stats.handoffStatus);
    return {
      summary: applyCommand ? null : "pending apply.",
      applyCommand: applyCommand ?? null,
    };
  }

  return {
    summary: formatHandoffSummary(stats.handoffStatus, stats.commitSha),
    applyCommand: null,
  };
}

interface IdleStateViewProps {
  isGitRepo: boolean;
  isStarting: boolean;
  isStopping: boolean;
  lastSessionStats: SessionStats | null;
  projectStats: ProjectStats | null;
}

export function IdleStateView({
  isGitRepo,
  isStarting,
  isStopping,
  lastSessionStats,
  projectStats,
}: IdleStateViewProps) {
  const lastRunStatusDisplay = lastSessionStats
    ? getLastRunStatusDisplay(lastSessionStats.status)
    : null;
  const lastRunFixes = lastSessionStats ? extractFixesFromStats(lastSessionStats) : [];
  const lastRunFixPreview = lastRunFixes.slice(0, LAST_RUN_FIX_PREVIEW_LIMIT);
  const hiddenFixCount = Math.max(0, lastRunFixes.length - LAST_RUN_FIX_PREVIEW_LIMIT);
  const lastRunSummary = lastSessionStats
    ? `${formatLastRunIssueSummary(
        lastSessionStats.totalFixes,
        lastSessionStats.totalSkipped,
        lastSessionStats.iterations
      )}${
        lastSessionStats.totalDuration !== undefined
          ? ` · ${formatDuration(lastSessionStats.totalDuration)}`
          : ""
      }`
    : null;
  const lastRunHandoffDisplay = lastSessionStats
    ? getLastRunHandoffDisplay(lastSessionStats)
    : null;

  return (
    <box flexDirection="column" gap={2} flexGrow={1}>
      {!isGitRepo && (
        <box flexDirection="column" paddingBottom={1}>
          <text fg={TUI_COLORS.status.warning}>
            <strong>Not a git repository</strong>
          </text>
          <text fg={TUI_COLORS.text.dim}>Run "git init" to initialize</text>
        </box>
      )}

      {isStopping ? (
        <box flexDirection="row" gap={1}>
          <Spinner color={TUI_COLORS.status.warning} />
          <text fg={TUI_COLORS.status.warning}>Stopping review...</text>
        </box>
      ) : isStarting ? (
        <box flexDirection="row" gap={1}>
          <Spinner color={TUI_COLORS.status.pending} />
          <text fg={TUI_COLORS.status.pending}>Starting review...</text>
        </box>
      ) : (
        <text fg={TUI_COLORS.text.faint}>
          <strong>No active session</strong>
        </text>
      )}

      <text fg={TUI_COLORS.text.dim}>Start a review by pressing "r"</text>

      {projectStats && projectStats.totalFixes > 0 && (
        <box flexDirection="column" gap={1}>
          <text fg={TUI_COLORS.text.faint}>
            <strong>Project stats</strong>
          </text>
          <text fg={TUI_COLORS.text.secondary} paddingLeft={2}>
            {formatProjectStatsSummary(projectStats.totalFixes, projectStats.sessionCount)}
          </text>
          <box flexDirection="row" paddingLeft={2} flexWrap="wrap">
            {formatPriorityBreakdown(projectStats.priorityCounts).map((item, idx, arr) => (
              <box key={item.priority} flexDirection="row">
                <text fg={PRIORITY_COLORS[item.priority]}>{item.priority} </text>
                <text fg={TUI_COLORS.text.muted}>{item.count}</text>
                {idx < arr.length - 1 && <text fg={TUI_COLORS.text.dim}> · </text>}
              </box>
            ))}
          </box>
        </box>
      )}

      {lastSessionStats && lastRunStatusDisplay && lastRunSummary && (
        <box
          border
          borderStyle="single"
          borderColor={TUI_COLORS.ui.border}
          padding={1}
          flexDirection="column"
          gap={1}
        >
          <text fg={TUI_COLORS.text.faint}>
            <strong>Last run</strong>
          </text>
          <box flexDirection="row" gap={1}>
            <text fg={lastRunStatusDisplay.color}>
              <strong>{lastRunStatusDisplay.text}</strong>
            </text>
            <text fg={TUI_COLORS.text.dim}>({formatRelativeTime(lastSessionStats.timestamp)})</text>
          </box>
          <text fg={TUI_COLORS.text.secondary}>{lastRunSummary}</text>

          {lastRunFixPreview.length > 0 && (
            <box flexDirection="column" gap={0}>
              <text fg={TUI_COLORS.text.muted}>Recent fixes</text>
              <box flexDirection="column" paddingLeft={2}>
                {lastRunFixPreview.map((fix) => (
                  <box key={`${fix.id}-${fix.title}`} flexDirection="row">
                    <text fg={PRIORITY_COLORS[fix.priority]}>{fix.priority}</text>
                    <text fg={TUI_COLORS.text.dim}> ▸ </text>
                    <text fg={TUI_COLORS.text.secondary}>{toSingleLine(fix.title)}</text>
                  </box>
                ))}
                {hiddenFixCount > 0 && <text fg={TUI_COLORS.text.dim}>+{hiddenFixCount} more</text>}
              </box>
            </box>
          )}

          {lastRunHandoffDisplay?.summary && (
            <box flexDirection="row" gap={1}>
              <text fg={TUI_COLORS.text.muted}>Handoff:</text>
              <text fg={TUI_COLORS.status.success}>{lastRunHandoffDisplay.summary}</text>
            </box>
          )}

          {lastRunHandoffDisplay?.applyCommand && (
            <box flexDirection="column" gap={0}>
              <text fg={TUI_COLORS.text.muted}>Handoff:</text>
              <text fg={TUI_COLORS.text.secondary} paddingLeft={2}>
                {lastRunHandoffDisplay.applyCommand}
              </text>
            </box>
          )}

          <text fg={TUI_COLORS.text.dim}>
            Press <span fg={TUI_COLORS.accent.key}>"l"</span> to view full run details
          </text>
        </box>
      )}
    </box>
  );
}
