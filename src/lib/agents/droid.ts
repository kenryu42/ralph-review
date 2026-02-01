/**
 * Droid agent configuration and stream handling
 * Integrates with Droid CLI
 */

import type { AgentConfig, AgentRole, ReviewOptions } from "@/lib/types";
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
    _reviewOptions?: ReviewOptions
  ): string[] => {
    const effectiveModel = model ?? "gpt-5.2-codex";

    return [
      "exec",
      "--auto",
      "medium",
      "--model",
      effectiveModel,
      "--reasoning-effort",
      "high",
      "--output-format",
      "stream-json",
      prompt,
    ];
  },
  buildEnv: (): Record<string, string> => {
    return {
      ...(process.env as Record<string, string>),
    };
  },
};

/**
 * Parse a single JSONL line into a DroidStreamEvent.
 * Returns null if the line is invalid or not a recognized event type.
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

    return parsed as DroidStreamEvent;
  } catch {
    return null;
  }
}

/**
 * Strip <system-reminder> tags and their content from text.
 */
function stripSystemReminders(text: unknown): string {
  const normalized = typeof text === "string" ? text : String(text ?? "");
  return normalized
    .replace(/\u003csystem-reminder\u003e[\s\S]*?\u003c\/system-reminder\u003e\s*/g, "")
    .trim();
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

/**
 * Format a DroidStreamEvent for terminal display
 * Returns null for events that shouldn't be displayed (system init, user messages)
 */
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

/**
 * Extract the final result text from Droid's JSONL output.
 * Finds the last 'completion' event and returns its finalText field.
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

/**
 * Formatter for streamAndCapture. Wraps the display formatter.
 */
export function formatDroidLine(line: string): string | null {
  const event = parseDroidStreamEvent(line);
  if (event) {
    return formatDroidEventForDisplay(event) ?? "";
  }
  return null;
}
