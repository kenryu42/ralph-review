import type {
  FindingFixResult,
  FindingId,
  StoredFinding,
} from "@/lib/review-workflow/findings/types";
import type { SessionState } from "@/lib/session-state";
import type { DashboardStartupMode } from "@/lib/tui/dashboard/use-dashboard-run-control";
import { TUI_COLORS } from "@/lib/tui/shared/colors";
import type {
  AgentRole,
  Finding,
  FixEntry,
  ProjectStats,
  ReviewOptions,
  SessionStats,
  SkippedEntry,
} from "@/lib/types";
import { IdleStateView } from "./IdleStateView";
import { SessionDetailView } from "./SessionDetailView";

interface DetailPaneProps {
  session: SessionState | null;
  fixes: FixEntry[];
  skipped: SkippedEntry[];
  findings: Finding[];
  storedFindings: StoredFinding[];
  selectedFindingIds: FindingId[];
  fixResults: FindingFixResult[];
  unresolvedSelectedFindings: StoredFinding[];
  auditRegressionFindings: StoredFinding[];
  latestReviewIteration: number | null;
  codexReviewText: string | null;
  tmuxOutput: string;
  maxIterations: number;
  isLoading: boolean;
  lastSessionStats?: SessionStats | null;
  projectStats: ProjectStats | null;
  isGitRepo: boolean;
  currentAgent: AgentRole | null;
  reviewOptions: ReviewOptions | undefined;
  startupMode: DashboardStartupMode;
  isStopping: boolean;
  activeSessionCount: number;
  canFixPendingSession?: boolean;
  focused?: boolean;
}

export function DetailPane({
  session,
  fixes,
  skipped,
  findings,
  storedFindings,
  selectedFindingIds,
  fixResults,
  unresolvedSelectedFindings,
  auditRegressionFindings,
  latestReviewIteration,
  codexReviewText,
  tmuxOutput,
  maxIterations,
  isLoading,
  lastSessionStats = null,
  projectStats,
  isGitRepo,
  currentAgent,
  reviewOptions,
  startupMode,
  isStopping,
  activeSessionCount,
  canFixPendingSession = false,
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
      minHeight={0}
    >
      <scrollbox flexGrow={1} focused={focused}>
        {session ? (
          <SessionDetailView
            session={session}
            fixes={fixes}
            skipped={skipped}
            findings={findings}
            storedFindings={storedFindings}
            selectedFindingIds={selectedFindingIds}
            fixResults={fixResults}
            unresolvedSelectedFindings={unresolvedSelectedFindings}
            auditRegressionFindings={auditRegressionFindings}
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
