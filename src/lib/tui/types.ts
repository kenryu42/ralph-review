import type { ActiveSession, LockData } from "@/lib/lockfile";
import type {
  Config,
  FixEntry,
  LogEntry,
  ProjectStats,
  SessionStats,
  SkippedEntry,
} from "@/lib/types";

/**
 * Dashboard state containing all data needed for rendering
 */
export interface DashboardState {
  sessions: ActiveSession[];
  currentSession: LockData | null;
  logEntries: LogEntry[];
  fixes: FixEntry[];
  skipped: SkippedEntry[];
  tmuxOutput: string;
  elapsed: number;
  maxIterations: number;
  error: string | null;
  isLoading: boolean;
  lastSessionStats: SessionStats | null;
  projectStats: ProjectStats | null;
  config: Config | null;
  isGitRepo: boolean;
}

export interface DashboardProps {
  projectPath: string;
  branch?: string;
  refreshInterval?: number;
}
