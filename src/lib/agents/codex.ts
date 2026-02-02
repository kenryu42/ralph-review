/**
 * Codex agent configuration and stream handling
 * Integrates with OpenAI's Codex CLI
 */

import type { AgentConfig, AgentRole, ReviewOptions } from "@/lib/types";
import { createLineFormatter, defaultBuildEnv, parseJsonlEvent } from "./core";
import type {
  CodexAgentMessageItem,
  CodexCommandExecutionItem,
  CodexReasoningItem,
  CodexStreamEvent,
} from "./types";

const commonConfig = ["--config", "model_reasoning_effort=high"] as const;

function withModel(args: string[], model?: string): string[] {
  return model ? [...args, "--model", model] : args;
}

export const codexConfig: AgentConfig = {
  command: "codex",
  buildArgs: (
    role: AgentRole,
    prompt: string,
    model?: string,
    reviewOptions?: ReviewOptions
  ): string[] => {
    // Fixer role: exec with full-auto
    if (role !== "reviewer") {
      const args = ["exec", "--full-auto", ...commonConfig];
      return prompt ? withModel([...args, prompt], model) : withModel(args, model);
    }

    // Reviewer role - priority: commitSha > baseBranch > customInstructions > uncommitted
    const baseReviewArgs = ["exec", "--json", ...commonConfig, "review"];

    if (reviewOptions?.commitSha) {
      return withModel([...baseReviewArgs, "--commit", reviewOptions.commitSha], model);
    }

    if (reviewOptions?.baseBranch) {
      return withModel([...baseReviewArgs, "--base", reviewOptions.baseBranch], model);
    }

    // Custom mode: exec with prompt instead of native review subcommand
    if (reviewOptions?.customInstructions) {
      const fullPrompt = prompt ? `review ${prompt}` : "review";
      return withModel(["exec", "--full-auto", "--json", ...commonConfig, fullPrompt], model);
    }

    return withModel([...baseReviewArgs, "--uncommitted"], model);
  },
  buildEnv: defaultBuildEnv,
};

/**
 * Parse a single JSONL line into a CodexStreamEvent.
 * Returns null if the line is invalid or not a recognized event type.
 */
export function parseCodexStreamEvent(line: string): CodexStreamEvent | null {
  return parseJsonlEvent<CodexStreamEvent>(line);
}

/**
 * Extract the shell command from Codex's full command string.
 * Codex wraps commands like: /bin/zsh -lc 'git status'
 * We want to show just: git status
 */
function extractShellCommand(fullCommand: string): string {
  const match = fullCommand.match(/(?:\/bin\/\w+|-lc)\s+'([^']+)'$/);
  if (match?.[1]) {
    return match[1];
  }
  return fullCommand;
}

function formatReasoningForDisplay(item: CodexReasoningItem): string {
  return `[Thinking] ${item.text}`;
}

function formatCommandExecutionForDisplay(item: CodexCommandExecutionItem): string {
  if (item.aggregated_output) {
    return `--- Output ---\n${item.aggregated_output}`;
  }
  return `--- Command: ${extractShellCommand(item.command)} (exit: ${item.exit_code}) ---`;
}

function formatAgentMessageForDisplay(item: CodexAgentMessageItem): string {
  return `=== Result ===\n${item.text}`;
}

function formatItemStartedForDisplay(
  event: Extract<CodexStreamEvent, { type: "item.started" }>
): string | null {
  if (event.item.type === "command_execution") {
    return `--- Command: ${extractShellCommand(event.item.command)} ---`;
  }
  return null;
}

function formatItemCompletedForDisplay(
  event: Extract<CodexStreamEvent, { type: "item.completed" }>
): string | null {
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
 * Format a CodexStreamEvent for terminal display
 * Returns null for events that shouldn't be displayed
 */
export function formatCodexEventForDisplay(event: CodexStreamEvent): string | null {
  switch (event.type) {
    case "thread.started":
    case "turn.started":
    case "turn.completed":
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
 * Extract the final result text from Codex's JSONL output.
 * Finds the last 'agent_message' item and returns its text field.
 */
export function extractCodexResult(output: string): string | null {
  if (!output.trim()) {
    return null;
  }

  const lines = output.split("\n");
  let lastResult: string | null = null;

  for (const line of lines) {
    const event = parseCodexStreamEvent(line);
    if (event?.type === "item.completed" && event.item.type === "agent_message") {
      lastResult = event.item.text;
    }
  }

  return lastResult;
}

/**
 * Formatter for streamAndCapture. Wraps the display formatter.
 */
export const formatCodexLine = createLineFormatter(
  parseCodexStreamEvent,
  formatCodexEventForDisplay
);
