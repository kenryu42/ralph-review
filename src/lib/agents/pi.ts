/**
 * Pi agent configuration and stream handling
 */

import {
  type AgentConfig,
  type AgentRole,
  isReasoningLevel,
  type ReviewOptions,
} from "@/lib/types";
import { defaultBuildEnv, parseJsonlEvent } from "./core";
import type { PiContentBlock, PiMessage, PiStreamEvent } from "./types";

export const piConfig: AgentConfig = {
  command: "pi",
  buildArgs: (
    _role: AgentRole,
    prompt: string,
    model?: string,
    _reviewOptions?: ReviewOptions,
    provider?: string,
    reasoning?: string
  ): string[] => {
    if (!provider || !model) {
      throw new Error("Pi agent requires both provider and model");
    }

    const args = ["--provider", provider, "--model", model];

    if (isReasoningLevel(reasoning) && reasoning !== "max") {
      args.push("--thinking", reasoning);
    }

    args.push("--mode", "json", "-p", prompt);

    return args;
  },
  buildEnv: defaultBuildEnv,
};

export function parsePiStreamEvent(line: string): PiStreamEvent | null {
  return parseJsonlEvent<PiStreamEvent>(line, true);
}

const MAX_PI_CHUNK_LENGTH = 160;

interface PiFormatterState {
  reasoningBuffer: string;
  assistantBuffer: string;
  emittedReasoningHeader: boolean;
  emittedAssistantHeader: boolean;
}

function createInitialState(): PiFormatterState {
  return {
    reasoningBuffer: "",
    assistantBuffer: "",
    emittedReasoningHeader: false,
    emittedAssistantHeader: false,
  };
}

