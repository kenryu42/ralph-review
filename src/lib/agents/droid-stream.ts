/**
 * Droid streaming JSONL parser and formatter
 * Handles parsing Droid's --output-format stream-json output
 */

import type {
  DroidCompletionEvent,
  DroidMessageEvent,
  DroidStreamEvent,
  DroidToolCallEvent,
  DroidToolResultEvent,
} from "./types";

/**
 * Parse a single JSONL line into a DroidStreamEvent
 * Returns null if the line is invalid or not a recognized event type
 */
export function parseDroidStreamEvent(line: string): DroidStreamEvent | null {
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
    return parsed as DroidStreamEvent;
  } catch {
    return null;
  }
}

/**
 * Strip <system-reminder> tags and their content from text
 */
function stripSystemReminders(text: unknown): string {
  const normalized = typeof text === "string" ? text : String(text ?? "");
  return normalized.replace(/<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, "").trim();
}

/**
 * Format a DroidStreamEvent for terminal display
 * Returns null for events that shouldn't be displayed (system init, user messages)
 */
export function formatDroidEventForDisplay(event: DroidStreamEvent): string | null {
  switch (event.type) {
    case "system":
      // Don't display system init events
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

/**
 * Format a message event for display
 */
function formatMessageEvent(event: DroidMessageEvent): string | null {
  // Skip user messages
  if (event.role === "user") {
    return null;
  }

  // Assistant messages are displayed as-is
  return event.text;
}

/**
 * Format a tool call event for display
 */
function formatToolCallEvent(event: DroidToolCallEvent): string {
  return `--- Tool: ${event.toolName} ---\nInput: ${JSON.stringify(event.parameters)}`;
}

/**
 * Format a tool result event for display
 */
function formatToolResultEvent(event: DroidToolResultEvent): string {
  const cleanValue = stripSystemReminders(event.value);
  return `--- Tool Result ---\n${cleanValue}`;
}

/**
 * Format a completion event for display
 */
function formatCompletionEvent(event: DroidCompletionEvent): string {
  return `=== Result ===\n${event.finalText}`;
}

// ============================================================================
// Fixer-specific formatting
// ============================================================================

/**
 * Format a tool call event for fixer context
 */
function formatToolCallForFixer(event: DroidToolCallEvent): string {
  return `[Tool: ${event.toolName}]\n> ${JSON.stringify(event.parameters)}`;
}

/**
 * Format a tool result event for fixer context
 */
function formatToolResultForFixer(event: DroidToolResultEvent): string {
  const cleanValue = stripSystemReminders(event.value);
  return `[Output]\n${cleanValue}`;
}

/**
 * Format a message event for fixer context
 */
function formatMessageForFixer(event: DroidMessageEvent): string | null {
  // Skip user messages
  if (event.role === "user") {
    return null;
  }

  // Assistant messages are displayed as-is (no label)
  return event.text;
}

/**
 * Format a completion event for fixer context
 */
function formatCompletionForFixer(event: DroidCompletionEvent): string {
  return `\n=== FINAL CONCLUSION ===\n${event.finalText}`;
}

/**
 * Format Droid's JSONL review output for the fixer prompt
 * Extracts meaningful content, removes noise (system init, user messages, metadata)
 * Returns null if no meaningful content found
 */
export function formatDroidReviewForFixer(jsonlOutput: string): string | null {
  if (!jsonlOutput.trim()) {
    return null;
  }

  const lines = jsonlOutput.split("\n");
  const parts: string[] = [];

  for (const line of lines) {
    const event = parseDroidStreamEvent(line);
    if (!event) continue;

    switch (event.type) {
      case "system":
        // Skip system init events entirely
        break;

      case "message": {
        const formatted = formatMessageForFixer(event);
        if (formatted) {
          parts.push(formatted);
        }
        break;
      }

      case "tool_call": {
        const formatted = formatToolCallForFixer(event);
        parts.push(formatted);
        break;
      }

      case "tool_result": {
        const formatted = formatToolResultForFixer(event);
        parts.push(formatted);
        break;
      }

      case "completion": {
        const formatted = formatCompletionForFixer(event);
        parts.push(formatted);
        break;
      }
    }
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join("\n\n");
}

/**
 * Extract the final result text from Droid's JSONL output
 * Finds the last 'completion' event and returns its finalText field
 */
export function extractDroidResult(output: string): string | null {
  if (!output.trim()) {
    return null;
  }

  const lines = output.split("\n");
  let lastResult: string | null = null;

  for (const line of lines) {
    const event = parseDroidStreamEvent(line);
    if (event?.type === "completion") {
      lastResult = (event as DroidCompletionEvent).finalText;
    }
  }

  return lastResult;
}
