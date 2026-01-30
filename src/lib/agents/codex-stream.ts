/**
 * Codex streaming JSONL parser and formatter
 * Handles parsing Codex CLI's --output-format stream-json output
 */

import type {
  CodexAgentMessageItem,
  CodexCommandExecutionItem,
  CodexItemCompletedEvent,
  CodexItemStartedEvent,
  CodexReasoningItem,
  CodexStreamEvent,
} from "./types";

/**
 * Parse a single JSONL line into a CodexStreamEvent
 * Returns null if the line is invalid or not a recognized event type
 */
export function parseCodexStreamEvent(line: string): CodexStreamEvent | null {
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
    return parsed as CodexStreamEvent;
  } catch {
    return null;
  }
}

/**
 * Extract the shell command from Codex's full command string
 * Codex wraps commands like: /bin/zsh -lc 'git status'
 * We want to show just: git status
 */
function extractShellCommand(fullCommand: string): string {
  // Match the content inside single quotes after shell invocation
  const match = fullCommand.match(/(?:\/bin\/\w+|-lc)\s+'([^']+)'$/);
  if (match?.[1]) {
    return match[1];
  }
  // Fallback: return the full command if pattern doesn't match
  return fullCommand;
}

/**
 * Format a CodexStreamEvent for terminal display
 * Returns null for events that shouldn't be displayed
 */
export function formatCodexEventForDisplay(event: CodexStreamEvent): string | null {
  switch (event.type) {
    case "thread.started":
    case "turn.started":
    case "turn.completed":
      // Don't display these control events
      return null;

    case "item.started":
      return formatItemStartedForDisplay(event);

    case "item.completed":
      return formatItemCompletedForDisplay(event);

    default:
      return null;
  }
}

/**
 * Format an item.started event for display
 */
function formatItemStartedForDisplay(event: CodexItemStartedEvent): string | null {
  const item = event.item;

  switch (item.type) {
    case "reasoning":
      // Don't show reasoning until completed
      return null;

    case "command_execution":
      // Show the command being executed
      return `--- Command: ${extractShellCommand(item.command)} ---`;

    case "agent_message":
      // Don't show until completed
      return null;

    default:
      return null;
  }
}

/**
 * Format an item.completed event for display
 */
function formatItemCompletedForDisplay(event: CodexItemCompletedEvent): string | null {
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

/**
 * Format a reasoning item for display
 */
function formatReasoningForDisplay(item: CodexReasoningItem): string {
  return `[Thinking] ${item.text}`;
}

/**
 * Format a command execution item for display
 */
function formatCommandExecutionForDisplay(item: CodexCommandExecutionItem): string {
  if (item.aggregated_output) {
    return `--- Output ---\n${item.aggregated_output}`;
  }
  return `--- Command: ${extractShellCommand(item.command)} (exit: ${item.exit_code}) ---`;
}

/**
 * Format an agent message item for display
 */
function formatAgentMessageForDisplay(item: CodexAgentMessageItem): string {
  return `=== Result ===\n${item.text}`;
}

/**
 * Extract the final result text from Codex's JSONL output
 * Finds the last 'agent_message' item and returns its text field
 */
export function extractCodexResult(output: string): string | null {
  if (!output.trim()) {
    return null;
  }

  const lines = output.split("\n");
  let lastResult: string | null = null;

  for (const line of lines) {
    const event = parseCodexStreamEvent(line);
    if (event?.type === "item.completed") {
      const item = (event as CodexItemCompletedEvent).item;
      if (item.type === "agent_message") {
        lastResult = (item as CodexAgentMessageItem).text;
      }
    }
  }

  return lastResult;
}