function extractTextBlocks(message: PiMessage | undefined): string {
  if (!message?.content?.length) {
    return "";
  }

  return message.content
    .filter((block): block is Extract<PiContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function extractAssistantText(message: PiMessage | undefined): string {
  if (!message || message.role !== "assistant") {
    return "";
  }
  return extractTextBlocks(message);
}

function findSentenceBoundary(buffer: string): number {
  const boundaryRegex = /[.!?](?:["')\]]+)?(?:\s|$)/g;
  let lastBoundary = -1;
  let match = boundaryRegex.exec(buffer);

  while (match) {
    lastBoundary = match.index + match[0].length;
    match = boundaryRegex.exec(buffer);
  }

  return lastBoundary;
}

function findSafeSplitIndex(buffer: string): number {
  const paragraphBoundary = buffer.lastIndexOf("\n\n");
  if (paragraphBoundary >= 0) {
    return paragraphBoundary + 2;
  }

  const sentenceBoundary = findSentenceBoundary(buffer);
  if (sentenceBoundary > 0) {
    return sentenceBoundary;
  }

  if (buffer.length >= MAX_PI_CHUNK_LENGTH) {
    const splitAtWhitespace = buffer.lastIndexOf(" ", MAX_PI_CHUNK_LENGTH);
    if (splitAtWhitespace > 0) {
      return splitAtWhitespace + 1;
    }
    return MAX_PI_CHUNK_LENGTH;
  }

  return 0;
}

function normalizeChunk(chunk: string): string {
  return chunk.replace(/\n{3,}/g, "\n\n").trimEnd();
}

function flushBufferedContent(
  state: PiFormatterState,
  kind: "thinking" | "assistant",
  force: boolean = false
): string | null {
  const bufferKey = kind === "thinking" ? "reasoningBuffer" : "assistantBuffer";
  const emittedHeaderKey =
    kind === "thinking" ? "emittedReasoningHeader" : "emittedAssistantHeader";
  const header = kind === "thinking" ? "--- Reasoning ---" : "--- Assistant ---";
  const current = state[bufferKey];

  if (!current) {
    return null;
  }

  const flushIndex = force ? current.length : findSafeSplitIndex(current);
  if (flushIndex <= 0) {
    return null;
  }

  const chunk = normalizeChunk(current.slice(0, flushIndex));
  state[bufferKey] = current.slice(flushIndex);

  if (!chunk.trim()) {
    return null;
  }

  if (!state[emittedHeaderKey]) {
    state[emittedHeaderKey] = true;
    return `${header}\n${chunk}`;
  }

  return chunk;
}

function formatMessageUpdateEvent(
  event: Extract<PiStreamEvent, { type: "message_update" }>,
  state: PiFormatterState
): string | null {
  const update = event.assistantMessageEvent;
  if (!update) {
    return null;
  }

  switch (update.type) {
    case "thinking_start":
      state.reasoningBuffer = "";
      state.emittedReasoningHeader = false;
      return null;

    case "thinking_delta":
      state.reasoningBuffer += update.delta;
      return flushBufferedContent(state, "thinking");

    case "thinking_end":
      // Only use fallback content if nothing was emitted during streaming
      if (!state.reasoningBuffer && !state.emittedReasoningHeader && update.content) {
        state.reasoningBuffer = update.content;
      }
      return flushBufferedContent(state, "thinking", true);

    case "text_start":
      state.assistantBuffer = "";
      state.emittedAssistantHeader = false;
      return null;

    case "text_delta":
      state.assistantBuffer += update.delta;
      return flushBufferedContent(state, "assistant");

    case "text_end":
      // Only use fallback content if nothing was emitted during streaming
      if (!state.assistantBuffer && !state.emittedAssistantHeader && update.content) {
        state.assistantBuffer = update.content;
      }
      return flushBufferedContent(state, "assistant", true);

    default:
      return null;
  }
}

function formatTurnEndEvent(
  event: Extract<PiStreamEvent, { type: "turn_end" }>,
  state: PiFormatterState
): string | null {
  const outputs: string[] = [];
  const reasoningOutput = flushBufferedContent(state, "thinking", true);
  if (reasoningOutput) {
    outputs.push(reasoningOutput);
  }

  const assistantOutput = flushBufferedContent(state, "assistant", true);
  if (assistantOutput) {
    outputs.push(assistantOutput);
  }

  if (outputs.length > 0) {
    return outputs.join("\n");
  }

  const fallbackText = extractAssistantText(event.message);
  if (!fallbackText.trim()) {
    return null;
  }

  if (!state.emittedAssistantHeader) {
    state.emittedAssistantHeader = true;
    return `--- Assistant ---\n${fallbackText}`;
  }

  // Content was already emitted during streaming, don't duplicate
  return null;
}

function formatPiEventForDisplay(event: PiStreamEvent, state: PiFormatterState): string | null {
  switch (event.type) {
    case "session":
    case "agent_start":
    case "message_start":
    case "message_end":
    case "agent_end":
      return null;

    case "turn_start":
      state.reasoningBuffer = "";
      state.assistantBuffer = "";
      state.emittedReasoningHeader = false;
      state.emittedAssistantHeader = false;
      return null;

    case "message_update":
      return formatMessageUpdateEvent(event, state);

    case "turn_end":
      return formatTurnEndEvent(event, state);

    default:
      return null;
  }
}

export function createPiLineFormatter(): (line: string) => string | null {
  const state = createInitialState();

  return (line: string): string | null => {
    const event = parsePiStreamEvent(line);
    if (!event) {
      return null;
    }
    return formatPiEventForDisplay(event, state) ?? "";
  };
}

function lastAssistantText(messages: PiMessage[] | undefined): string {
  if (!messages?.length) {
    return "";
  }

  for (const message of [...messages].reverse()) {
    const text = extractAssistantText(message);
    if (text) {
      return text;
    }
  }

  return "";
}

export function extractPiResult(output: string): string | null {
  if (!output.trim()) {
    return null;
  }

  const lines = output.split("\n");
  let lastResult = "";

  for (const line of lines) {
    const event = parsePiStreamEvent(line);
    if (!event) {
      continue;
    }

    if (event.type === "message_end") {
      const text = extractAssistantText(event.message);
      if (text) {
        lastResult = text;
      }
    } else if (event.type === "turn_end") {
      const text = extractAssistantText(event.message);
      if (text) {
        lastResult = text;
      }
    } else if (event.type === "agent_end") {
      const text = lastAssistantText(event.messages);
      if (text) {
        lastResult = text;
      }
    }
  }

  return lastResult || null;
}

export const formatPiLine = createPiLineFormatter();
