import { describe, expect, test } from "bun:test";
import { createPiLineFormatter, extractPiResult, parsePiStreamEvent } from "@/lib/agents/pi";

function piAssistantUpdate(type: string, event: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "message_update",
    assistantMessageEvent: {
      type,
      contentIndex: 0,
      partial: { role: "assistant", content: [] },
      ...event,
    },
  });
}

describe("pi-stream", () => {
  describe("parsePiStreamEvent", () => {
    test("parses session event", () => {
      const line = JSON.stringify({
        type: "session",
        version: 3,
        id: "session-123",
        timestamp: "2026-02-06T06:32:11.339Z",
        cwd: "/tmp/project",
      });

      const event = parsePiStreamEvent(line);

      expect(event).not.toBeNull();
      expect(event?.type).toBe("session");
      if (event?.type === "session") {
        expect(event.id).toBe("session-123");
        expect(event.version).toBe(3);
      }
    });

    test("parses message_update text delta event", () => {
      const line = JSON.stringify({
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          contentIndex: 1,
          delta: "Hello world",
          partial: {
            role: "assistant",
            content: [{ type: "text", text: "Hello world" }],
          },
        },
      });

      const event = parsePiStreamEvent(line);

      expect(event).not.toBeNull();
      expect(event?.type).toBe("message_update");
      if (event?.type === "message_update") {
        expect(event.assistantMessageEvent.type).toBe("text_delta");
      }
    });

    test("parses message_end assistant event", () => {
      const line = JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          provider: "llm-proxy",
          model: "gemini_cli/gemini-3-flash-preview",
          content: [{ type: "text", text: '{"ok":true}' }],
        },
      });

      const event = parsePiStreamEvent(line);

      expect(event).not.toBeNull();
      expect(event?.type).toBe("message_end");
      if (event?.type === "message_end") {
        expect(event.message.role).toBe("assistant");
      }
    });

    test("returns null for invalid JSON", () => {
      const event = parsePiStreamEvent("{invalid json");
      expect(event).toBeNull();
    });

    test("returns null for empty string", () => {
      const event = parsePiStreamEvent("");
      expect(event).toBeNull();
    });

    test("returns null for object without type field", () => {
      const event = parsePiStreamEvent('{"foo":"bar"}');
      expect(event).toBeNull();
    });
  });

  describe("formatPiLine", () => {
    test("returns null for non-JSON log lines", () => {
      const formatPiLine = createPiLineFormatter();
      expect(formatPiLine("PI mode enabled")).toBeNull();
    });

    test("buffers text deltas and flushes combined content at text end", () => {
      const formatPiLine = createPiLineFormatter();

      const textStart = formatPiLine(piAssistantUpdate("text_start"));
      const firstDelta = formatPiLine(
        piAssistantUpdate("text_delta", {
          delta: "/Users",
        })
      );
      const secondDelta = formatPiLine(
        piAssistantUpdate("text_delta", {
          delta: "/ken",
        })
      );
      const thirdDelta = formatPiLine(
        piAssistantUpdate("text_delta", {
          delta: "ryu",
        })
      );
      const textEnd = formatPiLine(
        piAssistantUpdate("text_end", {
          content: "/Users/kenryu",
        })
      );

      expect(textStart).toBe("");
      expect(firstDelta).toBe("");
      expect(secondDelta).toBe("");
      expect(thirdDelta).toBe("");
      expect(textEnd).toBe("--- Assistant ---\n/Users/kenryu");
    });

    test("flushes at sentence boundary while still streaming", () => {
      const formatPiLine = createPiLineFormatter();

      formatPiLine(piAssistantUpdate("text_start"));

      const firstChunk = formatPiLine(
        piAssistantUpdate("text_delta", {
          delta: "Sentence one. ",
        })
      );
      const secondChunk = formatPiLine(
        piAssistantUpdate("text_delta", {
          delta: "Sentence two. ",
        })
      );

      expect(firstChunk).toBe("--- Assistant ---\nSentence one.");
      expect(secondChunk).toBe("Sentence two.");
    });

    test("flushes at paragraph boundary", () => {
      const formatPiLine = createPiLineFormatter();

      formatPiLine(piAssistantUpdate("text_start"));

      const chunk = formatPiLine(
        piAssistantUpdate("text_delta", {
          delta: "Paragraph one.\n\nParagraph two starts here",
        })
      );

      expect(chunk).toBe("--- Assistant ---\nParagraph one.");
    });

    test("falls back to thinking_end content when no reasoning delta arrived", () => {
      const formatPiLine = createPiLineFormatter();

      formatPiLine(piAssistantUpdate("thinking_start"));

      const thinkingEnd = formatPiLine(
        piAssistantUpdate("thinking_end", {
          content: "Reasoning from fallback content",
        })
      );

      expect(thinkingEnd).toBe("--- Reasoning ---\nReasoning from fallback content");
    });

    test("shows buffered thinking stream and flushes at thinking end", () => {
      const formatPiLine = createPiLineFormatter();

      const thinkingStart = formatPiLine(piAssistantUpdate("thinking_start"));
      const thinkingDelta = formatPiLine(
        piAssistantUpdate("thinking_delta", {
          delta: "Analyzing the repository",
        })
      );
      const thinkingEnd = formatPiLine(
        piAssistantUpdate("thinking_end", {
          content: "Analyzing the repository",
        })
      );

      expect(thinkingStart).toBe("");
      expect(thinkingDelta).toBe("");
      expect(thinkingEnd).toBe("--- Reasoning ---\nAnalyzing the repository");
    });

    test("falls back to text_end content when no text delta arrived", () => {
      const formatPiLine = createPiLineFormatter();

      formatPiLine(piAssistantUpdate("text_start"));

      const textEnd = formatPiLine(
        piAssistantUpdate("text_end", {
          content: "Assistant from fallback content",
        })
      );

      expect(textEnd).toBe("--- Assistant ---\nAssistant from fallback content");
    });

    test("does not emit whitespace-only chunks at text end", () => {
      const formatPiLine = createPiLineFormatter();

      formatPiLine(piAssistantUpdate("text_start"));

      const textEnd = formatPiLine(
        piAssistantUpdate("text_end", {
          content: "\n\n\n",
        })
      );

      expect(textEnd).toBe("");
    });

    test("splits long chunks at max length when no boundaries exist", () => {
      const formatPiLine = createPiLineFormatter();
      const longToken = "a".repeat(161);

      formatPiLine(piAssistantUpdate("text_start"));

      const chunk = formatPiLine(
        piAssistantUpdate("text_delta", {
          delta: longToken,
        })
      );
      const textEnd = formatPiLine(
        piAssistantUpdate("text_end", {
          content: longToken,
        })
      );

      expect(chunk).toBe(`--- Assistant ---\n${"a".repeat(160)}`);
      expect(textEnd).toBe("a");
    });

    test("handles message_update events with missing assistant payload", () => {
      const formatPiLine = createPiLineFormatter();
      const output = formatPiLine(
        JSON.stringify({
          type: "message_update",
        })
      );
      expect(output).toBe("");
    });

    test("ignores unknown assistant update event types", () => {
      const formatPiLine = createPiLineFormatter();
      const output = formatPiLine(
        JSON.stringify({
          type: "message_update",
          assistantMessageEvent: {
            type: "unknown",
          },
        })
      );
      expect(output).toBe("");
    });

    test("flushes both reasoning and assistant buffers on turn_end", () => {
      const formatPiLine = createPiLineFormatter();

      formatPiLine(piAssistantUpdate("thinking_start"));
      formatPiLine(
        piAssistantUpdate("thinking_delta", {
          delta: "Analyzing options",
        })
      );
      formatPiLine(piAssistantUpdate("text_start"));
      formatPiLine(
        piAssistantUpdate("text_delta", {
          delta: "Final answer pending",
        })
      );

      const turnEnd = formatPiLine(
        JSON.stringify({
          type: "turn_end",
          message: {
            role: "assistant",
            content: [],
          },
        })
      );

      expect(turnEnd).toBe(
        "--- Reasoning ---\nAnalyzing options\n--- Assistant ---\nFinal answer pending"
      );
    });

    test("uses turn_end assistant message as fallback when no buffered output exists", () => {
      const formatPiLine = createPiLineFormatter();

      const turnEnd = formatPiLine(
        JSON.stringify({
          type: "turn_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Fallback assistant text" }],
          },
        })
      );

      expect(turnEnd).toBe("--- Assistant ---\nFallback assistant text");
    });

    test("does not duplicate assistant fallback after streaming already emitted content", () => {
      const formatPiLine = createPiLineFormatter();

      const firstChunk = formatPiLine(
        piAssistantUpdate("text_delta", {
          delta: "Already emitted. ",
        })
      );
      const turnEnd = formatPiLine(
        JSON.stringify({
          type: "turn_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Already emitted." }],
          },
        })
      );

      expect(firstChunk).toBe("--- Assistant ---\nAlready emitted.");
      expect(turnEnd).toBe("");
    });

    test("returns empty output for turn_end events without assistant text", () => {
      const formatPiLine = createPiLineFormatter();

      const turnEnd = formatPiLine(
        JSON.stringify({
          type: "turn_end",
          message: {
            role: "assistant",
            content: [],
          },
        })
      );

      expect(turnEnd).toBe("");
    });

    test("suppresses boilerplate events", () => {
      const formatPiLine = createPiLineFormatter();

      const events = [
        JSON.stringify({ type: "session", version: 3, id: "abc", timestamp: "t", cwd: "/tmp" }),
        JSON.stringify({ type: "agent_start" }),
        JSON.stringify({ type: "turn_start" }),
        JSON.stringify({
          type: "message_start",
          message: { role: "assistant", content: [] },
        }),
        JSON.stringify({
          type: "message_end",
          message: { role: "assistant", content: [] },
        }),
        JSON.stringify({
          type: "agent_end",
          messages: [],
        }),
      ];

      const outputs = events.map((line) => formatPiLine(line));
      expect(outputs).toEqual(["", "", "", "", "", ""]);
    });
  });

  describe("extractPiResult", () => {
    test("extracts final assistant text from message_end", () => {
      const jsonl = [
        JSON.stringify({ type: "session", version: 3, id: "abc", timestamp: "t", cwd: "/tmp" }),
        JSON.stringify({ type: "agent_start" }),
        JSON.stringify({
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "First answer" }],
          },
        }),
      ].join("\n");

      const result = extractPiResult(jsonl);

      expect(result).toBe("First answer");
    });

    test("prefers latest assistant text across multiple terminal events", () => {
      const jsonl = [
        JSON.stringify({
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Earlier answer" }],
          },
        }),
        JSON.stringify({
          type: "turn_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Final answer" }],
          },
        }),
      ].join("\n");

      const result = extractPiResult(jsonl);

      expect(result).toBe("Final answer");
    });

    test("returns null for empty output", () => {
      const result = extractPiResult("");
      expect(result).toBeNull();
    });

    test("handles malformed lines gracefully", () => {
      const jsonl = [
        "{invalid json}",
        JSON.stringify({
          type: "agent_end",
          messages: [
            { role: "user", content: [{ type: "text", text: "question" }] },
            { role: "assistant", content: [{ type: "text", text: "Recovered answer" }] },
          ],
        }),
      ].join("\n");

      const result = extractPiResult(jsonl);

      expect(result).toBe("Recovered answer");
    });

    test("returns null when terminal events contain no assistant text", () => {
      const jsonl = [
        JSON.stringify({
          type: "message_end",
          message: {
            role: "user",
            content: [{ type: "text", text: "question" }],
          },
        }),
        JSON.stringify({
          type: "turn_end",
          message: {
            role: "assistant",
          },
        }),
        JSON.stringify({
          type: "agent_end",
          messages: [],
        }),
      ].join("\n");

      const result = extractPiResult(jsonl);

      expect(result).toBeNull();
    });

    test("returns null when agent_end has no assistant text blocks", () => {
      const jsonl = JSON.stringify({
        type: "agent_end",
        messages: [
          {
            role: "assistant",
            content: [{ type: "thinking", thinking: "silent reasoning" }],
          },
        ],
      });

      const result = extractPiResult(jsonl);

      expect(result).toBeNull();
    });
  });
});
