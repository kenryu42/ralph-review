/**
 * Claude streaming JSONL parser and formatter
 * Handles parsing Claude's --output-format stream-json output
 */

import type {
  AssistantContentBlock,
  AssistantEvent,
  ClaudeStreamEvent,
  ResultEvent,
  ToolResultBlock,
  UserEvent,
} from "./types";

/**
 * Parse a single JSONL line into a ClaudeStreamEvent
 * Returns null if the line is invalid or not a recognized event type
 */
export function parseClaudeStreamEvent(line: string): ClaudeStreamEvent | null {
  if (!line.trim()) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(line);

    // Must be an object with a type field
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    const obj = parsed as Record<string, unknown>;
    if (typeof obj.type !== "string") {
      return null;
    }

    // Return as the appropriate event type based on 'type' field
    // The caller can use type guards to narrow further
    return parsed as ClaudeStreamEvent;
  } catch {
    return null;
  }
}

/**
 * Runtime guard: check that an event has a message with a content array
 */
function hasMessageContentArray(event: ClaudeStreamEvent): event is AssistantEvent | UserEvent {
  const maybeMessage = (event as { message?: { content?: unknown } }).message;
  return Array.isArray(maybeMessage?.content);
}

/**
 * Runtime guard: assistant event with expected shape
 */
function isAssistantEvent(event: ClaudeStreamEvent): event is AssistantEvent {
  return event.type === "assistant" && hasMessageContentArray(event);
}

/**
 * Runtime guard: user event with expected shape
 */
function isUserEvent(event: ClaudeStreamEvent): event is UserEvent {
  return event.type === "user" && hasMessageContentArray(event);
}

/**
 * Runtime guard: result event with string result
 */
function isResultEvent(event: ClaudeStreamEvent): event is ResultEvent {
  return event.type === "result" && typeof (event as { result?: unknown }).result === "string";
}

/**
 * Format a content block for display
 */
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

/**
 * Format a tool result block for display
 */
function formatToolResult(block: ToolResultBlock): string {
  return `--- Tool Result ---\n${block.content}`;
}

/**
 * Format a ClaudeStreamEvent for terminal display
 * Returns null for events that shouldn't be displayed (e.g., system init)
 */
export function formatClaudeEventForDisplay(event: ClaudeStreamEvent): string | null {
  switch (event.type) {
    case "system":
      // Don't display system init events
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
 * Format an assistant event for display
 */
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

/**
 * Format a user event for display
 */
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

/**
 * Format a result event for display
 */
function formatResultEvent(event: ResultEvent): string {
  return `=== Result ===\n${event.result}`;
}

/**
 * Extract the final result text from Claude's JSONL output
 * Finds the last 'result' event and returns its result field
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
 * Format a content block for fixer context
 */
function formatContentBlockForFixer(block: AssistantContentBlock): string {
  switch (block.type) {
    case "thinking":
      return `[Thinking]\n${block.thinking}`;

    case "text":
      return block.text;

    case "tool_use":
      return `[Tool: ${block.name}]\n> ${JSON.stringify(block.input)}`;

    default:
      return "";
  }
}

/**
 * Strip <system-reminder> tags and their content from text
 * These are injected by Claude CLI and are noise for the fixer
 */
function stripSystemReminders(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, "").trim();
}

/**
 * Format a tool result block for fixer context
 */
function formatToolResultForFixer(block: ToolResultBlock): string {
  const cleanContent = stripSystemReminders(block.content);
  return `[Output]\n${cleanContent}`;
}

/**
 * Format an assistant event for fixer context
 */
function formatAssistantEventForFixer(event: AssistantEvent): string {
  if (!Array.isArray(event.message?.content)) {
    return "";
  }

  const parts: string[] = [];

  for (const block of event.message.content) {
    const formatted = formatContentBlockForFixer(block);
    if (formatted) {
      parts.push(formatted);
    }
  }

  return parts.join("\n\n");
}

/**
 * Format a user event for fixer context
 */
function formatUserEventForFixer(event: UserEvent): string {
  if (!Array.isArray(event.message?.content)) {
    return "";
  }

  const parts: string[] = [];

  for (const block of event.message.content) {
    if (block.type === "tool_result") {
      parts.push(formatToolResultForFixer(block));
    } else if (block.type === "text") {
      parts.push(block.text);
    }
  }

  return parts.join("\n\n");
}

/**
 * Format a result event for fixer context
 */
function formatResultEventForFixer(event: ResultEvent): string {
  return `\n=== FINAL CONCLUSION ===\n${event.result}`;
}

/**
 * Format Claude's JSONL review output for the fixer prompt
 * Extracts meaningful content, removes noise (system init, metadata)
 * Returns null if no meaningful content found
 */
export function formatClaudeReviewForFixer(jsonlOutput: string): string | null {
  if (!jsonlOutput.trim()) {
    return null;
  }

  const lines = jsonlOutput.split("\n");
  const parts: string[] = [];

  for (const line of lines) {
    const event = parseClaudeStreamEvent(line);
    if (!event) continue;

    switch (event.type) {
      case "system":
        // Skip system init events entirely
        break;

      case "assistant": {
        if (isAssistantEvent(event)) {
          const formatted = formatAssistantEventForFixer(event);
          if (formatted) {
            parts.push(formatted);
          }
        }
        break;
      }

      case "user": {
        if (isUserEvent(event)) {
          const formatted = formatUserEventForFixer(event);
          if (formatted) {
            parts.push(formatted);
          }
        }
        break;
      }

      case "result": {
        if (isResultEvent(event)) {
          const formatted = formatResultEventForFixer(event);
          parts.push(formatted);
        }
        break;
      }
    }
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join("\n\n");
}
