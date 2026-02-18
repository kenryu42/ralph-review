/**
 * Codex agent configuration and stream handling
 */

import {
  type AgentConfig,
  type AgentRole,
  isReasoningLevel,
  type ReviewOptions,
} from "@/lib/types";
import { createLineFormatter, defaultBuildEnv, parseJsonlEvent } from "./core";
import type {
  CodexAgentMessageItem,
  CodexCommandExecutionItem,
  CodexReasoningItem,
  CodexStreamEvent,
} from "./types";

const defaultCodexReasoningEffort = "high";
const codexReasoningOptions = new Set(["low", "medium", "high", "xhigh"]);
const CODEX_SESSION_LOOKBACK_DAYS = 3;

function resolveCodexReasoningEffort(reasoning?: string): string {
  if (isReasoningLevel(reasoning) && codexReasoningOptions.has(reasoning)) {
    return reasoning;
  }
  return defaultCodexReasoningEffort;
}

function withReasoningEffort(args: string[], reasoning?: string): string[] {
  return [...args, "--config", `model_reasoning_effort=${resolveCodexReasoningEffort(reasoning)}`];
}

function withModel(args: string[], model?: string): string[] {
  return model ? [...args, "--model", model] : args;
}

export const codexConfig: AgentConfig = {
  command: "codex",
  buildArgs: (
    role: AgentRole,
    prompt: string,
    model?: string,
    reviewOptions?: ReviewOptions,
    _provider?: string,
    reasoning?: string
  ): string[] => {
    if (role !== "reviewer") {
      const args = withReasoningEffort(["exec", "--full-auto"], reasoning);
      return prompt ? withModel([...args, prompt], model) : withModel(args, model);
    }

    const baseReviewArgs = withReasoningEffort(["exec", "--json"], reasoning);

    if (reviewOptions?.commitSha) {
      return withModel([...baseReviewArgs, "review", "--commit", reviewOptions.commitSha], model);
    }

    if (reviewOptions?.baseBranch) {
      return withModel([...baseReviewArgs, "review", "--base", reviewOptions.baseBranch], model);
    }

    if (reviewOptions?.customInstructions) {
      const fullPrompt = prompt ? `review ${prompt}` : "review";
      const customArgs = withReasoningEffort(["exec", "--full-auto", "--json"], reasoning);
      return withModel([...customArgs, fullPrompt], model);
    }

    return withModel([...baseReviewArgs, "review", "--uncommitted"], model);
  },
  buildEnv: defaultBuildEnv,
};

export function parseCodexStreamEvent(line: string): CodexStreamEvent | null {
  return parseJsonlEvent<CodexStreamEvent>(line);
}

function padDatePart(value: number): string {
  return value.toString().padStart(2, "0");
}

function buildSessionDayPath(sessionsRoot: string, date: Date): string {
  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());
  return `${sessionsRoot}/${year}/${month}/${day}`;
}

function findSessionFileForThread(threadId: string, sessionsRoot: string): string | null {
  const now = new Date();

  for (let dayOffset = 0; dayOffset < CODEX_SESSION_LOOKBACK_DAYS; dayOffset += 1) {
    const date = new Date(now);
    date.setDate(now.getDate() - dayOffset);
    const dayPath = buildSessionDayPath(sessionsRoot, date);

    try {
      const glob = new Bun.Glob(`*-${threadId}.jsonl`);
      const matches = Array.from(glob.scanSync({ cwd: dayPath })).sort((left, right) =>
        left.localeCompare(right)
      );
      const latestMatch = matches.at(-1);
      if (latestMatch) {
        return `${dayPath}/${latestMatch}`;
      }
    } catch {
      // Ignore missing date directories and continue searching.
    }
  }

  return null;
}

type ExitedReviewModeMatch = { reviewOutput: string | null };

function matchExitedReviewMode(line: string): ExitedReviewModeMatch | null {
  const event = parseJsonlEvent<Record<string, unknown>>(line);
  if (!event || event.type !== "event_msg") {
    return null;
  }

  const payload = event.payload;
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const payloadRecord = payload as Record<string, unknown>;
  if (payloadRecord.type !== "exited_review_mode") {
    return null;
  }

  const reviewOutput = payloadRecord.review_output;
  if (typeof reviewOutput === "string") {
    return { reviewOutput: reviewOutput.trim() || null };
  }

  if (typeof reviewOutput === "object" && reviewOutput !== null) {
    return { reviewOutput: JSON.stringify(reviewOutput) };
  }

  return { reviewOutput: null };
}

async function readExitedReviewModeOutput(sessionPath: string): Promise<string | null> {
  try {
    const text = await Bun.file(sessionPath).text();
    const lines = text.split("\n");

    for (let idx = lines.length - 1; idx >= 0; idx -= 1) {
      const line = lines[idx];
      if (!line?.trim()) {
        continue;
      }

      const match = matchExitedReviewMode(line);
      if (match) {
        return match.reviewOutput;
      }
    }
  } catch {
    // Fallback to stream output if session file is unavailable.
  }

  return null;
}

async function extractCodexSessionResult(threadId: string): Promise<string | null> {
  const homeDir = process.env.HOME;
  if (!homeDir) {
    return null;
  }

  const sessionsRoot = `${homeDir}/.codex/sessions`;
  const sessionPath = findSessionFileForThread(threadId, sessionsRoot);
  if (!sessionPath) {
    return null;
  }

  return readExitedReviewModeOutput(sessionPath);
}

function extractShellCommand(fullCommand: string): string {
  const match = fullCommand.match(/(?:\/bin\/\w+|-lc)\s+'([^']+)'$/);
  if (match?.[1]) {
    return match[1];
  }
  return fullCommand;
}

function formatReasoningForDisplay(item: CodexReasoningItem): string {
  return `[Reasoning] ${item.text}`;
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

export async function extractCodexResult(output: string): Promise<string | null> {
  if (!output.trim()) {
    return null;
  }

  const lines = output.split("\n");
  let lastResult: string | null = null;
  let threadId: string | null = null;
  let sawTurnCompleted = false;

  for (const line of lines) {
    const event = parseCodexStreamEvent(line);
    if (event?.type === "thread.started" && !threadId) {
      threadId = event.thread_id;
      continue;
    }

    if (event?.type === "turn.completed") {
      sawTurnCompleted = true;
      continue;
    }

    if (event?.type === "item.completed" && event.item.type === "agent_message") {
      lastResult = event.item.text;
    }
  }

  if (threadId && sawTurnCompleted) {
    const sessionResult = await extractCodexSessionResult(threadId);
    if (sessionResult) {
      return sessionResult;
    }
  }

  return lastResult;
}

export const formatCodexLine = createLineFormatter(
  parseCodexStreamEvent,
  formatCodexEventForDisplay
);
