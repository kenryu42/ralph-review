/**
 * Claude agent configuration and stream handling
 * Integrates with Anthropic's Claude Code CLI
 */

import type { AgentConfig, AgentRole, ReviewOptions } from "@/lib/types";
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
  buildEnv: (): Record<string, string> => {
    return {
      ...(process.env as Record<string, string>),
    };
  },
};

/**
 * Parse a single JSONL line into a ClaudeStreamEvent.
 * Returns null if the line is invalid or not a recognized event type.
 */
export function parseClaudeStreamEvent(line: string): ClaudeStreamEvent | null {
  if (!line.trim()) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(line);

    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    const obj = parsed as Record<string, unknown>;
    if (typeof obj.type !== "string") {
      return null;
    }

    return parsed as ClaudeStreamEvent;
  } catch {
    return null;
  }
}

function hasMessageContentArray(event: ClaudeStreamEvent): event is AssistantEvent | UserEvent {
  const maybeMessage = (event as { message?: { content?: unknown } }).message;
  return Array.isArray(maybeMessage?.content);
}

function isAssistantEvent(event: ClaudeStreamEvent): event is AssistantEvent {
  return event.type === "assistant" && hasMessageContentArray(event);
}

function isUserEvent(event: ClaudeStreamEvent): event is UserEvent {
  return event.type === "user" && hasMessageContentArray(event);
}

function isResultEvent(event: ClaudeStreamEvent): event is ResultEvent {
  return event.type === "result" && typeof (event as { result?: unknown }).result === "string";
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
  if (!Array.isArray(event.message?.content)) {
    return "";
  }

  const parts: string[] = [];

  for (const block of event.message.content) {
    const formatted = formatContentBlock(block);
    if (formatted) {
      parts.push(formatted);
    }
  }

  return parts.join("\n\n");
}

function formatUserEvent(event: UserEvent): string {
  if (!Array.isArray(event.message?.content)) {
    return "";
  }

  const parts: string[] = [];

  for (const block of event.message.content) {
    if (block.type === "tool_result") {
      parts.push(formatToolResult(block));
    } else if (block.type === "text") {
      parts.push(block.text);
    }
  }

  return parts.join("\n\n");
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
export function formatClaudeLine(line: string): string | null {
  const event = parseClaudeStreamEvent(line);
  if (event) {
    return formatClaudeEventForDisplay(event) ?? "";
  }
  return null;
}
