import type { AgentSettings } from "./config";
import type { FixSummary } from "./fix";
import type { CodexReviewSummary, ReviewSummary } from "./review";
import type { IterationError } from "./run";

/** Initial entry with run configuration and git state */
export interface SystemEntry {
  type: "system";
  timestamp: number;
  projectPath: string;
  gitBranch?: string;
  reviewer: AgentSettings;
  fixer: AgentSettings;
  maxIterations: number;
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

/** Union of SystemEntry and IterationEntry */
export type LogEntry = SystemEntry | IterationEntry;
