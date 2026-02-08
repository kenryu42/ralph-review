import type { AgentRole, AgentType } from "./domain";
import type { ReviewOptions } from "./run";

export type DefaultReview = { type: "uncommitted" } | { type: "base"; branch: string };
export type ReasoningLevel = "low" | "medium" | "high" | "xhigh" | "max";

const VALID_REASONING_LEVELS: readonly ReasoningLevel[] = ["low", "medium", "high", "xhigh", "max"];

export function isReasoningLevel(value: unknown): value is ReasoningLevel {
  return typeof value === "string" && VALID_REASONING_LEVELS.includes(value as ReasoningLevel);
}

type NonPiAgentType = Exclude<AgentType, "pi">;

interface PiAgentSettings {
  agent: "pi";
  provider: string;
  model: string;
  reasoning?: ReasoningLevel;
}

interface NonPiAgentSettings {
  agent: NonPiAgentType;
  model?: string;
  reasoning?: ReasoningLevel;
  provider?: never;
}

export type AgentSettings = PiAgentSettings | NonPiAgentSettings;

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

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
  "code-simplifier"?: AgentSettings;
  maxIterations: number;
  iterationTimeout: number; // in milliseconds
  retry?: RetryConfig; // Optional retry config, uses DEFAULT_RETRY_CONFIG if not set
  defaultReview: DefaultReview;
}

export interface AgentConfig {
  command: string;
  buildArgs: (
    role: AgentRole,
    prompt: string,
    model?: string,
    reviewOptions?: ReviewOptions,
    provider?: string,
    reasoning?: string
  ) => string[];
  buildEnv: () => Record<string, string>;
}
