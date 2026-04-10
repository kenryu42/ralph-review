import type { SessionState } from "@/lib/session-state";
import type {
  AgentRole,
  Finding,
  FixEntry,
  ProjectStats,
  ReviewOptions,
  SessionStats,
  SkippedEntry,
} from "@/lib/types";
import { DetailPane } from "./DetailPane";
import { OutputDrawer } from "./OutputDrawer";
import type { SessionGroupData } from "./SessionGroup";
import { SessionSidebar } from "./SessionSidebar";

export type FocusedPane = "sidebar" | "detail" | "output";

interface WorkspaceProps {
  sessionGroups: SessionGroupData[];
  selectedSessionId: string | null;
  session: SessionState | null;
  fixes: FixEntry[];
  skipped: SkippedEntry[];
  findings: Finding[];
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
  isStarting: boolean;
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
  isStarting,
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
          isStarting={isStarting}
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
