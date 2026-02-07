/**
 * Droid agent configuration and stream handling
 */

import {
  type AgentConfig,
  type AgentRole,
  isReasoningLevel,
  type ReviewOptions,
} from "@/lib/types";
import {
  createLineFormatter,
  defaultBuildEnv,
  parseJsonlEvent,
  stripSystemReminders,
} from "./core";
import { getReasoningOptions } from "./models";
import type {
  DroidCompletionEvent,
  DroidMessageEvent,
  DroidStreamEvent,
  DroidToolCallEvent,
  DroidToolResultEvent,
} from "./types";

export const droidConfig: AgentConfig = {
  command: "droid",
  buildArgs: (
    _role: AgentRole,
    prompt: string,
    model?: string,
    _reviewOptions?: ReviewOptions,
    _provider?: string,
    reasoning?: string
  ): string[] => {
    const effectiveModel = model ?? "gpt-5.2-codex";
    const supportedReasoningOptions = getReasoningOptions("droid", effectiveModel);

    const args: string[] = [
      "exec",
      "--auto",
      "medium",
      "--model",
      effectiveModel,
      "--output-format",
      "stream-json",
    ];

    if (supportedReasoningOptions.length > 0) {
      const reasoningLevel =
        isReasoningLevel(reasoning) && supportedReasoningOptions.includes(reasoning)
          ? reasoning
          : "high";
      args.push("--reasoning-effort", reasoningLevel);
    }

    args.push(prompt);

    return args;
  },
  buildEnv: defaultBuildEnv,
};

export function parseDroidStreamEvent(line: string): DroidStreamEvent | null {
  return parseJsonlEvent<DroidStreamEvent>(line);
}

function formatMessageEvent(event: DroidMessageEvent): string | null {
  if (event.role === "user") {
    return null;
  }

  return event.text;
}

function formatToolCallEvent(event: DroidToolCallEvent): string {
  return `--- Tool: ${event.toolName} ---\nInput: ${JSON.stringify(event.parameters)}`;
}

function formatToolResultEvent(event: DroidToolResultEvent): string {
  const cleanValue = stripSystemReminders(event.value);
  return `--- Tool Result ---\n${cleanValue}`;
}

function formatCompletionEvent(event: DroidCompletionEvent): string {
  return `=== Result ===\n${event.finalText}`;
}

export function formatDroidEventForDisplay(event: DroidStreamEvent): string | null {
  switch (event.type) {
    case "system":
      return null;

    case "message":
      return formatMessageEvent(event);

    case "tool_call":
      return formatToolCallEvent(event);

    case "tool_result":
      return formatToolResultEvent(event);

    case "completion":
      return formatCompletionEvent(event);

    default:
      return null;
  }
}

export function extractDroidResult(output: string): string | null {
  if (!output.trim()) {
    return null;
  }

  const lines = output.split("\n");
  let lastResult: string | null = null;

  for (const line of lines) {
    const event = parseDroidStreamEvent(line);
    if (event?.type === "completion") {
      lastResult = event.finalText;
    }
  }

  return lastResult;
}

export const formatDroidLine = createLineFormatter(
  parseDroidStreamEvent,
  formatDroidEventForDisplay
);
