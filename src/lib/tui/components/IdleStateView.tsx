import { TUI_COLORS } from "@/lib/tui/colors";
import type { ProjectStats } from "@/lib/types";
import {
  formatPriorityBreakdown,
  formatProjectStatsSummary,
  PRIORITY_COLORS,
} from "../session-panel-utils";
import { Spinner } from "./Spinner";

interface IdleStateViewProps {
  isGitRepo: boolean;
  isStarting: boolean;
  isStopping: boolean;
  projectStats: ProjectStats | null;
}

export function IdleStateView({
  isGitRepo,
  isStarting,
  isStopping,
  projectStats,
}: IdleStateViewProps) {
  return (
    <box flexDirection="column" gap={1} flexGrow={1}>
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
        <text fg={TUI_COLORS.text.muted}>No active session</text>
      )}

      <text fg={TUI_COLORS.text.dim}>Start a review by pressing "r"</text>

      {projectStats && projectStats.totalFixes > 0 && (
        <box flexDirection="column">
          <text fg={TUI_COLORS.text.muted}>Project stats:</text>
          <box flexDirection="row" paddingLeft={2}>
            {formatPriorityBreakdown(projectStats.priorityCounts).map((item, idx, arr) => (
              <box key={item.priority} flexDirection="row">
                <text fg={PRIORITY_COLORS[item.priority]}>{item.priority} </text>
                <text fg={TUI_COLORS.text.muted}>{item.count}</text>
                {idx < arr.length - 1 && <text fg={TUI_COLORS.text.dim}> · </text>}
              </box>
            ))}
          </box>
          <text fg={TUI_COLORS.text.dim} paddingLeft={2}>
            {formatProjectStatsSummary(projectStats.totalFixes, projectStats.sessionCount)}
          </text>
        </box>
      )}
    </box>
  );
}
