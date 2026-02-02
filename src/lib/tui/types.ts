import type { ActiveSession, LockData } from "@/lib/lockfile";
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
  currentSession: LockData | null;
  logEntries: LogEntry[];
  fixes: FixEntry[];
  skipped: SkippedEntry[];
  findings: Finding[];
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
