/**
 * Log entry types
 */

import type { AgentSettings } from "./config";
import type { FixSummary } from "./fix";
import type { CodexReviewSummary, ReviewSummary } from "./review";
import type { IterationError } from "./run";

/**
 * System entry - logged once per run with configuration info
 */
export interface SystemEntry {
  type: "system";
  timestamp: number;
  projectPath: string;
  gitBranch?: string;
  reviewer: AgentSettings;
  fixer: AgentSettings;
  maxIterations: number;
}

/**
 * Iteration entry - logged once per iteration with results
 */
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

/**
 * Log entry - union of all entry types
 */
export type LogEntry = SystemEntry | IterationEntry;
