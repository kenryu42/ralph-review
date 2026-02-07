import type { AgentType, ThinkingLevel } from "@/lib/types";

export const agentOptions = [
  { value: "claude", label: "Claude", hint: "Anthropic" },
  { value: "codex", label: "Codex", hint: "OpenAI" },
  { value: "droid", label: "Droid", hint: "Factory" },
  { value: "gemini", label: "Gemini", hint: "Google" },
  { value: "opencode", label: "OpenCode", hint: "Anomaly" },
  { value: "pi", label: "Pi", hint: "Mario Zechner" },
] as const;

export const claudeModelOptions = [
  { value: "opus", label: "Claude Opus 4.6" },
  { value: "sonnet", label: "Claude Sonnet 4.5" },
  { value: "haiku", label: "Claude Haiku 4.5" },
] as const;

export const codexModelOptions = [
  { value: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
  { value: "gpt-5.2-codex", label: "GPT-5.2 Codex" },
  { value: "gpt-5.2", label: "GPT-5.2" },
  { value: "gpt-5.1-codex-max", label: "GPT-5.1 Codex Max" },
  { value: "gpt-5.1-codex-mini", label: "GPT-5.1 Codex Mini" },
] as const;

export const droidModelOptions = [
  { value: "gpt-5.1", label: "GPT-5.1" },
  { value: "gpt-5.1-codex", label: "GPT-5.1 Codex" },
  { value: "gpt-5.1-codex-max", label: "GPT-5.1 Codex Max" },
  { value: "gpt-5.2", label: "GPT-5.2" },
  { value: "gpt-5.2-codex", label: "GPT-5.2 Codex" },
  { value: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { value: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
  { value: "claude-opus-4-5-20251101", label: "Claude Opus 4.5" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  { value: "gemini-3-pro-preview", label: "Gemini 3 Pro" },
  { value: "gemini-3-flash-preview", label: "Gemini 3 Flash" },
  { value: "glm-4.7", label: "Droid Core (GLM-4.7)" },
  { value: "kimi-k2.5", label: "Droid Core (Kimi K2.5)" },
] as const;

export const geminiModelOptions = [
  { value: "gemini-3-pro-preview", label: "Gemini 3 Pro" },
  { value: "gemini-3-flash-preview", label: "Gemini 3 Flash" },
] as const;

const commonThinkingLevels: readonly ThinkingLevel[] = ["low", "medium", "high", "xhigh"];

const droidThinkingLevelsByModel: Record<string, readonly ThinkingLevel[]> = {
  "gpt-5.1": ["low", "medium", "high"],
  "gpt-5.1-codex": ["low", "medium", "high"],
  "gpt-5.1-codex-max": ["low", "medium", "high", "xhigh"],
  "gpt-5.2": ["low", "medium", "high", "xhigh"],
  "gpt-5.2-codex": ["low", "medium", "high", "xhigh"],
  "claude-sonnet-4-5-20250929": ["low", "medium", "high"],
  "claude-opus-4-5-20251101": ["low", "medium", "high"],
  "claude-haiku-4-5-20251001": ["low", "medium", "high"],
  "claude-opus-4-6": ["low", "medium", "high", "max"],
  "gemini-3-pro-preview": ["low", "medium", "high"],
  "gemini-3-flash-preview": ["low", "medium", "high"],
};

export function getDroidThinkingOptions(model: string): ThinkingLevel[] {
  const levels = droidThinkingLevelsByModel[model];
  return levels ? [...levels] : [];
}

export function getThinkingOptions(agent: AgentType, model?: string): ThinkingLevel[] {
  switch (agent) {
    case "codex":
    case "opencode":
    case "pi":
      return [...commonThinkingLevels];

    case "droid":
      if (!model) {
        return [];
      }
      return getDroidThinkingOptions(model);

    case "claude":
    case "gemini":
      return [];

    default:
      return [];
  }
}

export function supportsThinking(agent: AgentType, model?: string): boolean {
  return getThinkingOptions(agent, model).length > 0;
}

export function getAgentDisplayName(agent: AgentType): string {
  const option = agentOptions.find((opt) => opt.value === agent);
  return option?.label ?? agent;
}

const modelOptionsMap: Record<AgentType, readonly { value: string; label: string }[] | null> = {
  claude: claudeModelOptions,
  codex: codexModelOptions,
  droid: droidModelOptions,
  gemini: geminiModelOptions,
  opencode: null,
  pi: null,
};

export function getModelDisplayName(agent: AgentType, model: string): string {
  const options = modelOptionsMap[agent];
  if (!options) {
    return model;
  }
  const option = options.find((opt) => opt.value === model);
  return option?.label ?? model;
}

export function getAgentModelStatsKey(agent: AgentType, model: string): string {
  return `${agent}::${model}`;
}
