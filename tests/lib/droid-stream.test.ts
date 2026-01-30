import { describe, expect, test } from "bun:test";
import {
  extractDroidResult,
  formatDroidEventForDisplay,
  parseDroidStreamEvent,
} from "@/lib/agents/droid-stream";

describe("droid-stream", () => {
  describe("parseDroidStreamEvent", () => {
    test("parses system init event", () => {
      const line = JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "abc-123",
        model: "gpt-5.2-codex",
        cwd: "/home/user/project",
        tools: ["Read", "Execute"],
        reasoning_effort: "high",
      });

      const event = parseDroidStreamEvent(line);

      expect(event).not.toBeNull();
      expect(event?.type).toBe("system");
      if (event?.type === "system") {
        expect(event.subtype).toBe("init");
        expect(event.model).toBe("gpt-5.2-codex");
      }
    });

    test("parses user message event", () => {
      const line = JSON.stringify({
        type: "message",
        role: "user",
        id: "msg-001",
        text: "/review current changes",
        timestamp: 1234567890,
        session_id: "abc-123",
      });

      const event = parseDroidStreamEvent(line);

      expect(event).not.toBeNull();
      expect(event?.type).toBe("message");
      if (event?.type === "message") {
        expect(event.role).toBe("user");
        expect(event.text).toBe("/review current changes");
      }
    });

    test("parses assistant message event", () => {
      const line = JSON.stringify({
        type: "message",
        role: "assistant",
        id: "msg-002",
        text: "# Review Summary\n\nNo issues found.",
        timestamp: 1234567890,
        session_id: "abc-123",
      });

      const event = parseDroidStreamEvent(line);

      expect(event).not.toBeNull();
      if (event?.type === "message") {
        expect(event.role).toBe("assistant");
        expect(event.text).toContain("Review Summary");
      }
    });

    test("parses tool_call event", () => {
      const line = JSON.stringify({
        type: "tool_call",
        id: "call-001",
        messageId: "msg-001",
        toolId: "Read",
        toolName: "Read",
        parameters: { file_path: "/home/user/project/README.md" },
        timestamp: 1234567890,
        session_id: "abc-123",
      });

      const event = parseDroidStreamEvent(line);

      expect(event).not.toBeNull();
      expect(event?.type).toBe("tool_call");
      if (event?.type === "tool_call") {
        expect(event.toolName).toBe("Read");
        expect(event.parameters).toEqual({ file_path: "/home/user/project/README.md" });
      }
    });

    test("parses tool_result event", () => {
      const line = JSON.stringify({
        type: "tool_result",
        id: "call-001",
        messageId: "msg-002",
        toolId: "Read",
        isError: false,
        value: "# README\n\nProject documentation",
        session_id: "abc-123",
      });

      const event = parseDroidStreamEvent(line);

      expect(event).not.toBeNull();
      expect(event?.type).toBe("tool_result");
      if (event?.type === "tool_result") {
        expect(event.toolId).toBe("Read");
        expect(event.value).toContain("README");
        expect(event.isError).toBe(false);
      }
    });

    test("parses completion event", () => {
      const line = JSON.stringify({
        type: "completion",
        finalText: "# Review Summary\n\nNo issues found.",
        numTurns: 5,
        durationMs: 10000,
        session_id: "abc-123",
        timestamp: 1234567890,
      });

      const event = parseDroidStreamEvent(line);

      expect(event).not.toBeNull();
      expect(event?.type).toBe("completion");
      if (event?.type === "completion") {
        expect(event.finalText).toContain("Review Summary");
        expect(event.numTurns).toBe(5);
      }
    });

    test("returns null for invalid JSON", () => {
      const event = parseDroidStreamEvent("{invalid json");
      expect(event).toBeNull();
    });

    test("returns null for empty string", () => {
      const event = parseDroidStreamEvent("");
      expect(event).toBeNull();
    });

    test("returns null for non-object JSON", () => {
      const event = parseDroidStreamEvent('"just a string"');
      expect(event).toBeNull();
    });

    test("returns null for object without type field", () => {
      const event = parseDroidStreamEvent('{"foo": "bar"}');
      expect(event).toBeNull();
    });
  });

  describe("formatDroidEventForDisplay", () => {
    test("formats tool_call event", () => {
      const event = {
        type: "tool_call" as const,
        id: "call-001",
        messageId: "msg-001",
        toolId: "Execute",
        toolName: "Execute",
        parameters: { command: "git diff" },
        timestamp: 1234567890,
        session_id: "abc",
      };

      const output = formatDroidEventForDisplay(event);

      expect(output).toContain("Tool: Execute");
      expect(output).toContain("git diff");
    });

    test("formats tool_result event", () => {
      const event = {
        type: "tool_result" as const,
        id: "call-001",
        messageId: "msg-002",
        toolId: "Read",
        isError: false,
        value: "File contents here",
        session_id: "abc",
      };

      const output = formatDroidEventForDisplay(event);

      expect(output).toContain("Tool Result");
      expect(output).toContain("File contents here");
    });

    test("formats assistant message event", () => {
      const event = {
        type: "message" as const,
        role: "assistant" as const,
        id: "msg-002",
        text: "Here is my analysis.",
        timestamp: 1234567890,
        session_id: "abc",
      };

      const output = formatDroidEventForDisplay(event);

      expect(output).toContain("Here is my analysis.");
    });

    test("formats completion event", () => {
      const event = {
        type: "completion" as const,
        finalText: "Final answer here",
        numTurns: 3,
        durationMs: 5000,
        session_id: "abc",
        timestamp: 1234567890,
      };

      const output = formatDroidEventForDisplay(event);

      expect(output).toContain("Result");
      expect(output).toContain("Final answer here");
    });

    test("returns null for system init event", () => {
      const event = {
        type: "system" as const,
        subtype: "init" as const,
        session_id: "abc",
        model: "gpt-5",
        cwd: "/home",
        tools: [],
      };

      const output = formatDroidEventForDisplay(event);

      expect(output).toBeNull();
    });

    test("returns null for user message event", () => {
      const event = {
        type: "message" as const,
        role: "user" as const,
        id: "msg-001",
        text: "/review",
        timestamp: 1234567890,
        session_id: "abc",
      };

      const output = formatDroidEventForDisplay(event);

      expect(output).toBeNull();
    });
  });

  describe("extractDroidResult", () => {
    test("extracts result from JSONL output", () => {
      const jsonl = [
        JSON.stringify({ type: "system", subtype: "init", session_id: "abc" }),
        JSON.stringify({
          type: "message",
          role: "assistant",
          id: "msg",
          text: "Working...",
          timestamp: 123,
          session_id: "abc",
        }),
        JSON.stringify({
          type: "completion",
          finalText: "The final answer is 42",
          numTurns: 2,
          durationMs: 1000,
          session_id: "abc",
          timestamp: 124,
        }),
      ].join("\n");

      const result = extractDroidResult(jsonl);

      expect(result).toBe("The final answer is 42");
    });

    test("returns null when no completion event found", () => {
      const jsonl = [
        JSON.stringify({ type: "system", subtype: "init", session_id: "abc" }),
        JSON.stringify({
          type: "message",
          role: "assistant",
          id: "msg",
          text: "Working...",
          timestamp: 123,
          session_id: "abc",
        }),
      ].join("\n");

      const result = extractDroidResult(jsonl);

      expect(result).toBeNull();
    });

    test("returns null for empty output", () => {
      const result = extractDroidResult("");
      expect(result).toBeNull();
    });

    test("handles output with blank lines", () => {
      const jsonl = [
        JSON.stringify({ type: "system", subtype: "init", session_id: "abc" }),
        "",
        JSON.stringify({
          type: "completion",
          finalText: "Found it",
          numTurns: 1,
          durationMs: 500,
          session_id: "abc",
          timestamp: 123,
        }),
        "",
      ].join("\n");

      const result = extractDroidResult(jsonl);

      expect(result).toBe("Found it");
    });

    test("handles malformed lines gracefully", () => {
      const jsonl = [
        "{invalid json}",
        JSON.stringify({
          type: "completion",
          finalText: "Still works",
          numTurns: 1,
          durationMs: 500,
          session_id: "abc",
          timestamp: 123,
        }),
      ].join("\n");

      const result = extractDroidResult(jsonl);

      expect(result).toBe("Still works");
    });

    test("returns last completion if multiple events", () => {
      const jsonl = [
        JSON.stringify({
          type: "completion",
          finalText: "First result",
          numTurns: 1,
          durationMs: 500,
          session_id: "abc",
          timestamp: 123,
        }),
        JSON.stringify({
          type: "completion",
          finalText: "Last result",
          numTurns: 2,
          durationMs: 1000,
          session_id: "abc",
          timestamp: 124,
        }),
      ].join("\n");

      const result = extractDroidResult(jsonl);

      expect(result).toBe("Last result");
    });
  });
});
