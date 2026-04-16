import type {
  FindingFixResult,
  FindingId,
  StoredFinding,
} from "@/lib/review-workflow/findings/types";
import type { ActiveSession, SessionState } from "@/lib/session-state";
import type { DashboardStartupMode } from "@/lib/tui/dashboard/use-dashboard-run-control";
import type {
  AgentRole,
  Config,
  Finding,
  FixEntry,
  LogEntry,
  ProjectStats,
  ReviewOptions,
  SessionStats,
  SkippedEntry,
} from "@/lib/types";

export type FocusedPane = "sidebar" | "detail" | "output";

export interface SessionGroupData {
  projectPath: string;
  projectName: string;
  isCurrentProject: boolean;
  sessions: ActiveSession[];
}

export interface WorkspaceState {
  sessionGroups: SessionGroupData[];
  allSessions: ActiveSession[];
  projectSessions: ActiveSession[];
  selectedSessionId: string | null;
  currentSession: SessionState | null;
  logEntries: LogEntry[];
  fixes: FixEntry[];
  skipped: SkippedEntry[];
  findings: Finding[];
  storedFindings: StoredFinding[];
  selectedFindingIds: FindingId[];
  selectedFindings: StoredFinding[];
  fixResults: FindingFixResult[];
  unresolvedSelectedFindings: StoredFinding[];
  auditRegressionFindings: StoredFinding[];
  iterationFixes: FixEntry[];
  iterationSkipped: SkippedEntry[];
  iterationFindings: Finding[];
  latestReviewIteration: number | null;
  codexReviewText: string | null;
  tmuxOutput: string;
  elapsed: number;
  maxIterations: number;
  error: string | null;
  liveRefreshError: string | null;
  isLoading: boolean;
  lastSessionStats: SessionStats | null;
  projectStats: ProjectStats | null;
  config: Config | null;
  configWarning: string | null;
  isGitRepo: boolean;
  currentAgent: AgentRole | null;
  reviewOptions: ReviewOptions | undefined;
  outputVisible: boolean;
  startupMode?: DashboardStartupMode;
}
