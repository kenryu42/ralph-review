import { describe, expect, test } from "bun:test";
import {
  extractClaudeResult,
  formatClaudeEventForDisplay,
  parseClaudeStreamEvent,
} from "@/lib/agents/claude";

describe("claude-stream", () => {
  describe("parseClaudeStreamEvent", () => {
    test("parses system init event", () => {
      const line = JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "abc-123",
        model: "claude-3",
        cwd: "/home/user/project",
        tools: ["Bash", "Read"],
      });

      const event = parseClaudeStreamEvent(line);

      expect(event).not.toBeNull();
      expect(event?.type).toBe("system");
      if (event?.type === "system") {
        expect(event.subtype).toBe("init");
        expect(event.session_id).toBe("abc-123");
      }
    });

    test("parses assistant event with text content", () => {
      const line = JSON.stringify({
        type: "assistant",
        session_id: "abc-123",
        message: {
          id: "msg_001",
          role: "assistant",
          content: [{ type: "text", text: "Hello, world!" }],
          model: "claude-3",
          stop_reason: null,
        },
      });

      const event = parseClaudeStreamEvent(line);

      expect(event).not.toBeNull();
      expect(event?.type).toBe("assistant");
      if (event?.type === "assistant") {
        expect(event.message.content).toHaveLength(1);
        expect(event.message.content[0]?.type).toBe("text");
      }
    });

    test("parses assistant event with thinking content", () => {
      const line = JSON.stringify({
        type: "assistant",
        session_id: "abc-123",
        message: {
          id: "msg_001",
          role: "assistant",
          content: [{ type: "thinking", thinking: "Let me analyze this..." }],
          model: "claude-3",
          stop_reason: null,
        },
      });

      const event = parseClaudeStreamEvent(line);

      expect(event).not.toBeNull();
      if (event?.type === "assistant") {
        const block = event.message.content[0];
        expect(block?.type).toBe("thinking");
        if (block?.type === "thinking") {
          expect(block.thinking).toBe("Let me analyze this...");
        }
      }
    });

    test("parses assistant event with tool_use content", () => {
      const line = JSON.stringify({
        type: "assistant",
        session_id: "abc-123",
        message: {
          id: "msg_001",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "call_Bash_123",
              name: "Bash",
              input: { command: "ls -la" },
            },
          ],
          model: "claude-3",
          stop_reason: null,
        },
      });

      const event = parseClaudeStreamEvent(line);

      expect(event).not.toBeNull();
      if (event?.type === "assistant") {
        const block = event.message.content[0];
        expect(block?.type).toBe("tool_use");
        if (block?.type === "tool_use") {
          expect(block.name).toBe("Bash");
        }
      }
    });

    test("parses user event with tool result", () => {
      const line = JSON.stringify({
        type: "user",
        session_id: "abc-123",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_Bash_123",
              content: "file1.txt\nfile2.txt",
            },
          ],
        },
        tool_use_result: {
          stdout: "file1.txt\nfile2.txt",
          stderr: "",
        },
      });

      const event = parseClaudeStreamEvent(line);

      expect(event).not.toBeNull();
      expect(event?.type).toBe("user");
      if (event?.type === "user") {
        expect(event.tool_use_result?.stdout).toBe("file1.txt\nfile2.txt");
      }
    });

    test("parses result event", () => {
      const line = JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "Task completed successfully",
        session_id: "abc-123",
        duration_ms: 5000,
        num_turns: 3,
        total_cost_usd: 0.05,
      });

      const event = parseClaudeStreamEvent(line);

      expect(event).not.toBeNull();
      expect(event?.type).toBe("result");
      if (event?.type === "result") {
        expect(event.result).toBe("Task completed successfully");
        expect(event.is_error).toBe(false);
      }
    });

    test("returns null for invalid JSON", () => {
      const event = parseClaudeStreamEvent("{invalid json");
      expect(event).toBeNull();
    });

    test("returns null for empty string", () => {
      const event = parseClaudeStreamEvent("");
      expect(event).toBeNull();
    });

    test("returns null for non-object JSON", () => {
      const event = parseClaudeStreamEvent('"just a string"');
      expect(event).toBeNull();
    });

    test("returns null for object without type field", () => {
      const event = parseClaudeStreamEvent('{"foo": "bar"}');
      expect(event).toBeNull();
    });
  });

  describe("formatClaudeEventForDisplay", () => {
    test("formats thinking block", () => {
      const event = {
        type: "assistant" as const,
        session_id: "abc",
        message: {
          id: "msg",
          role: "assistant" as const,
          content: [{ type: "thinking" as const, thinking: "Analyzing the code..." }],
          model: "claude-3",
          stop_reason: null,
        },
      };

      const output = formatClaudeEventForDisplay(event);

      expect(output).toContain("Reasoning");
      expect(output).toContain("Analyzing the code...");
    });

    test("formats text block", () => {
      const event = {
        type: "assistant" as const,
        session_id: "abc",
        message: {
          id: "msg",
          role: "assistant" as const,
          content: [{ type: "text" as const, text: "Here is my response." }],
          model: "claude-3",
          stop_reason: null,
        },
      };

      const output = formatClaudeEventForDisplay(event);

      expect(output).toContain("Here is my response.");
    });

    test("formats tool_use block with tool name", () => {
      const event = {
        type: "assistant" as const,
        session_id: "abc",
        message: {
          id: "msg",
          role: "assistant" as const,
          content: [
            {
              type: "tool_use" as const,
              id: "call_123",
              name: "Bash",
              input: { command: "ls -la", description: "List files" },
            },
          ],
          model: "claude-3",
          stop_reason: null,
        },
      };

      const output = formatClaudeEventForDisplay(event);

      expect(output).toContain("Tool: Bash");
      expect(output).toContain("command");
    });

    test("formats user event with tool result", () => {
      const event = {
        type: "user" as const,
        session_id: "abc",
        message: {
          role: "user" as const,
          content: [
            {
              type: "tool_result" as const,
              tool_use_id: "call_123",
              content: "Success output here",
            },
          ],
        },
      };

      const output = formatClaudeEventForDisplay(event);

      expect(output).toContain("Tool Result");
      expect(output).toContain("Success output here");
    });

    test("formats result event", () => {
      const event = {
        type: "result" as const,
        subtype: "success",
        is_error: false,
        result: "Final answer here",
        session_id: "abc",
        duration_ms: 1000,
        num_turns: 2,
      };

      const output = formatClaudeEventForDisplay(event);

      expect(output).toContain("Result");
      expect(output).toContain("Final answer here");
    });

    test("returns null for system init event", () => {
      const event = {
        type: "system" as const,
        subtype: "init" as const,
        session_id: "abc",
        model: "claude-3",
        cwd: "/home",
        tools: [],
      };

      const output = formatClaudeEventForDisplay(event);

      expect(output).toBeNull();
    });

    test("formats multiple content blocks in one event", () => {
      const event = {
        type: "assistant" as const,
        session_id: "abc",
        message: {
          id: "msg",
          role: "assistant" as const,
          content: [
            { type: "thinking" as const, thinking: "First I think..." },
            { type: "text" as const, text: "Then I say..." },
          ],
          model: "claude-3",
          stop_reason: null,
        },
      };

      const output = formatClaudeEventForDisplay(event);

      expect(output).toContain("Reasoning");
      expect(output).toContain("First I think...");
      expect(output).toContain("Then I say...");
    });

    test("returns null for malformed assistant events", () => {
      const line = JSON.stringify({
        type: "assistant",
        session_id: "abc",
      });
      const event = parseClaudeStreamEvent(line);

      expect(event?.type).toBe("assistant");
      if (!event) {
        throw new Error("Expected event to be parsed");
      }

      const output = formatClaudeEventForDisplay(event);
      expect(output).toBeNull();
    });
  });

  describe("extractClaudeResult", () => {
    test("extracts result from JSONL output", () => {
      const jsonl = [
        JSON.stringify({ type: "system", subtype: "init", session_id: "abc" }),
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Working..." }] },
        }),
        JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          result: "The final answer is 42",
          session_id: "abc",
          duration_ms: 1000,
          num_turns: 1,
        }),
      ].join("\n");

      const result = extractClaudeResult(jsonl);

      expect(result).toBe("The final answer is 42");
    });

    test("returns null when no result event found", () => {
      const jsonl = [
        JSON.stringify({ type: "system", subtype: "init", session_id: "abc" }),
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Working..." }] },
        }),
      ].join("\n");

      const result = extractClaudeResult(jsonl);

      expect(result).toBeNull();
    });

    test("returns null for empty output", () => {
      const result = extractClaudeResult("");
      expect(result).toBeNull();
    });

    test("ignores malformed result events and keeps last valid result", () => {
      const jsonl = [
        JSON.stringify({ type: "result", result: 42 }),
        JSON.stringify({
          type: "result",
          result: "Final answer",
          subtype: "success",
          is_error: false,
          session_id: "abc",
          duration_ms: 1,
          num_turns: 1,
        }),
      ].join("\n");

      const result = extractClaudeResult(jsonl);
      expect(result).toBe("Final answer");
    });

    test("handles output with blank lines", () => {
      const jsonl = [
        JSON.stringify({ type: "system", subtype: "init", session_id: "abc" }),
        "",
        JSON.stringify({
          type: "result",
          result: "Found it",
          subtype: "success",
          is_error: false,
          session_id: "abc",
          duration_ms: 500,
          num_turns: 1,
        }),
        "",
      ].join("\n");

      const result = extractClaudeResult(jsonl);

      expect(result).toBe("Found it");
    });

    test("handles malformed lines gracefully", () => {
      const jsonl = [
        "{invalid json}",
        JSON.stringify({
          type: "result",
          result: "Still works",
          subtype: "success",
          is_error: false,
          session_id: "abc",
          duration_ms: 500,
          num_turns: 1,
        }),
      ].join("\n");

      const result = extractClaudeResult(jsonl);

      expect(result).toBe("Still works");
    });

    test("returns last result if multiple result events", () => {
      const jsonl = [
        JSON.stringify({
          type: "result",
          result: "First result",
          subtype: "success",
          is_error: false,
          session_id: "abc",
          duration_ms: 500,
          num_turns: 1,
        }),
        JSON.stringify({
          type: "result",
          result: "Last result",
          subtype: "success",
          is_error: false,
          session_id: "abc",
          duration_ms: 500,
          num_turns: 1,
        }),
      ].join("\n");

      const result = extractClaudeResult(jsonl);

      expect(result).toBe("Last result");
    });
  });
});
