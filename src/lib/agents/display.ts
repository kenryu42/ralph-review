/**
 * Display name utilities for agents and models
 */

import type { AgentType } from "@/lib/types";

/**
 * Agent display options
 */
export const agentOptions = [
  { value: "claude", label: "Claude", hint: "Anthropic" },
  { value: "codex", label: "Codex", hint: "OpenAI" },
  { value: "droid", label: "Droid", hint: "Factory" },
  { value: "gemini", label: "Gemini", hint: "Google" },
  { value: "opencode", label: "OpenCode", hint: "Anomaly" },
] as const;

export const claudeModelOptions = [
  { value: "opus", label: "Claude Opus 4.5" },
  { value: "sonnet", label: "Claude Sonnet 4.5" },
  { value: "haiku", label: "Claude Haiku 4.5" },
] as const;

export const codexModelOptions = [
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

/**
 * Get display name for an agent type
 */
export function getAgentDisplayName(agent: AgentType): string {
  const option = agentOptions.find((opt) => opt.value === agent);
  return option?.label ?? agent;
}

/**
 * Get display name for a model
 */
export function getModelDisplayName(agent: AgentType, model: string): string {
  let options: readonly { value: string; label: string }[];

  switch (agent) {
    case "claude":
      options = claudeModelOptions;
      break;
    case "codex":
      options = codexModelOptions;
      break;
    case "droid":
      options = droidModelOptions;
      break;
    case "gemini":
      options = geminiModelOptions;
      break;
    case "opencode":
      // OpenCode models use the same value for label
      return model;
  }

  const option = options.find((opt) => opt.value === model);
  return option?.label ?? model;
}
