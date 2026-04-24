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
  handoffId?: string;
  handoffUpdatedAt?: number;
  status: DerivedRunStatus;
  sessionStatus?: SessionStatus;
  phase?: ReviewPhase;
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
  totalResolvedSelectedFindings?: number;
  totalUnresolvedSelectedFindings?: number;
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
