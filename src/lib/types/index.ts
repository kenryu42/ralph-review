/**
 * Core type definitions for ralph-review CLI
 *
 * This is the main entry point for all types.
 * Individual types are organized into focused modules.
 */

// Configuration types
export {
  type AgentConfig,
  type AgentSettings,
  type Config,
  DEFAULT_RETRY_CONFIG,
  type RetryConfig,
} from "./config";
// Domain primitives (public types and guards only)
export {
  type AgentRole,
  type AgentType,
  type DerivedRunStatus,
  type FixDecision,
  isAgentRole,
  isAgentType,
  type OverallCorrectness,
  type Priority,
} from "./domain";
// Fix types and guards
export { type FixEntry, type FixSummary, isFixSummary, type SkippedEntry } from "./fix";
// Log entry types
export type { IterationEntry, LogEntry, SystemEntry } from "./log";

// Review types and guards
export {
  type CodexReviewSummary,
  type Finding,
  isReviewSummary,
  type ReviewSummary,
} from "./review";
// Runtime state types
export type { IterationError, IterationResult, RunState } from "./run";

// Statistics types
export type { DashboardData, ProjectStats, SessionStats } from "./stats";
