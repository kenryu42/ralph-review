import type { AgentSettings } from "./config";
import type { DerivedRunStatus, Priority } from "./domain";
import type { FixSummary } from "./fix";
import type { CodexReviewSummary, ReviewSummary } from "./review";
import type { IterationError, ReviewOptions } from "./run";

export interface SystemEntry {
  type: "system";
  timestamp: number;
  projectPath: string;
  gitBranch?: string;
  reviewer: AgentSettings;
  fixer: AgentSettings;
  codeSimplifier?: AgentSettings;
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
}

export interface SessionSummary {
  schemaVersion: 1;
  logPath: string;
  summaryPath: string;
  projectName: string;
  projectPath?: string;
  gitBranch?: string;
  startedAt?: number;
  updatedAt: number;
  endedAt?: number;
  status: DerivedRunStatus;
  reason?: string;
  iterations: number;
  hasIteration: boolean;
  stop_iteration?: boolean;
  totalFixes: number;
  totalSkipped: number;
  priorityCounts: Record<Priority, number>;
  totalDuration?: number;
}

export type LogEntry = SystemEntry | IterationEntry | SessionEndEntry;
