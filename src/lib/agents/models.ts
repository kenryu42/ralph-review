import type { AgentType, ReasoningLevel } from "@/lib/types";

export const agentOptions = [
  { value: "claude", label: "Claude", hint: "Anthropic" },
  { value: "codex", label: "Codex", hint: "OpenAI" },
  { value: "droid", label: "Droid", hint: "Factory" },
  { value: "gemini", label: "Gemini", hint: "Google" },
  { value: "opencode", label: "OpenCode", hint: "Anomaly" },
  { value: "pi", label: "Pi", hint: "Mario Zechner" },
] as const;

export const claudeModelOptions = [
  { value: "claude-opus-4-7", label: "Claude Opus 4.7" },
  { value: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { value: "claude-opus-4-5", label: "Claude Opus 4.5" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
] as const;

export const geminiModelOptions = [
  { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
  { value: "gemini-3-flash-preview", label: "Gemini 3 Flash" },
  { value: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash Lite" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
] as const;

const commonReasoningLevels: readonly ReasoningLevel[] = ["low", "medium", "high", "xhigh"];

const codexReasoningLevelsByModel: Record<string, readonly ReasoningLevel[]> = {};
const droidReasoningLevelsByModel: Record<string, readonly ReasoningLevel[]> = {};

export function registerCodexReasoningOptions(
  reasoningByModel: Record<string, readonly ReasoningLevel[]>
): void {
  for (const [model, levels] of Object.entries(reasoningByModel)) {
    codexReasoningLevelsByModel[model] = [...levels];
  }
}

export function getCodexReasoningOptions(model: string): ReasoningLevel[] {
  const levels = codexReasoningLevelsByModel[model];
  return levels ? [...levels] : [];
}

export function registerDroidReasoningOptions(
  reasoningByModel: Record<string, readonly ReasoningLevel[]>
): void {
  for (const [model, levels] of Object.entries(reasoningByModel)) {
    droidReasoningLevelsByModel[model] = [...levels];
  }
}

export function resetRegisteredReasoningOptions(): void {
  Object.keys(codexReasoningLevelsByModel).forEach((model) => {
    delete codexReasoningLevelsByModel[model];
  });
  Object.keys(droidReasoningLevelsByModel).forEach((model) => {
    delete droidReasoningLevelsByModel[model];
  });
}

export function getDroidReasoningOptions(model: string): ReasoningLevel[] {
  const levels = droidReasoningLevelsByModel[model];
  return levels ? [...levels] : [];
}

export function getReasoningOptions(agent: AgentType, model?: string): ReasoningLevel[] {
  switch (agent) {
    case "codex":
      return model ? getCodexReasoningOptions(model) : [];

    case "opencode":
    case "pi":
      return [...commonReasoningLevels];

    case "droid":
      if (!model) {
        return [];
      }
      return getDroidReasoningOptions(model);

    case "claude":
      return ["low", "medium", "high"];

    case "gemini":
      return [];

    default:
      return [];
  }
}

export function supportsReasoning(agent: AgentType, model?: string): boolean {
  return getReasoningOptions(agent, model).length > 0;
}

export function getAgentDisplayName(agent: AgentType): string {
  const option = agentOptions.find((opt) => opt.value === agent);
  return option?.label ?? agent;
}

const modelOptionsMap: Record<AgentType, readonly { value: string; label: string }[] | null> = {
  claude: claudeModelOptions,
  codex: null,
  droid: null,
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
