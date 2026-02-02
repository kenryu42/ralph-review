/**
 * Claude agent configuration and stream handling
 * Integrates with Anthropic's Claude Code CLI
 */

import type { AgentConfig, AgentRole, ReviewOptions } from "@/lib/types";
import { createLineFormatter, defaultBuildEnv, parseJsonlEvent } from "./core";
import type {
  AssistantContentBlock,
  AssistantEvent,
  ClaudeStreamEvent,
  ResultEvent,
  ToolResultBlock,
  UserEvent,
} from "./types";

export const claudeConfig: AgentConfig = {
  command: "claude",
  buildArgs: (
    _role: AgentRole,
    prompt: string,
    model?: string,
    _reviewOptions?: ReviewOptions
  ): string[] => {
    const baseArgs: string[] = [];
    if (model) {
      baseArgs.push("--model", model);
    }

    return [
      ...baseArgs,
      "-p",
      prompt,
      "--dangerously-skip-permissions",
      "--verbose",
      "--output-format",
      "stream-json",
    ];
  },
  buildEnv: defaultBuildEnv,
};

/**
 * Parse a single JSONL line into a ClaudeStreamEvent.
 * Returns null if the line is invalid or not a recognized event type.
 */
export function parseClaudeStreamEvent(line: string): ClaudeStreamEvent | null {
  return parseJsonlEvent<ClaudeStreamEvent>(line);
}

function isAssistantEvent(event: ClaudeStreamEvent): event is AssistantEvent {
  return event.type === "assistant" && Array.isArray((event as AssistantEvent).message?.content);
}

function isUserEvent(event: ClaudeStreamEvent): event is UserEvent {
  return event.type === "user" && Array.isArray((event as UserEvent).message?.content);
}

function isResultEvent(event: ClaudeStreamEvent): event is ResultEvent {
  return event.type === "result" && typeof (event as ResultEvent).result === "string";
}

function formatContentBlock(block: AssistantContentBlock): string {
  switch (block.type) {
    case "thinking":
      return `--- Thinking ---\n${block.thinking}`;

    case "text":
      return block.text;

    case "tool_use":
      return `--- Tool: ${block.name} ---\nInput: ${JSON.stringify(block.input)}`;

    default:
      return "";
  }
}

function formatToolResult(block: ToolResultBlock): string {
  return `--- Tool Result ---\n${block.content}`;
}

function formatAssistantEvent(event: AssistantEvent): string {
  return event.message.content.map(formatContentBlock).filter(Boolean).join("\n\n");
}

function formatUserEvent(event: UserEvent): string {
  return event.message.content
    .map((block) => {
      if (block.type === "tool_result") {
        return formatToolResult(block);
      }
      if (block.type === "text") {
        return block.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function formatResultEvent(event: ResultEvent): string {
  return `=== Result ===\n${event.result}`;
}

/**
 * Format a ClaudeStreamEvent for terminal display
 * Returns null for events that shouldn't be displayed (e.g., system init)
 */
export function formatClaudeEventForDisplay(event: ClaudeStreamEvent): string | null {
  switch (event.type) {
    case "system":
      return null;

    case "assistant":
      return isAssistantEvent(event) ? formatAssistantEvent(event) : null;

    case "user":
      return isUserEvent(event) ? formatUserEvent(event) : null;

    case "result":
      return isResultEvent(event) ? formatResultEvent(event) : null;

    default:
      return null;
  }
}

/**
 * Extract the final result text from Claude's JSONL output.
 * Finds the last 'result' event and returns its result field.
 */
export function extractClaudeResult(output: string): string | null {
  if (!output.trim()) {
    return null;
  }

  const lines = output.split("\n");
  let lastResult: string | null = null;

  for (const line of lines) {
    const event = parseClaudeStreamEvent(line);
    if (event && isResultEvent(event)) {
      lastResult = event.result;
    }
  }

  return lastResult;
}

/**
 * Formatter for streamAndCapture. Wraps the display formatter.
 */
export const formatClaudeLine = createLineFormatter(
  parseClaudeStreamEvent,
  formatClaudeEventForDisplay
);
