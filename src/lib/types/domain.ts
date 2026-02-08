export type AgentType = "codex" | "claude" | "opencode" | "droid" | "gemini" | "pi";
export type AgentRole = "reviewer" | "fixer" | "code-simplifier";
export type Priority = "P0" | "P1" | "P2" | "P3";
export type FixDecision = "NO_CHANGES_NEEDED" | "APPLY_SELECTIVELY" | "APPLY_MOST" | "NEED_INFO";
export type OverallCorrectness = "patch is correct" | "patch is incorrect";
export type DerivedRunStatus = "running" | "completed" | "failed" | "interrupted" | "unknown";

const VALID_AGENT_TYPES: readonly AgentType[] = [
  "codex",
  "claude",
  "opencode",
  "droid",
  "gemini",
  "pi",
];
const VALID_AGENT_ROLES: readonly AgentRole[] = ["reviewer", "fixer", "code-simplifier"];
export const VALID_PRIORITIES: readonly Priority[] = ["P0", "P1", "P2", "P3"];
export const VALID_FIX_DECISIONS: readonly FixDecision[] = [
  "NO_CHANGES_NEEDED",
  "APPLY_SELECTIVELY",
  "APPLY_MOST",
  "NEED_INFO",
];
export const VALID_OVERALL_CORRECTNESS: readonly OverallCorrectness[] = [
  "patch is correct",
  "patch is incorrect",
];

export function isAgentType(value: unknown): value is AgentType {
  return typeof value === "string" && VALID_AGENT_TYPES.includes(value as AgentType);
}

export function isAgentRole(value: unknown): value is AgentRole {
  return typeof value === "string" && VALID_AGENT_ROLES.includes(value as AgentRole);
}
