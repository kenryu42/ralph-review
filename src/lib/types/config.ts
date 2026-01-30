/**
 * Configuration types
 */

import type { AgentRole, AgentType } from "./domain";

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
 * Configuration for how to run a specific agent
 */
export interface AgentConfig {
  command: string;
  buildArgs: (role: AgentRole, prompt: string, model?: string) => string[];
  buildEnv: () => Record<string, string>;
}
