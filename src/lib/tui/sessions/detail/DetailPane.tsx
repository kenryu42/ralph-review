import type { DashboardStartupMode } from "@/lib/tui/dashboard/use-dashboard-run-control";
import { TUI_COLORS } from "@/lib/tui/shared/colors";
import type { ProjectStats, SessionStats } from "@/lib/types";
import { IdleStateView } from "./IdleStateView";
import type { SessionDetailViewProps } from "./SessionDetailView";
import { SessionDetailView } from "./SessionDetailView";

export interface DetailPaneProps extends Omit<SessionDetailViewProps, "session"> {
  session: SessionDetailViewProps["session"] | null;
  isLoading: boolean;
  lastSessionStats?: SessionStats | null;
  projectStats: ProjectStats | null;
  isGitRepo: boolean;
  startupMode: DashboardStartupMode;
  canFixPendingSession?: boolean;
}

export function DetailPane({
  session,
  isLoading,
  lastSessionStats = null,
  projectStats,
  isGitRepo,
  startupMode,
  isStopping,
  canFixPendingSession = false,
  focused = false,
  ...sessionDetailProps
}: DetailPaneProps) {
  const borderColor = focused ? TUI_COLORS.ui.borderFocused : TUI_COLORS.ui.border;

  if (isLoading) {
    return (
      <box
        border
        borderStyle="rounded"
        borderColor={borderColor}
        title="Detail"
        titleAlignment="left"
        padding={1}
        flexGrow={3}
      >
        <text fg={TUI_COLORS.text.muted}>Loading...</text>
      </box>
    );
  }

  return (
    <box
      border
      borderStyle="rounded"
      borderColor={borderColor}
      title="Detail"
      titleAlignment="left"
      padding={1}
      flexGrow={3}
      flexDirection="column"
      minHeight={0}
    >
      <scrollbox flexGrow={1} focused={focused}>
        {session ? (
          <SessionDetailView
            {...sessionDetailProps}
            session={session}
            isStopping={isStopping}
            focused={focused}
          />
        ) : (
          <IdleStateView
            isGitRepo={isGitRepo}
            startupMode={startupMode}
            isStopping={isStopping}
            lastSessionStats={lastSessionStats}
            projectStats={projectStats}
            canFixPendingSession={canFixPendingSession}
          />
        )}
      </scrollbox>
    </box>
  );
}
