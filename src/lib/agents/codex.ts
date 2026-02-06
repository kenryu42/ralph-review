/**
 * Codex agent configuration and stream handling
 */

import { type AgentConfig, type AgentRole, isThinkingLevel, type ReviewOptions } from "@/lib/types";
import { createLineFormatter, defaultBuildEnv, parseJsonlEvent } from "./core";
import type {
  CodexAgentMessageItem,
  CodexCommandExecutionItem,
  CodexReasoningItem,
  CodexStreamEvent,
} from "./types";

const defaultCodexReasoningEffort = "high";
const codexReasoningOptions = new Set(["low", "medium", "high", "xhigh"]);

function resolveCodexReasoningEffort(thinking?: string): string {
  if (isThinkingLevel(thinking) && codexReasoningOptions.has(thinking)) {
    return thinking;
  }
  return defaultCodexReasoningEffort;
}

function withReasoningEffort(args: string[], thinking?: string): string[] {
  return [...args, "--config", `model_reasoning_effort=${resolveCodexReasoningEffort(thinking)}`];
}

function withModel(args: string[], model?: string): string[] {
  return model ? [...args, "--model", model] : args;
}

export const codexConfig: AgentConfig = {
  command: "codex",
  buildArgs: (
    role: AgentRole,
    prompt: string,
    model?: string,
    reviewOptions?: ReviewOptions,
    _provider?: string,
    thinking?: string
  ): string[] => {
    if (role !== "reviewer") {
      const args = withReasoningEffort(["exec", "--full-auto"], thinking);
      return prompt ? withModel([...args, prompt], model) : withModel(args, model);
    }

    const baseReviewArgs = withReasoningEffort(["exec", "--json"], thinking);

    if (reviewOptions?.commitSha) {
      return withModel([...baseReviewArgs, "review", "--commit", reviewOptions.commitSha], model);
    }

    if (reviewOptions?.baseBranch) {
      return withModel([...baseReviewArgs, "review", "--base", reviewOptions.baseBranch], model);
    }

    if (reviewOptions?.customInstructions) {
      const fullPrompt = prompt ? `review ${prompt}` : "review";
      const customArgs = withReasoningEffort(["exec", "--full-auto", "--json"], thinking);
      return withModel([...customArgs, fullPrompt], model);
    }

    return withModel([...baseReviewArgs, "review", "--uncommitted"], model);
  },
  buildEnv: defaultBuildEnv,
};

export function parseCodexStreamEvent(line: string): CodexStreamEvent | null {
  return parseJsonlEvent<CodexStreamEvent>(line);
}

function extractShellCommand(fullCommand: string): string {
  const match = fullCommand.match(/(?:\/bin\/\w+|-lc)\s+'([^']+)'$/);
  if (match?.[1]) {
    return match[1];
  }
  return fullCommand;
}

function formatReasoningForDisplay(item: CodexReasoningItem): string {
  return `[Thinking] ${item.text}`;
}

function formatCommandExecutionForDisplay(item: CodexCommandExecutionItem): string {
  if (item.aggregated_output) {
    return `--- Output ---\n${item.aggregated_output}`;
  }
  return `--- Command: ${extractShellCommand(item.command)} (exit: ${item.exit_code}) ---`;
}

function formatAgentMessageForDisplay(item: CodexAgentMessageItem): string {
  return `=== Result ===\n${item.text}`;
}

function formatItemStartedForDisplay(
  event: Extract<CodexStreamEvent, { type: "item.started" }>
): string | null {
  if (event.item.type === "command_execution") {
    return `--- Command: ${extractShellCommand(event.item.command)} ---`;
  }
  return null;
}

function formatItemCompletedForDisplay(
  event: Extract<CodexStreamEvent, { type: "item.completed" }>
): string | null {
  const item = event.item;

  switch (item.type) {
    case "reasoning":
      return formatReasoningForDisplay(item);

    case "command_execution":
      return formatCommandExecutionForDisplay(item);

    case "agent_message":
      return formatAgentMessageForDisplay(item);

    default:
      return null;
  }
}

export function formatCodexEventForDisplay(event: CodexStreamEvent): string | null {
  switch (event.type) {
    case "thread.started":
    case "turn.started":
    case "turn.completed":
      return null;

    case "item.started":
      return formatItemStartedForDisplay(event);

    case "item.completed":
      return formatItemCompletedForDisplay(event);

    default:
      return null;
  }
}

export function extractCodexResult(output: string): string | null {
  if (!output.trim()) {
    return null;
  }

  const lines = output.split("\n");
  let lastResult: string | null = null;

  for (const line of lines) {
    const event = parseCodexStreamEvent(line);
    if (event?.type === "item.completed" && event.item.type === "agent_message") {
      lastResult = event.item.text;
    }
  }

  return lastResult;
}

export const formatCodexLine = createLineFormatter(
  parseCodexStreamEvent,
  formatCodexEventForDisplay
);
