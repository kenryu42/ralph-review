import type { ReasoningLevel } from "./config";
import type { AgentType, DerivedRunStatus, Priority } from "./domain";
import type { LogEntry } from "./log";

/** Stats breakdown per agent */
export interface AgentStats {
  agent: AgentType;
  sessionCount: number;
  /** For reviewers: issues found. For fixers: fixes applied. */
  totalIssues: number;
  totalSkipped: number;
  averageIterations: number;
}

/** Stats breakdown per model */
export interface ModelStats {
  agent: AgentType;
  model: string;
  displayName: string;
  reasoningLevel: ReasoningLevel | "default" | "mixed";
  sessionCount: number;
  /** For reviewers: issues found. For fixers: fixes applied. */
  totalIssues: number;
  totalSkipped: number;
  averageIterations: number;
}

export interface SessionStats {
  sessionPath: string;
  sessionName: string;
  timestamp: number;
  gitBranch?: string;
  status: DerivedRunStatus;
  stop_iteration?: boolean;
  totalFixes: number;
  totalSkipped: number;
  priorityCounts: Record<Priority, number>;
  iterations: number;
  totalDuration?: number;
  entries: LogEntry[];
  reviewer: AgentType;
  reviewerModel: string;
  reviewerReasoning?: ReasoningLevel;
  reviewerDisplayName: string;
  reviewerModelDisplayName: string;
  fixer: AgentType;
  fixerModel: string;
  fixerReasoning?: ReasoningLevel;
  fixerDisplayName: string;
  fixerModelDisplayName: string;
}

export interface ProjectStats {
  projectName: string;
  displayName: string;
  totalFixes: number;
  totalSkipped: number;
  priorityCounts: Record<Priority, number>;
  sessionCount: number;
  averageIterations: number;
  fixRate: number;
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
    averageIterations: number;
    fixRate: number;
  };
  projects: ProjectStats[];
  reviewerAgentStats: AgentStats[];
  fixerAgentStats: AgentStats[];
  reviewerModelStats: ModelStats[];
  fixerModelStats: ModelStats[];
}
