import type { AgentRole, AgentType } from "./domain";
import type { ReviewOptions } from "./run";

export type DefaultReview = { type: "uncommitted" } | { type: "base"; branch: string };

export interface AgentSettings {
  agent: AgentType;
  model?: string;
}

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
    reviewOptions?: ReviewOptions
  ) => string[];
  buildEnv: () => Record<string, string>;
}
