/**
 * Core type definitions for ralph-review CLI
 */

// Agent types supported by the tool
export type AgentType = "codex" | "claude" | "opencode" | "droid" | "gemini";

// Roles an agent can play
export type AgentRole = "reviewer" | "fixer";

// Valid agent types for type guard
const VALID_AGENT_TYPES: readonly AgentType[] = ["codex", "claude", "opencode", "droid", "gemini"];

// Valid agent roles for type guard
const VALID_AGENT_ROLES: readonly AgentRole[] = ["reviewer", "fixer"];

/**
 * Type guard to check if a value is a valid AgentType
 */
export function isAgentType(value: unknown): value is AgentType {
  return typeof value === "string" && VALID_AGENT_TYPES.includes(value as AgentType);
}

/**
 * Type guard to check if a value is a valid AgentRole
 */
export function isAgentRole(value: unknown): value is AgentRole {
  return typeof value === "string" && VALID_AGENT_ROLES.includes(value as AgentRole);
}

// Priority levels for fix entries
export type Priority = "P1" | "P2" | "P3" | "P4";

// Valid priorities for type guard
const VALID_PRIORITIES: readonly Priority[] = ["P1", "P2", "P3", "P4"];

// Valid fix summary decisions
const VALID_FIX_DECISIONS = ["NO_CHANGES_NEEDED", "APPLY_SELECTIVELY", "APPLY_MOST"] as const;
export type FixDecision = (typeof VALID_FIX_DECISIONS)[number];

/**
 * Type guard to check if a value is a valid FixSummary
 */
export function isFixSummary(value: unknown): value is FixSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  // Check decision field
  if (
    typeof obj.decision !== "string" ||
    !VALID_FIX_DECISIONS.includes(obj.decision as FixDecision)
  ) {
    return false;
  }

  // Check fixes array
  if (!Array.isArray(obj.fixes)) {
    return false;
  }

  // Check skipped array
  if (!Array.isArray(obj.skipped)) {
    return false;
  }

  // Validate each fix entry
  for (const fix of obj.fixes) {
    if (!isFixEntry(fix)) {
      return false;
    }
  }

  // Validate each skipped entry
  for (const skipped of obj.skipped) {
    if (!isSkippedEntry(skipped)) {
      return false;
    }
  }

  return true;
}

/**
 * Type guard to check if a value is a valid FixEntry
 */
function isFixEntry(value: unknown): value is FixEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj.id === "number" &&
    typeof obj.title === "string" &&
    typeof obj.priority === "string" &&
    VALID_PRIORITIES.includes(obj.priority as Priority) &&
    (obj.file === undefined || obj.file === null || typeof obj.file === "string") &&
    typeof obj.claim === "string" &&
    typeof obj.evidence === "string" &&
    typeof obj.fix === "string"
  );
}

/**
 * Type guard to check if a value is a valid SkippedEntry
 */
function isSkippedEntry(value: unknown): value is SkippedEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj.id === "number" && typeof obj.title === "string" && typeof obj.reason === "string"
  );
}

/**
 * Configuration for a specific agent (reviewer or fixer)
 */
export interface AgentSettings {
  agent: AgentType;
  model?: string;
}

/**
 * Retry configuration for agent execution
 */
export interface RetryConfig {
  maxRetries: number; // Number of retry attempts (default: 3)
  baseDelayMs: number; // Base delay for exponential backoff (default: 1000)
  maxDelayMs: number; // Maximum delay cap (default: 30000)
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

/**
 * Main configuration stored in ~/.config/ralph-review/config.json
 */
export interface Config {
  reviewer: AgentSettings;
  fixer: AgentSettings;
  maxIterations: number;
  iterationTimeout: number; // in milliseconds
  retry?: RetryConfig; // Optional retry config, uses DEFAULT_RETRY_CONFIG if not set
}

/**
 * Current state of a running review session
 */
export interface RunState {
  sessionName: string;
  startTime: number; // Unix timestamp
  iteration: number;
  status: "running" | "stopped" | "completed" | "failed";
  lastOutput?: string;
}

/**
 * Result of a single iteration (either review or fix)
 */
export interface IterationResult {
  success: boolean;
  hasIssues: boolean;
  output: string;
  exitCode: number;
  duration: number; // in milliseconds
}

/**
 * Configuration for how to run a specific agent
 */
export interface AgentConfig {
  command: string;
  buildArgs: (role: AgentRole, prompt: string, model?: string) => string[];
  buildEnv: () => Record<string, string>;
}

/**
 * Error details for a failed iteration
 */
export interface IterationError {
  phase: "reviewer" | "fixer";
  message: string;
  exitCode?: number;
}

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
  fixes?: FixSummary;
  error?: IterationError;
}

/**
 * Log entry - union of all entry types
 */
export type LogEntry = SystemEntry | IterationEntry;

/**
 * A single fix applied by the fixer
 */
export interface FixEntry {
  id: number;
  title: string;
  priority: Priority;
  file?: string | null;
  claim: string;
  evidence: string;
  fix: string;
}

/**
 * A review item that was skipped (not applied)
 */
export interface SkippedEntry {
  id: number;
  title: string;
  reason: string;
}

/**
 * Summary of fixes applied in an iteration
 */
export interface FixSummary {
  decision: FixDecision;
  fixes: FixEntry[];
  skipped: SkippedEntry[];
}

/**
 * Derived run status for dashboard/session display
 */
export type DerivedRunStatus = "running" | "completed" | "failed" | "interrupted" | "unknown";

/**
 * Statistics for a single review session
 */
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

/**
 * Statistics for a project (collection of sessions)
 */
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

/**
 * Dashboard data aggregated from all projects
 */
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
