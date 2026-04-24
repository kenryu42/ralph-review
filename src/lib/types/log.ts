import type {
  FindingFixResult,
  FindingId,
  StoredFinding,
} from "@/lib/review-workflow/findings/types";
import type { AgentSettings } from "./config";
import type {
  DerivedRunStatus,
  Priority,
  ReviewOutcome,
  ReviewPhase,
  SessionStatus,
} from "./domain";
import type { FixSummary } from "./fix";
import type { HandoffStatus } from "./handoff";
import type { CodexReviewSummary, ReviewSummary } from "./review";
import type { IterationError, ReviewOptions } from "./run";

export interface SystemEntry {
  type: "system";
  timestamp: number;
  sessionId?: string;
  projectPath: string;
  gitBranch?: string;
  worktreeProjectPath?: string;
  worktreeBranch?: string;
  reviewer: AgentSettings;
  fixer: AgentSettings;
  maxIterations: number;
  reviewOptions?: ReviewOptions;
}

export interface IterationEntry {
  type: "iteration";
  timestamp: number;
  iteration: number;
  duration?: number;
  review?: ReviewSummary;
  codexReview?: CodexReviewSummary;
  fixes?: FixSummary;
  error?: IterationError;
}

export interface SessionEndEntry {
  type: "session_end";
  timestamp: number;
  status: "completed" | "failed" | "interrupted";
  reason: string;
  iterations: number;
  phase?: ReviewPhase;
  sessionStatus?: SessionStatus;
  reviewOutcome?: ReviewOutcome;
  handoffStatus?: HandoffStatus;
  handoffId?: string;
  handoffUpdatedAt?: number;
  mergeReady?: boolean;
  commitSha?: string;
  worktreeBranch?: string;
  worktreeProjectPath?: string;
  terminalReview?: ReviewSummary;
}

export interface HandoffEntry {
  type: "handoff";
  timestamp: number;
  handoffId?: string;
  handoffStatus: HandoffStatus;
  commitSha?: string;
}

export interface ReviewIterationEntry {
  type: "review_iteration";
  timestamp: number;
  iteration: number;
  phase: Extract<ReviewPhase, "review">;
  sessionStatus: SessionStatus;
  duration?: number;
  findings: StoredFinding[];
  netNewFindingIds: FindingId[];
  error?: IterationError;
}

export interface FindingSelectionEntry {
  type: "finding_selection";
  timestamp: number;
  selectionMode: "all" | "priority" | "id";
  selectedFindingIds: FindingId[];
}

export interface BatchFixEntry {
  type: "batch_fix";
  timestamp: number;
  duration?: number;
  selectedFindingIds: FindingId[];
  fixResults: FindingFixResult[];
  error?: IterationError;
}

export interface SessionSummary {
  schemaVersion: 2;
  logPath: string;
  summaryPath: string;
  sessionId?: string;
  projectName: string;
  projectPath?: string;
  gitBranch?: string;
  startedAt?: number;
  updatedAt: number;
  endedAt?: number;
  status: DerivedRunStatus;
  sessionStatus?: SessionStatus;
  phase?: ReviewPhase;
  reason?: string;
  iterations: number;
  hasIteration: boolean;
  totalFixes: number;
  totalSkipped: number;
  priorityCounts: Record<Priority, number>;
  totalDuration?: number;
  reviewOutcome?: ReviewOutcome;
  handoffStatus?: HandoffStatus;
  handoffId?: string;
  handoffUpdatedAt?: number;
  mergeReady?: boolean;
  commitSha?: string;
  worktreeBranch?: string;
  totalFindings?: number;
  totalSelectedFindings?: number;
  totalResolvedSelectedFindings?: number;
  totalUnresolvedSelectedFindings?: number;
}

export type LogEntry =
  | SystemEntry
  | IterationEntry
  | ReviewIterationEntry
  | FindingSelectionEntry
  | BatchFixEntry
  | SessionEndEntry
  | HandoffEntry;
