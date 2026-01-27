import { describe, expect, test } from "bun:test";
import {
  extractGeminiResult,
  formatGeminiEventForDisplay,
  formatGeminiReviewForFixer,
  parseGeminiStreamEvent,
} from "@/lib/agents/gemini-stream";

describe("gemini-stream", () => {
  describe("parseGeminiStreamEvent", () => {
    test("parses init event", () => {
      const line = JSON.stringify({
        type: "init",
        timestamp: "2026-01-27T16:15:40.521Z",
        session_id: "abc-123",
        model: "auto-gemini-3",
      });

      const event = parseGeminiStreamEvent(line);

      expect(event).not.toBeNull();
      expect(event?.type).toBe("init");
      if (event?.type === "init") {
        expect(event.session_id).toBe("abc-123");
        expect(event.model).toBe("auto-gemini-3");
      }
    });

    test("parses user message event", () => {
      const line = JSON.stringify({
        type: "message",
        timestamp: "2026-01-27T16:15:40.523Z",
        role: "user",
        content: "review the core logic",
      });

      const event = parseGeminiStreamEvent(line);

      expect(event).not.toBeNull();
      expect(event?.type).toBe("message");
      if (event?.type === "message") {
        expect(event.role).toBe("user");
        expect(event.content).toBe("review the core logic");
      }
    });

    test("parses assistant message event with delta", () => {
      const line = JSON.stringify({
        type: "message",
        timestamp: "2026-01-27T16:15:56.492Z",
        role: "assistant",
        content: "I will analyze the code...",
        delta: true,
      });

      const event = parseGeminiStreamEvent(line);

      expect(event).not.toBeNull();
      if (event?.type === "message") {
        expect(event.role).toBe("assistant");
        expect(event.content).toBe("I will analyze the code...");
        expect(event.delta).toBe(true);
      }
    });

    test("parses tool_use event", () => {
      const line = JSON.stringify({
        type: "tool_use",
        timestamp: "2026-01-27T16:15:57.005Z",
        tool_name: "codebase_investigator",
        tool_id: "codebase_investigator-123",
        parameters: { objective: "Analyze the code" },
      });

      const event = parseGeminiStreamEvent(line);

      expect(event).not.toBeNull();
      expect(event?.type).toBe("tool_use");
      if (event?.type === "tool_use") {
        expect(event.tool_name).toBe("codebase_investigator");
        expect(event.parameters).toEqual({ objective: "Analyze the code" });
      }
    });

    test("parses tool_result event", () => {
      const line = JSON.stringify({
        type: "tool_result",
        timestamp: "2026-01-27T16:17:29.988Z",
        tool_id: "codebase_investigator-123",
        status: "success",
        output: "Analysis complete...",
      });

      const event = parseGeminiStreamEvent(line);

      expect(event).not.toBeNull();
      expect(event?.type).toBe("tool_result");
      if (event?.type === "tool_result") {
        expect(event.tool_id).toBe("codebase_investigator-123");
        expect(event.status).toBe("success");
        expect(event.output).toContain("Analysis complete");
      }
    });

    test("parses result event", () => {
      const line = JSON.stringify({
        type: "result",
        timestamp: "2026-01-27T16:17:47.540Z",
        status: "success",
        stats: {
          total_tokens: 244505,
          input_tokens: 236399,
          output_tokens: 2204,
          duration_ms: 127020,
          tool_calls: 17,
        },
      });

      const event = parseGeminiStreamEvent(line);

      expect(event).not.toBeNull();
      expect(event?.type).toBe("result");
      if (event?.type === "result") {
        expect(event.status).toBe("success");
        expect(event.stats?.total_tokens).toBe(244505);
      }
    });

    test("returns null for invalid JSON", () => {
      const event = parseGeminiStreamEvent("{invalid json");
      expect(event).toBeNull();
    });

    test("returns null for empty string", () => {
      const event = parseGeminiStreamEvent("");
      expect(event).toBeNull();
    });

    test("returns null for non-JSON log lines", () => {
      const event = parseGeminiStreamEvent("YOLO mode is enabled.");
      expect(event).toBeNull();
    });

    test("returns null for object without type field", () => {
      const event = parseGeminiStreamEvent('{"foo": "bar"}');
      expect(event).toBeNull();
    });
  });

  describe("formatGeminiEventForDisplay", () => {
    test("formats tool_use event", () => {
      const event = {
        type: "tool_use" as const,
        timestamp: "2026-01-27T16:15:57.005Z",
        tool_name: "codebase_investigator",
        tool_id: "codebase_investigator-123",
        parameters: { objective: "Analyze the code" },
      };

      const output = formatGeminiEventForDisplay(event);

      expect(output).toContain("Tool: codebase_investigator");
      expect(output).toContain("Analyze the code");
    });

    test("formats tool_result event", () => {
      const event = {
        type: "tool_result" as const,
        timestamp: "2026-01-27T16:17:29.988Z",
        tool_id: "codebase_investigator-123",
        status: "success" as const,
        output: "Analysis results here",
      };

      const output = formatGeminiEventForDisplay(event);

      expect(output).toContain("Tool Result");
      expect(output).toContain("Analysis results here");
    });

    test("formats assistant message event", () => {
      const event = {
        type: "message" as const,
        timestamp: "2026-01-27T16:15:56.492Z",
        role: "assistant" as const,
        content: "Here is my analysis.",
        delta: true,
      };

      const output = formatGeminiEventForDisplay(event);

      expect(output).toContain("Here is my analysis.");
    });

    test("formats result event", () => {
      const event = {
        type: "result" as const,
        timestamp: "2026-01-27T16:17:47.540Z",
        status: "success" as const,
        stats: { total_tokens: 1000, duration_ms: 5000 },
      };

      const output = formatGeminiEventForDisplay(event);

      expect(output).toContain("Result");
      expect(output).toContain("success");
    });

    test("returns null for init event", () => {
      const event = {
        type: "init" as const,
        timestamp: "2026-01-27T16:15:40.521Z",
        session_id: "abc",
        model: "gemini-3",
      };

      const output = formatGeminiEventForDisplay(event);

      expect(output).toBeNull();
    });

    test("returns null for user message event", () => {
      const event = {
        type: "message" as const,
        timestamp: "2026-01-27T16:15:40.523Z",
        role: "user" as const,
        content: "/review",
      };

      const output = formatGeminiEventForDisplay(event);

      expect(output).toBeNull();
    });
  });

  describe("formatGeminiReviewForFixer", () => {
    test("skips init events", () => {
      const jsonl = [
        JSON.stringify({
          type: "init",
          timestamp: "2026-01-27T16:15:40.521Z",
          session_id: "abc",
          model: "gemini-3",
        }),
        JSON.stringify({
          type: "message",
          timestamp: "2026-01-27T16:15:56.492Z",
          role: "assistant",
          content: "Hello",
          delta: true,
        }),
      ].join("\n");

      const result = formatGeminiReviewForFixer(jsonl);

      expect(result).not.toBeNull();
      expect(result).not.toContain("init");
      expect(result).toContain("Hello");
    });

    test("skips user message events", () => {
      const jsonl = [
        JSON.stringify({
          type: "message",
          timestamp: "2026-01-27T16:15:40.523Z",
          role: "user",
          content: "/review changes",
        }),
        JSON.stringify({
          type: "message",
          timestamp: "2026-01-27T16:15:56.492Z",
          role: "assistant",
          content: "Reviewing now",
          delta: true,
        }),
      ].join("\n");

      const result = formatGeminiReviewForFixer(jsonl);

      expect(result).not.toContain("/review changes");
      expect(result).toContain("Reviewing now");
    });

    test("concatenates assistant message deltas", () => {
      const jsonl = [
        JSON.stringify({
          type: "message",
          timestamp: "2026-01-27T16:17:40.016Z",
          role: "assistant",
          content: "```json\n{",
          delta: true,
        }),
        JSON.stringify({
          type: "message",
          timestamp: "2026-01-27T16:17:40.571Z",
          role: "assistant",
          content: '"foo": "bar"',
          delta: true,
        }),
        JSON.stringify({
          type: "message",
          timestamp: "2026-01-27T16:17:41.244Z",
          role: "assistant",
          content: "}\n```",
          delta: true,
        }),
      ].join("\n");

      const result = formatGeminiReviewForFixer(jsonl);

      expect(result).toContain('```json\n{"foo": "bar"}\n```');
    });

    test("formats tool_use with tool name and parameters", () => {
      const jsonl = JSON.stringify({
        type: "tool_use",
        timestamp: "2026-01-27T16:15:57.005Z",
        tool_name: "Read",
        tool_id: "read-123",
        parameters: { file_path: "src/main.ts" },
      });

      const result = formatGeminiReviewForFixer(jsonl);

      expect(result).toContain("[Tool: Read]");
      expect(result).toContain("src/main.ts");
    });

    test("formats tool_result as Output", () => {
      const jsonl = JSON.stringify({
        type: "tool_result",
        timestamp: "2026-01-27T16:17:29.988Z",
        tool_id: "read-123",
        status: "success",
        output: "export function main() {}",
      });

      const result = formatGeminiReviewForFixer(jsonl);

      expect(result).toContain("[Output]");
      expect(result).toContain("export function main()");
    });

    test("formats result event with conclusion header", () => {
      const jsonl = JSON.stringify({
        type: "result",
        timestamp: "2026-01-27T16:17:47.540Z",
        status: "success",
        stats: { total_tokens: 1000 },
      });

      const result = formatGeminiReviewForFixer(jsonl);

      expect(result).toContain("=== FINAL RESULT ===");
      expect(result).toContain("success");
    });

    test("strips system-reminder tags from tool output", () => {
      const jsonl = JSON.stringify({
        type: "tool_result",
        timestamp: "2026-01-27T16:17:29.988Z",
        tool_id: "read-123",
        status: "success",
        output: `export function login() { }
<system-reminder>
  Some system reminder text here.
  </system-reminder>`,
      });

      const result = formatGeminiReviewForFixer(jsonl);

      expect(result).toContain("[Output]");
      expect(result).toContain("export function login()");
      expect(result).not.toContain("system-reminder");
    });

    test("handles full review sequence with delta concatenation", () => {
      const jsonl = [
        JSON.stringify({
          type: "init",
          timestamp: "2026-01-27T16:15:40.521Z",
          session_id: "abc",
          model: "gemini-3",
        }),
        JSON.stringify({
          type: "message",
          timestamp: "2026-01-27T16:15:40.523Z",
          role: "user",
          content: "/review",
        }),
        JSON.stringify({
          type: "message",
          timestamp: "2026-01-27T16:15:56.492Z",
          role: "assistant",
          content: "I will analyze ",
          delta: true,
        }),
        JSON.stringify({
          type: "message",
          timestamp: "2026-01-27T16:15:57.000Z",
          role: "assistant",
          content: "the code.",
          delta: true,
        }),
        JSON.stringify({
          type: "tool_use",
          timestamp: "2026-01-27T16:15:57.005Z",
          tool_name: "Read",
          tool_id: "read-123",
          parameters: { file_path: "src/auth.ts" },
        }),
        JSON.stringify({
          type: "tool_result",
          timestamp: "2026-01-27T16:17:29.988Z",
          tool_id: "read-123",
          status: "success",
          output: "export function login() { }",
        }),
        JSON.stringify({
          type: "message",
          timestamp: "2026-01-27T16:17:40.016Z",
          role: "assistant",
          content: "No issues found.",
          delta: true,
        }),
        JSON.stringify({
          type: "result",
          timestamp: "2026-01-27T16:17:47.540Z",
          status: "success",
          stats: { total_tokens: 1000 },
        }),
      ].join("\n");

      const result = formatGeminiReviewForFixer(jsonl);

      // Init and user events should be skipped
      expect(result).not.toContain("/review");

      // Deltas should be concatenated
      expect(result).toContain("I will analyze the code.");

      // Tool events should be present
      expect(result).toContain("[Tool: Read]");
      expect(result).toContain("src/auth.ts");
      expect(result).toContain("[Output]");
      expect(result).toContain("export function login()");

      // Later assistant message
      expect(result).toContain("No issues found.");

      // Final result
      expect(result).toContain("=== FINAL RESULT ===");
    });

    test("returns null for empty input", () => {
      const result = formatGeminiReviewForFixer("");
      expect(result).toBeNull();
    });

    test("returns null when no meaningful content", () => {
      const jsonl = JSON.stringify({
        type: "init",
        timestamp: "2026-01-27T16:15:40.521Z",
        session_id: "abc",
        model: "gemini-3",
      });

      const result = formatGeminiReviewForFixer(jsonl);

      expect(result).toBeNull();
    });

    test("handles non-JSON log lines gracefully", () => {
      const jsonl = [
        "YOLO mode is enabled.",
        "Loading extension: code-review",
        JSON.stringify({
          type: "message",
          timestamp: "2026-01-27T16:15:56.492Z",
          role: "assistant",
          content: "Valid content here",
          delta: true,
        }),
      ].join("\n");

      const result = formatGeminiReviewForFixer(jsonl);

      expect(result).not.toBeNull();
      expect(result).toContain("Valid content here");
    });
  });

  describe("extractGeminiResult", () => {
    test("extracts concatenated assistant messages", () => {
      const jsonl = [
        JSON.stringify({ type: "init", timestamp: "t", session_id: "abc", model: "gemini" }),
        JSON.stringify({
          type: "message",
          timestamp: "t",
          role: "assistant",
          content: "Part 1 ",
          delta: true,
        }),
        JSON.stringify({
          type: "message",
          timestamp: "t",
          role: "assistant",
          content: "Part 2 ",
          delta: true,
        }),
        JSON.stringify({
          type: "message",
          timestamp: "t",
          role: "assistant",
          content: "Part 3",
          delta: true,
        }),
        JSON.stringify({
          type: "result",
          timestamp: "t",
          status: "success",
        }),
      ].join("\n");

      const result = extractGeminiResult(jsonl);

      expect(result).toBe("Part 1 Part 2 Part 3");
    });

    test("handles multiple assistant message groups", () => {
      const jsonl = [
        JSON.stringify({
          type: "message",
          timestamp: "t1",
          role: "assistant",
          content: "First ",
          delta: true,
        }),
        JSON.stringify({
          type: "message",
          timestamp: "t2",
          role: "assistant",
          content: "message.",
          delta: true,
        }),
        JSON.stringify({
          type: "tool_use",
          timestamp: "t3",
          tool_name: "Read",
          tool_id: "read-1",
          parameters: {},
        }),
        JSON.stringify({
          type: "tool_result",
          timestamp: "t4",
          tool_id: "read-1",
          status: "success",
          output: "file content",
        }),
        JSON.stringify({
          type: "message",
          timestamp: "t5",
          role: "assistant",
          content: "Second ",
          delta: true,
        }),
        JSON.stringify({
          type: "message",
          timestamp: "t6",
          role: "assistant",
          content: "message.",
          delta: true,
        }),
        JSON.stringify({
          type: "result",
          timestamp: "t",
          status: "success",
        }),
      ].join("\n");

      const result = extractGeminiResult(jsonl);

      // Should concatenate ALL assistant deltas
      expect(result).toBe("First message.Second message.");
    });

    test("returns null when no assistant messages", () => {
      const jsonl = [
        JSON.stringify({ type: "init", timestamp: "t", session_id: "abc", model: "gemini" }),
        JSON.stringify({
          type: "message",
          timestamp: "t",
          role: "user",
          content: "/review",
        }),
        JSON.stringify({
          type: "result",
          timestamp: "t",
          status: "success",
        }),
      ].join("\n");

      const result = extractGeminiResult(jsonl);

      expect(result).toBeNull();
    });

    test("returns null for empty output", () => {
      const result = extractGeminiResult("");
      expect(result).toBeNull();
    });

    test("handles non-JSON log lines gracefully", () => {
      const jsonl = [
        "YOLO mode is enabled.",
        JSON.stringify({
          type: "message",
          timestamp: "t",
          role: "assistant",
          content: "Valid content",
          delta: true,
        }),
        JSON.stringify({
          type: "result",
          timestamp: "t",
          status: "success",
        }),
      ].join("\n");

      const result = extractGeminiResult(jsonl);

      expect(result).toBe("Valid content");
    });
  });
});
