import type { AgentType } from "@/lib/types";

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
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
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
