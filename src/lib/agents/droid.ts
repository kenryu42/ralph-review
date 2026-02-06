/**
 * Droid agent configuration and stream handling
 */

import { type AgentConfig, type AgentRole, isThinkingLevel, type ReviewOptions } from "@/lib/types";
import {
  createLineFormatter,
  defaultBuildEnv,
  parseJsonlEvent,
  stripSystemReminders,
} from "./core";
import { getThinkingOptions } from "./models";
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
    thinking?: string
  ): string[] => {
    const effectiveModel = model ?? "gpt-5.2-codex";
    const supportedThinkingOptions = getThinkingOptions("droid", effectiveModel);

    const args: string[] = [
      "exec",
      "--auto",
      "medium",
      "--model",
      effectiveModel,
      "--output-format",
      "stream-json",
    ];

    if (supportedThinkingOptions.length > 0) {
      const thinkingLevel =
        isThinkingLevel(thinking) && supportedThinkingOptions.includes(thinking)
          ? thinking
          : "high";
      args.push("--reasoning-effort", thinkingLevel);
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
