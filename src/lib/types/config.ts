import type { AgentRole, AgentType } from "./domain";
import type { ReviewOptions } from "./run";

export type DefaultReview = { type: "uncommitted" } | { type: "base"; branch: string };

type NonPiAgentType = Exclude<AgentType, "pi">;

interface PiAgentSettings {
  agent: "pi";
  provider: string;
  model: string;
}

interface NonPiAgentSettings {
  agent: NonPiAgentType;
  model?: string;
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
    provider?: string
  ) => string[];
  buildEnv: () => Record<string, string>;
}
