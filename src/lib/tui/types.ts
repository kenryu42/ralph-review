import type { ActiveSession, SessionState } from "@/lib/session-state";
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

export interface DashboardState {
  sessions: ActiveSession[];
  projectSessions: ActiveSession[];
  currentSession: SessionState | null;
  logEntries: LogEntry[];
  fixes: FixEntry[];
  skipped: SkippedEntry[];
  findings: Finding[];
  iterationFixes: FixEntry[];
  iterationSkipped: SkippedEntry[];
  iterationFindings: Finding[];
  latestReviewIteration: number | null;
  codexReviewText: string | null;
  tmuxOutput: string;
  elapsed: number;
  maxIterations: number;
  error: string | null;
  isLoading: boolean;
  lastSessionStats: SessionStats | null;
  projectStats: ProjectStats | null;
  config: Config | null;
  isGitRepo: boolean;
  currentAgent: AgentRole | null;
  reviewOptions: ReviewOptions | undefined;
}

export interface DashboardProps {
  projectPath: string;
  branch?: string;
  refreshInterval?: number;
}
