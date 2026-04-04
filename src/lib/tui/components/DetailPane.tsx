import type { SessionState } from "@/lib/session-state";
import { TUI_COLORS } from "@/lib/tui/colors";
import type {
  AgentRole,
  Finding,
  FixEntry,
  ProjectStats,
  ReviewOptions,
  SkippedEntry,
} from "@/lib/types";
import { IdleStateView } from "./IdleStateView";
import { SessionDetailView } from "./SessionDetailView";

interface DetailPaneProps {
  session: SessionState | null;
  fixes: FixEntry[];
  skipped: SkippedEntry[];
  findings: Finding[];
  latestReviewIteration: number | null;
  codexReviewText: string | null;
  tmuxOutput: string;
  maxIterations: number;
  isLoading: boolean;
  projectStats: ProjectStats | null;
  isGitRepo: boolean;
  currentAgent: AgentRole | null;
  reviewOptions: ReviewOptions | undefined;
  isStarting: boolean;
  isStopping: boolean;
  activeSessionCount: number;
  focused?: boolean;
}

export function DetailPane({
  session,
  fixes,
  skipped,
  findings,
  latestReviewIteration,
  codexReviewText,
  tmuxOutput,
  maxIterations,
  isLoading,
  projectStats,
  isGitRepo,
  currentAgent,
  reviewOptions,
  isStarting,
  isStopping,
  activeSessionCount,
  focused = false,
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
    >
      {session ? (
        <SessionDetailView
          session={session}
          fixes={fixes}
          skipped={skipped}
          findings={findings}
          latestReviewIteration={latestReviewIteration}
          codexReviewText={codexReviewText}
          tmuxOutput={tmuxOutput}
          maxIterations={maxIterations}
          currentAgent={currentAgent}
          reviewOptions={reviewOptions}
          isStopping={isStopping}
          activeSessionCount={activeSessionCount}
          focused={focused}
        />
      ) : (
        <IdleStateView
          isGitRepo={isGitRepo}
          isStarting={isStarting}
          isStopping={isStopping}
          projectStats={projectStats}
        />
      )}
    </box>
  );
}
