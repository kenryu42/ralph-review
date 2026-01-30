import type { DerivedRunStatus, Priority } from "./domain";
import type { LogEntry } from "./log";

export interface SessionStats {
  sessionPath: string;
  sessionName: string;
  timestamp: number;
  gitBranch?: string;
  status: DerivedRunStatus;
  totalFixes: number;
  totalSkipped: number;
  priorityCounts: Record<Priority, number>;
  iterations: number;
  totalDuration?: number;
  entries: LogEntry[];
}

export interface ProjectStats {
  projectName: string;
  displayName: string;
  totalFixes: number;
  totalSkipped: number;
  priorityCounts: Record<Priority, number>;
  sessionCount: number;
  successCount: number;
  sessions: SessionStats[];
}

export interface DashboardData {
  generatedAt: number;
  currentProject?: string;
  globalStats: {
    totalFixes: number;
    totalSkipped: number;
    priorityCounts: Record<Priority, number>;
    totalSessions: number;
    successRate: number;
  };
  projects: ProjectStats[];
}
