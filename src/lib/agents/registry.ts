import type { AgentConfig, AgentType } from "@/lib/types";

import { claudeConfig, extractClaudeResult, formatClaudeLine } from "./claude";
import { codexConfig, extractCodexResult, formatCodexLine } from "./codex";
import { droidConfig, extractDroidResult, formatDroidLine } from "./droid";
import { extractGeminiResult, formatGeminiLine, geminiConfig } from "./gemini";
import { opencodeConfig } from "./opencode";
import { extractPiResult, formatPiLine, piConfig } from "./pi";

interface AgentModule {
  config: AgentConfig;
  usesJsonl: boolean;
  formatLine?: (line: string) => string | null;
  extractResult: (output: string) => string | null;
}

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
  pi: {
    config: piConfig,
    usesJsonl: true,
    formatLine: formatPiLine,
    extractResult: extractPiResult,
  },
};
