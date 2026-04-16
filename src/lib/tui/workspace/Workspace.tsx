import type {
  FindingFixResult,
  FindingId,
  StoredFinding,
} from "@/lib/review-workflow/findings/types";
import type { SessionState } from "@/lib/session-state";
import type { DashboardStartupMode } from "@/lib/tui/dashboard/use-dashboard-run-control";
import { DetailPane } from "@/lib/tui/sessions/detail/DetailPane";
import { SessionSidebar } from "@/lib/tui/sessions/sidebar/SessionSidebar";
import { OutputDrawer } from "@/lib/tui/shared/OutputDrawer";
import type {
  AgentRole,
  Finding,
  FixEntry,
  ProjectStats,
  ReviewOptions,
  SessionStats,
  SkippedEntry,
} from "@/lib/types";
import type { FocusedPane, SessionGroupData } from "./workspace-types";

interface WorkspaceProps {
  sessionGroups: SessionGroupData[];
  selectedSessionId: string | null;
  session: SessionState | null;
  fixes: FixEntry[];
  skipped: SkippedEntry[];
  findings: Finding[];
  storedFindings: StoredFinding[];
  selectedFindingIds: FindingId[];
  selectedFindings: StoredFinding[];
  fixResults: FindingFixResult[];
  unresolvedSelectedFindings: StoredFinding[];
  auditRegressionFindings: StoredFinding[];
  latestReviewIteration: number | null;
  codexReviewText: string | null;
  tmuxOutput: string;
  maxIterations: number;
  isLoading: boolean;
  lastSessionStats: SessionStats | null;
  projectStats: ProjectStats | null;
  isGitRepo: boolean;
  currentAgent: AgentRole | null;
  reviewOptions: ReviewOptions | undefined;
  startupMode: DashboardStartupMode;
  isStopping: boolean;
  activeSessionCount: number;
  outputVisible: boolean;
  focusedPane: FocusedPane;
}

export function Workspace({
  sessionGroups,
  selectedSessionId,
  session,
  fixes,
  skipped,
  findings,
  storedFindings,
  selectedFindingIds,
  selectedFindings,
  fixResults,
  unresolvedSelectedFindings,
  auditRegressionFindings,
  latestReviewIteration,
  codexReviewText,
  tmuxOutput,
  maxIterations,
  isLoading,
  lastSessionStats,
  projectStats,
  isGitRepo,
  currentAgent,
  reviewOptions,
  startupMode,
  isStopping,
  activeSessionCount,
  outputVisible,
  focusedPane,
}: WorkspaceProps) {
  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <box flexDirection="row" flexGrow={1} minHeight={0} gap={1} paddingLeft={1} paddingRight={1}>
        <SessionSidebar
          groups={sessionGroups}
          selectedSessionId={selectedSessionId}
          focused={focusedPane === "sidebar"}
        />
        <DetailPane
          session={session}
          fixes={fixes}
          skipped={skipped}
          findings={findings}
          storedFindings={storedFindings}
          selectedFindingIds={selectedFindingIds}
          selectedFindings={selectedFindings}
          fixResults={fixResults}
          unresolvedSelectedFindings={unresolvedSelectedFindings}
          auditRegressionFindings={auditRegressionFindings}
          latestReviewIteration={latestReviewIteration}
          codexReviewText={codexReviewText}
          tmuxOutput={tmuxOutput}
          maxIterations={maxIterations}
          isLoading={isLoading}
          lastSessionStats={lastSessionStats}
          projectStats={projectStats}
          isGitRepo={isGitRepo}
          currentAgent={currentAgent}
          reviewOptions={reviewOptions}
          startupMode={startupMode}
          isStopping={isStopping}
          activeSessionCount={activeSessionCount}
          focused={focusedPane === "detail"}
        />
      </box>
      <OutputDrawer
        output={tmuxOutput}
        sessionName={session?.sessionName ?? null}
        visible={outputVisible}
        focused={focusedPane === "output"}
      />
    </box>
  );
}
