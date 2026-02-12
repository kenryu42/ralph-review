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

export interface SoundNotificationConfig {
  enabled: boolean;
}

export interface NotificationsConfig {
  sound: SoundNotificationConfig;
}

export const CONFIG_SCHEMA_URI =
  "https://raw.githubusercontent.com/kenryu42/ralph-review/main/assets/ralph-review.schema.json";
export const CONFIG_VERSION = 1;

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

export const DEFAULT_NOTIFICATIONS_CONFIG: NotificationsConfig = {
  sound: {
    enabled: false,
  },
};

/**
 * Main configuration stored in ~/.config/ralph-review/config.json
 */
export interface Config {
  $schema: typeof CONFIG_SCHEMA_URI;
  version: typeof CONFIG_VERSION;
  reviewer: AgentSettings;
  fixer: AgentSettings;
  "code-simplifier"?: AgentSettings;
  maxIterations: number;
  iterationTimeout: number; // in milliseconds
  retry?: RetryConfig; // Optional retry config, uses DEFAULT_RETRY_CONFIG if not set
  defaultReview: DefaultReview;
  notifications: NotificationsConfig;
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
  buildEnv: (reasoning?: string) => Record<string, string>;
}
