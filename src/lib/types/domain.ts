/**
 * Core domain primitives and constants
 */

// Agent types supported by the tool
export type AgentType = "codex" | "claude" | "opencode" | "droid" | "gemini";

// Roles an agent can play
export type AgentRole = "reviewer" | "fixer";

// Priority levels for fix entries
export type Priority = "P1" | "P2" | "P3" | "P4";

// Valid fix summary decisions
export type FixDecision = "NO_CHANGES_NEEDED" | "APPLY_SELECTIVELY" | "APPLY_MOST";

// Valid overall correctness values
export type OverallCorrectness = "patch is correct" | "patch is incorrect";

// Derived run status for dashboard/session display
export type DerivedRunStatus = "running" | "completed" | "failed" | "interrupted" | "unknown";

// Valid agent types for type guard
const VALID_AGENT_TYPES: readonly AgentType[] = ["codex", "claude", "opencode", "droid", "gemini"];

// Valid agent roles for type guard
const VALID_AGENT_ROLES: readonly AgentRole[] = ["reviewer", "fixer"];

// Valid priorities for type guard
export const VALID_PRIORITIES: readonly Priority[] = ["P1", "P2", "P3", "P4"];

// Valid fix decisions for type guard
export const VALID_FIX_DECISIONS: readonly FixDecision[] = [
  "NO_CHANGES_NEEDED",
  "APPLY_SELECTIVELY",
  "APPLY_MOST",
];

// Valid overall correctness values for type guard
export const VALID_OVERALL_CORRECTNESS: readonly OverallCorrectness[] = [
  "patch is correct",
  "patch is incorrect",
];

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
