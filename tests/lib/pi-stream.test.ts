import { describe, expect, test } from "bun:test";
import { createPiLineFormatter, extractPiResult, parsePiStreamEvent } from "@/lib/agents/pi";

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
    test("buffers text deltas and flushes combined content at text end", () => {
      const formatPiLine = createPiLineFormatter();

      const textStart = formatPiLine(
        JSON.stringify({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_start",
            contentIndex: 0,
            partial: { role: "assistant", content: [] },
          },
        })
      );
      const firstDelta = formatPiLine(
        JSON.stringify({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_delta",
            contentIndex: 0,
            delta: "/Users",
            partial: { role: "assistant", content: [] },
          },
        })
      );
      const secondDelta = formatPiLine(
        JSON.stringify({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_delta",
            contentIndex: 0,
            delta: "/ken",
            partial: { role: "assistant", content: [] },
          },
        })
      );
      const thirdDelta = formatPiLine(
        JSON.stringify({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_delta",
            contentIndex: 0,
            delta: "ryu",
            partial: { role: "assistant", content: [] },
          },
        })
      );
      const textEnd = formatPiLine(
        JSON.stringify({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_end",
            contentIndex: 0,
            content: "/Users/kenryu",
            partial: { role: "assistant", content: [] },
          },
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

      formatPiLine(
        JSON.stringify({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_start",
            contentIndex: 0,
            partial: { role: "assistant", content: [] },
          },
        })
      );

      const firstChunk = formatPiLine(
        JSON.stringify({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_delta",
            contentIndex: 0,
            delta: "Sentence one. ",
            partial: { role: "assistant", content: [] },
          },
        })
      );
      const secondChunk = formatPiLine(
        JSON.stringify({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_delta",
            contentIndex: 0,
            delta: "Sentence two. ",
            partial: { role: "assistant", content: [] },
          },
        })
      );

      expect(firstChunk).toBe("--- Assistant ---\nSentence one.");
      expect(secondChunk).toBe("Sentence two.");
    });

    test("flushes at paragraph boundary", () => {
      const formatPiLine = createPiLineFormatter();

      formatPiLine(
        JSON.stringify({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_start",
            contentIndex: 0,
            partial: { role: "assistant", content: [] },
          },
        })
      );

      const chunk = formatPiLine(
        JSON.stringify({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_delta",
            contentIndex: 0,
            delta: "Paragraph one.\n\nParagraph two starts here",
            partial: { role: "assistant", content: [] },
          },
        })
      );

      expect(chunk).toBe("--- Assistant ---\nParagraph one.");
    });

    test("shows buffered thinking stream and flushes at thinking end", () => {
      const formatPiLine = createPiLineFormatter();

      const thinkingStart = formatPiLine(
        JSON.stringify({
          type: "message_update",
          assistantMessageEvent: {
            type: "thinking_start",
            contentIndex: 0,
            partial: { role: "assistant", content: [] },
          },
        })
      );
      const thinkingDelta = formatPiLine(
        JSON.stringify({
          type: "message_update",
          assistantMessageEvent: {
            type: "thinking_delta",
            contentIndex: 0,
            delta: "Analyzing the repository",
            partial: { role: "assistant", content: [] },
          },
        })
      );
      const thinkingEnd = formatPiLine(
        JSON.stringify({
          type: "message_update",
          assistantMessageEvent: {
            type: "thinking_end",
            contentIndex: 0,
            content: "Analyzing the repository",
            partial: { role: "assistant", content: [] },
          },
        })
      );

      expect(thinkingStart).toBe("");
      expect(thinkingDelta).toBe("");
      expect(thinkingEnd).toBe("--- Reasoning ---\nAnalyzing the repository");
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
  });
});
