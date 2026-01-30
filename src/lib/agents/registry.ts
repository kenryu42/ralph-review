/**
 * Agent registry - central registration of all supported agents
 * Separated from index.ts to avoid circular dependencies with runner.ts
 */

import type { AgentConfig, AgentType } from "@/lib/types";

// Agent configurations and stream handlers
import { claudeConfig, extractClaudeResult, formatClaudeLine } from "./claude";
import { codexConfig, extractCodexResult, formatCodexLine } from "./codex";
import { droidConfig, extractDroidResult, formatDroidLine } from "./droid";
import { extractGeminiResult, formatGeminiLine, geminiConfig } from "./gemini";
import { opencodeConfig } from "./opencode";

/**
 * Agent module interface - combines config with stream handling
 */
interface AgentModule {
  /** Agent configuration (command, buildArgs, buildEnv) */
  config: AgentConfig;
  /** Whether this agent uses JSONL output format */
  usesJsonl: boolean;
  /** Line formatter for JSONL streaming (undefined if usesJsonl is false) */
  formatLine?: (line: string) => string | null;
  /** Extract final result from agent output */
  extractResult: (output: string) => string | null;
}

/**
 * Registry of all supported agents
 */
export const AGENTS: Record<AgentType, AgentModule> = {
  claude: {
    config: claudeConfig,
    usesJsonl: true,
    formatLine: formatClaudeLine,
    extractResult: extractClaudeResult,
  },
  codex: {
    config: codexConfig,
    usesJsonl: true,
    formatLine: formatCodexLine,
    extractResult: extractCodexResult,
  },
  droid: {
    config: droidConfig,
    usesJsonl: true,
    formatLine: formatDroidLine,
    extractResult: extractDroidResult,
  },
  gemini: {
    config: geminiConfig,
    usesJsonl: true,
    formatLine: formatGeminiLine,
    extractResult: extractGeminiResult,
  },
  opencode: {
    config: opencodeConfig,
    usesJsonl: false,
    extractResult: (output: string) => output.trim() || null,
  },
};
