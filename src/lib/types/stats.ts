import type { ReasoningLevel } from "./config";
import type {
  AgentType,
  DerivedRunStatus,
  Priority,
  ReviewOutcome,
  ReviewPhase,
  SessionStatus,
} from "./domain";
import type { HandoffStatus } from "./handoff";
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
  sessionId?: string;
  timestamp: number;
  gitBranch?: string;
  worktreeBranch?: string;
  mergeReady?: boolean;
  commitSha?: string;
  reviewOutcome?: ReviewOutcome;
  handoffStatus?: HandoffStatus;
  handoffUpdatedAt?: number;
  status: DerivedRunStatus;
  sessionStatus?: SessionStatus;
  phase?: ReviewPhase;
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
  totalFindings?: number;
  totalSelectedFindings?: number;
  totalAppliedFindings?: number;
  totalSkippedFindings?: number;
  totalUnresolvedSelectedFindings?: number;
  totalAuditRegressions?: number;
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
