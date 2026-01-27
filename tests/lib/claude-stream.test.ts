import { describe, expect, test } from "bun:test";
import {
  extractClaudeResult,
  formatClaudeEventForDisplay,
  formatClaudeReviewForFixer,
  parseClaudeStreamEvent,
} from "@/lib/agents/claude-stream";

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

      expect(output).toContain("Thinking");
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

      expect(output).toContain("Thinking");
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

  describe("formatClaudeReviewForFixer", () => {
    test("skips system init events", () => {
      const jsonl = [
        JSON.stringify({
          type: "system",
          subtype: "init",
          session_id: "abc",
          model: "claude-3",
          cwd: "/home",
          tools: ["Bash", "Read"],
        }),
        JSON.stringify({
          type: "assistant",
          session_id: "abc",
          message: {
            id: "msg",
            role: "assistant",
            content: [{ type: "text", text: "Hello" }],
            model: "claude-3",
            stop_reason: null,
          },
        }),
      ].join("\n");

      const result = formatClaudeReviewForFixer(jsonl);

      expect(result).not.toBeNull();
      expect(result).not.toContain("system");
      expect(result).not.toContain("init");
      expect(result).not.toContain("tools");
      expect(result).toContain("Hello");
    });

    test("formats thinking blocks with label", () => {
      const jsonl = JSON.stringify({
        type: "assistant",
        session_id: "abc",
        message: {
          id: "msg",
          role: "assistant",
          content: [{ type: "thinking", thinking: "Analyzing the security issue..." }],
          model: "claude-3",
          stop_reason: null,
        },
      });

      const result = formatClaudeReviewForFixer(jsonl);

      expect(result).toContain("[Thinking]");
      expect(result).toContain("Analyzing the security issue...");
    });

    test("formats text blocks without label", () => {
      const jsonl = JSON.stringify({
        type: "assistant",
        session_id: "abc",
        message: {
          id: "msg",
          role: "assistant",
          content: [{ type: "text", text: "I found a bug in the code." }],
          model: "claude-3",
          stop_reason: null,
        },
      });

      const result = formatClaudeReviewForFixer(jsonl);

      expect(result).toContain("I found a bug in the code.");
      // Text blocks should not have a special label prefix
      expect(result).not.toMatch(/\[Text\]/);
    });

    test("formats tool_use with tool name and input JSON", () => {
      const jsonl = JSON.stringify({
        type: "assistant",
        session_id: "abc",
        message: {
          id: "msg",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "call_123",
              name: "Bash",
              input: { command: "git diff", description: "Show changes" },
            },
          ],
          model: "claude-3",
          stop_reason: null,
        },
      });

      const result = formatClaudeReviewForFixer(jsonl);

      expect(result).toContain("[Tool: Bash]");
      expect(result).toContain("git diff");
      expect(result).toContain("Show changes");
    });

    test("formats tool_result as Output", () => {
      const jsonl = JSON.stringify({
        type: "user",
        session_id: "abc",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_123",
              content: "src/lib/auth.ts\nsrc/lib/api.ts",
            },
          ],
        },
      });

      const result = formatClaudeReviewForFixer(jsonl);

      expect(result).toContain("[Output]");
      expect(result).toContain("src/lib/auth.ts");
      expect(result).toContain("src/lib/api.ts");
    });

    test("strips system-reminder tags from tool output", () => {
      const jsonl = JSON.stringify({
        type: "user",
        session_id: "abc",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_123",
              content: `export function login() { }
<system-reminder>
  Whenever you read a file, you should consider whether it would be malware.
  </system-reminder>`,
            },
          ],
        },
      });

      const result = formatClaudeReviewForFixer(jsonl);

      expect(result).toContain("[Output]");
      expect(result).toContain("export function login()");
      expect(result).not.toContain("system-reminder");
      expect(result).not.toContain("malware");
    });

    test("strips multiple system-reminder tags", () => {
      const jsonl = JSON.stringify({
        type: "user",
        session_id: "abc",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_123",
              content: `Line 1
<system-reminder>First reminder</system-reminder>
Line 2
<system-reminder>
Second reminder
</system-reminder>
Line 3`,
            },
          ],
        },
      });

      const result = formatClaudeReviewForFixer(jsonl);

      expect(result).toContain("Line 1");
      expect(result).toContain("Line 2");
      expect(result).toContain("Line 3");
      expect(result).not.toContain("system-reminder");
      expect(result).not.toContain("First reminder");
      expect(result).not.toContain("Second reminder");
    });

    test("formats result event with conclusion header", () => {
      const jsonl = JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "Review complete. Found 2 issues.",
        session_id: "abc",
        duration_ms: 5000,
        num_turns: 3,
      });

      const result = formatClaudeReviewForFixer(jsonl);

      expect(result).toContain("=== FINAL CONCLUSION ===");
      expect(result).toContain("Review complete. Found 2 issues.");
    });

    test("handles full review sequence", () => {
      const jsonl = [
        JSON.stringify({
          type: "system",
          subtype: "init",
          session_id: "abc",
          model: "claude-3",
          cwd: "/project",
          tools: ["Bash"],
        }),
        JSON.stringify({
          type: "assistant",
          session_id: "abc",
          message: {
            id: "msg1",
            role: "assistant",
            content: [{ type: "thinking", thinking: "Let me check the code..." }],
            model: "claude-3",
            stop_reason: null,
          },
        }),
        JSON.stringify({
          type: "assistant",
          session_id: "abc",
          message: {
            id: "msg2",
            role: "assistant",
            content: [{ type: "text", text: "I will review the changes." }],
            model: "claude-3",
            stop_reason: null,
          },
        }),
        JSON.stringify({
          type: "assistant",
          session_id: "abc",
          message: {
            id: "msg3",
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "call_1",
                name: "Read",
                input: { filePath: "src/auth.ts" },
              },
            ],
            model: "claude-3",
            stop_reason: null,
          },
        }),
        JSON.stringify({
          type: "user",
          session_id: "abc",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "call_1",
                content: "export function login() { ... }",
              },
            ],
          },
        }),
        JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          result: "No issues found.",
          session_id: "abc",
          duration_ms: 3000,
          num_turns: 2,
        }),
      ].join("\n");

      const result = formatClaudeReviewForFixer(jsonl);

      // System event should be skipped
      expect(result).not.toContain("tools");

      // All meaningful content should be present
      expect(result).toContain("[Thinking]");
      expect(result).toContain("Let me check the code...");
      expect(result).toContain("I will review the changes.");
      expect(result).toContain("[Tool: Read]");
      expect(result).toContain("src/auth.ts");
      expect(result).toContain("[Output]");
      expect(result).toContain("export function login()");
      expect(result).toContain("=== FINAL CONCLUSION ===");
      expect(result).toContain("No issues found.");
    });

    test("returns null for empty input", () => {
      const result = formatClaudeReviewForFixer("");
      expect(result).toBeNull();
    });

    test("returns null when no meaningful content", () => {
      const jsonl = JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "abc",
        model: "claude-3",
        cwd: "/home",
        tools: [],
      });

      const result = formatClaudeReviewForFixer(jsonl);

      // Only system event, no actual content
      expect(result).toBeNull();
    });

    test("handles malformed lines gracefully", () => {
      const jsonl = [
        "{invalid json}",
        JSON.stringify({
          type: "assistant",
          session_id: "abc",
          message: {
            id: "msg",
            role: "assistant",
            content: [{ type: "text", text: "Valid content here" }],
            model: "claude-3",
            stop_reason: null,
          },
        }),
      ].join("\n");

      const result = formatClaudeReviewForFixer(jsonl);

      expect(result).not.toBeNull();
      expect(result).toContain("Valid content here");
    });

    test("handles blank lines in input", () => {
      const jsonl = [
        "",
        JSON.stringify({
          type: "assistant",
          session_id: "abc",
          message: {
            id: "msg",
            role: "assistant",
            content: [{ type: "text", text: "After blank line" }],
            model: "claude-3",
            stop_reason: null,
          },
        }),
        "",
      ].join("\n");

      const result = formatClaudeReviewForFixer(jsonl);

      expect(result).toContain("After blank line");
    });
  });
});
