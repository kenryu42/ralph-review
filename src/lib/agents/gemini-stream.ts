/**
 * Gemini streaming JSONL parser and formatter
 * Handles parsing Gemini's --output-format stream-json output
 *
 * NOTE: Gemini streams assistant messages as deltas that need to be concatenated
 * to form the complete response.
 */

import type {
  GeminiMessageEvent,
  GeminiResultEvent,
  GeminiStreamEvent,
  GeminiToolResultEvent,
  GeminiToolUseEvent,
} from "./types";

/**
 * Parse a single JSONL line into a GeminiStreamEvent
 * Returns null if the line is invalid or not a recognized event type
 */
export function parseGeminiStreamEvent(line: string): GeminiStreamEvent | null {
  if (!line.trim()) {
    return null;
  }

  // Skip non-JSON lines (log output like "YOLO mode is enabled")
  if (!line.startsWith("{")) {
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
    return parsed as GeminiStreamEvent;
  } catch {
    return null;
  }
}

/**
 * Strip <system-reminder> tags and their content from text
 */
function stripSystemReminders(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, "").trim();
}

/**
 * Format a GeminiStreamEvent for terminal display
 * Returns null for events that shouldn't be displayed (init, user messages)
 */
export function formatGeminiEventForDisplay(event: GeminiStreamEvent): string | null {
  switch (event.type) {
    case "init":
      // Don't display init events
      return null;

    case "message":
      return formatMessageEvent(event);

    case "tool_use":
      return formatToolUseEvent(event);

    case "tool_result":
      return formatToolResultEvent(event);

    case "result":
      return formatResultEvent(event);

    default:
      return null;
  }
}

/**
 * Format a message event for display
 */
function formatMessageEvent(event: GeminiMessageEvent): string | null {
  // Skip user messages
  if (event.role === "user") {
    return null;
  }

  // Assistant messages are displayed as-is (delta content)
  return event.content;
}

/**
 * Format a tool use event for display
 */
function formatToolUseEvent(event: GeminiToolUseEvent): string {
  return `--- Tool: ${event.tool_name} ---\nInput: ${JSON.stringify(event.parameters)}`;
}

/**
 * Format a tool result event for display
 */
function formatToolResultEvent(event: GeminiToolResultEvent): string {
  const cleanOutput = stripSystemReminders(event.output);
  return `--- Tool Result ---\n${cleanOutput}`;
}

/**
 * Format a result event for display
 */
function formatResultEvent(event: GeminiResultEvent): string {
  return `=== Result: ${event.status} ===`;
}

// ============================================================================
// Fixer-specific formatting
// ============================================================================

/**
 * Format a tool use event for fixer context
 */
function formatToolUseForFixer(event: GeminiToolUseEvent): string {
  return `[Tool: ${event.tool_name}]\n> ${JSON.stringify(event.parameters)}`;
}

/**
 * Format a tool result event for fixer context
 */
function formatToolResultForFixer(event: GeminiToolResultEvent): string {
  const cleanOutput = stripSystemReminders(event.output);
  return `[Output]\n${cleanOutput}`;
}

/**
 * Format a result event for fixer context
 */
function formatResultForFixer(event: GeminiResultEvent): string {
  return `\n=== FINAL RESULT ===\nStatus: ${event.status}`;
}

/**
 * Format Gemini's JSONL review output for the fixer prompt
 * Extracts meaningful content, removes noise (init, user messages, metadata)
 * Concatenates assistant message deltas into coherent text
 * Returns null if no meaningful content found
 */
export function formatGeminiReviewForFixer(jsonlOutput: string): string | null {
  if (!jsonlOutput.trim()) {
    return null;
  }

  const lines = jsonlOutput.split("\n");
  const parts: string[] = [];
  let currentAssistantContent = "";

  for (const line of lines) {
    const event = parseGeminiStreamEvent(line);
    if (!event) continue;

    switch (event.type) {
      case "init":
        // Skip init events entirely
        break;

      case "message":
        if (event.role === "assistant" && event.delta) {
          // Accumulate assistant deltas
          currentAssistantContent += event.content;
        }
        // Skip user messages
        break;

      case "tool_use":
        // Flush any accumulated assistant content before tool use
        if (currentAssistantContent) {
          parts.push(currentAssistantContent);
          currentAssistantContent = "";
        }
        parts.push(formatToolUseForFixer(event));
        break;

      case "tool_result":
        parts.push(formatToolResultForFixer(event));
        break;

      case "result":
        // Flush any accumulated assistant content before result
        if (currentAssistantContent) {
          parts.push(currentAssistantContent);
          currentAssistantContent = "";
        }
        parts.push(formatResultForFixer(event));
        break;
    }
  }

  // Flush any remaining assistant content
  if (currentAssistantContent) {
    parts.push(currentAssistantContent);
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join("\n\n");
}

/**
 * Extract the final result text from Gemini's JSONL output
 * Concatenates all assistant message deltas to form the complete response
 * Returns null if no assistant messages found
 */
export function extractGeminiResult(output: string): string | null {
  if (!output.trim()) {
    return null;
  }

  const lines = output.split("\n");
  let concatenatedContent = "";

  for (const line of lines) {
    const event = parseGeminiStreamEvent(line);
    if (!event) continue;

    if (event.type === "message" && event.role === "assistant" && event.delta) {
      concatenatedContent += event.content;
    }
  }

  if (!concatenatedContent) {
    return null;
  }

  return concatenatedContent;
}
