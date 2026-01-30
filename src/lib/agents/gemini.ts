/**
 * Gemini agent configuration and stream handling
 * Integrates with Gemini CLI
 */

import type { AgentConfig, AgentRole } from "@/lib/types";
import type {
  GeminiMessageEvent,
  GeminiResultEvent,
  GeminiStreamEvent,
  GeminiToolResultEvent,
  GeminiToolUseEvent,
} from "./types";

export const geminiConfig: AgentConfig = {
  command: "gemini",
  buildArgs: (role: AgentRole, prompt: string, model?: string): string[] => {
    const args = ["--yolo"];
    if (model) {
      args.push("--model", model);
    }
    args.push("--output-format", "stream-json");
    if (role === "reviewer") {
      // Use custom prompt if provided, otherwise default to reviewing uncommitted changes
      args.push("--prompt", prompt || "review the uncommitted changes");
    } else {
      args.push("--prompt", prompt);
    }
    return args;
  },
  buildEnv: (): Record<string, string> => {
    return {
      ...(process.env as Record<string, string>),
    };
  },
};

/**
 * Parse a single JSONL line into a GeminiStreamEvent.
 * Returns null if the line is invalid or not a recognized event type.
 */
export function parseGeminiStreamEvent(line: string): GeminiStreamEvent | null {
  if (!line.trim()) {
    return null;
  }

  if (!line.startsWith("{")) {
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

    return parsed as GeminiStreamEvent;
  } catch {
    return null;
  }
}

/**
 * Strip <system-reminder> tags and their content from text.
 */
function stripSystemReminders(text: string): string {
  return text
    .replace(/\u003csystem-reminder\u003e[\s\S]*?\u003c\/system-reminder\u003e\s*/g, "")
    .trim();
}

function formatMessageEvent(event: GeminiMessageEvent): string | null {
  if (event.role === "user") {
    return null;
  }

  return event.content;
}

function formatToolUseEvent(event: GeminiToolUseEvent): string {
  return `--- Tool: ${event.tool_name} ---\nInput: ${JSON.stringify(event.parameters)}`;
}

function formatToolResultEvent(event: GeminiToolResultEvent): string {
  const cleanOutput = stripSystemReminders(event.output);
  if (!cleanOutput) {
    return "";
  }
  return `--- Tool Result ---\n${cleanOutput}`;
}

function formatResultEvent(event: GeminiResultEvent): string {
  return `=== Result: ${event.status} ===`;
}

/**
 * Format a GeminiStreamEvent for terminal display
 * Returns null for events that shouldn't be displayed (init, user messages)
 */
export function formatGeminiEventForDisplay(event: GeminiStreamEvent): string | null {
  switch (event.type) {
    case "init":
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
 * Extract the final result text from Gemini's JSONL output.
 * Concatenates all assistant message deltas to form the complete response.
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

/**
 * Formatter for streamAndCapture. Wraps the display formatter.
 */
export function formatGeminiLine(line: string): string | null {
  const event = parseGeminiStreamEvent(line);
  if (event) {
    return formatGeminiEventForDisplay(event) ?? "";
  }
  return null;
}
