/**
 * Core type definitions for ralph-review CLI
 */

// Agent types supported by the tool
export type AgentType = "codex" | "claude" | "opencode";

// Roles an agent can play
export type AgentRole = "reviewer" | "fixer";

// Valid agent types for type guard
const VALID_AGENT_TYPES: readonly AgentType[] = ["codex", "claude", "opencode"];

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
 * Result of a single iteration (either review or implementation)
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
 * Log entry for storing review/implementation output
 */
export interface LogEntry {
  timestamp: number;
  type: "review" | "implement" | "system" | "error";
  content: string;
  iteration: number;
}
