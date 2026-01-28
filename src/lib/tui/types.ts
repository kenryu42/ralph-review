/**
 * Types for the TUI dashboard
 */

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
  /** All active sessions across projects */
  sessions: ActiveSession[];
  /** Current project's session lock data */
  currentSession: LockData | null;
  /** Log entries for current session */
  logEntries: LogEntry[];
  /** Fixes applied in current session */
  fixes: FixEntry[];
  /** Items skipped in current session */
  skipped: SkippedEntry[];
  /** Recent tmux output */
  tmuxOutput: string;
  /** Elapsed time in milliseconds */
  elapsed: number;
  /** Max iterations from config */
  maxIterations: number;
  /** Error message if any */
  error: string | null;
  /** Whether data is loading */
  isLoading: boolean;
  /** Stats from the most recent session (for idle display) */
  lastSessionStats: SessionStats | null;
  /** Project lifetime stats */
  projectStats: ProjectStats | null;
  /** Current configuration */
  config: Config | null;
}

/**
 * Props for the main Dashboard component
 */
export interface DashboardProps {
  /** Absolute path to the project */
  projectPath: string;
  /** Git branch name */
  branch?: string;
  /** Refresh interval in milliseconds (default: 1000) */
  refreshInterval?: number;
}
