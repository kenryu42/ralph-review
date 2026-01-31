import type { AgentRole, AgentType } from "./domain";

/** Default review mode for 'rr run' when no flags are provided */
export type DefaultReview = { type: "uncommitted" } | { type: "base"; branch: string };

/** Per-agent settings (reviewer or fixer) */
export interface AgentSettings {
  agent: AgentType;
  model?: string;
}

export interface RetryConfig {
  maxRetries: number; // Number of retry attempts (default: 3)
  baseDelayMs: number; // Base delay for exponential backoff (default: 1000)
  maxDelayMs: number; // Maximum delay cap (default: 30000)
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

/** Command-line configuration for executing an agent */
export interface AgentConfig {
  command: string;
  buildArgs: (role: AgentRole, prompt: string, model?: string) => string[];
  buildEnv: () => Record<string, string>;
}
