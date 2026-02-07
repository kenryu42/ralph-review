import { describe, expect, test } from "bun:test";
import {
  extractCodexResult,
  formatCodexEventForDisplay,
  parseCodexStreamEvent,
} from "@/lib/agents/codex";

describe("codex-stream", () => {
  describe("parseCodexStreamEvent", () => {
    test("parses thread.started event", () => {
      const line = JSON.stringify({
        type: "thread.started",
        thread_id: "019c0a8e-933d-7413-8845-13c2819d4038",
      });

      const event = parseCodexStreamEvent(line);

      expect(event).not.toBeNull();
      expect(event?.type).toBe("thread.started");
      if (event?.type === "thread.started") {
        expect(event.thread_id).toBe("019c0a8e-933d-7413-8845-13c2819d4038");
      }
    });

    test("parses turn.started event", () => {
      const line = JSON.stringify({
        type: "turn.started",
      });

      const event = parseCodexStreamEvent(line);

      expect(event).not.toBeNull();
      expect(event?.type).toBe("turn.started");
    });

    test("parses turn.completed event with usage stats", () => {
      const line = JSON.stringify({
        type: "turn.completed",
        usage: {
          input_tokens: 1000,
          cached_input_tokens: 500,
          output_tokens: 200,
        },
      });

      const event = parseCodexStreamEvent(line);

      expect(event).not.toBeNull();
      expect(event?.type).toBe("turn.completed");
      if (event?.type === "turn.completed") {
        expect(event.usage.input_tokens).toBe(1000);
        expect(event.usage.cached_input_tokens).toBe(500);
        expect(event.usage.output_tokens).toBe(200);
      }
    });

    test("parses item.started event with command_execution item", () => {
      const line = JSON.stringify({
        type: "item.started",
        item: {
          id: "item_2",
          type: "command_execution",
          command: "/bin/zsh -lc 'git status --porcelain=v1'",
          aggregated_output: "",
          exit_code: null,
          status: "in_progress",
        },
      });

      const event = parseCodexStreamEvent(line);

      expect(event).not.toBeNull();
      expect(event?.type).toBe("item.started");
      if (event?.type === "item.started") {
        expect(event.item.type).toBe("command_execution");
        if (event.item.type === "command_execution") {
          expect(event.item.command).toContain("git status");
          expect(event.item.status).toBe("in_progress");
        }
      }
    });

    test("parses item.completed event with reasoning item", () => {
      const line = JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_0",
          type: "reasoning",
          text: "**Reviewing code changes**",
        },
      });

      const event = parseCodexStreamEvent(line);

      expect(event).not.toBeNull();
      expect(event?.type).toBe("item.completed");
      if (event?.type === "item.completed") {
        expect(event.item.type).toBe("reasoning");
        if (event.item.type === "reasoning") {
          expect(event.item.text).toContain("Reviewing code changes");
        }
      }
    });

    test("parses item.completed event with command_execution item", () => {
      const line = JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_2",
          type: "command_execution",
          command: "/bin/zsh -lc 'git diff'",
          aggregated_output: "diff --git a/src/cli.ts b/src/cli.ts\n...",
          exit_code: 0,
          status: "completed",
        },
      });

      const event = parseCodexStreamEvent(line);

      expect(event).not.toBeNull();
      expect(event?.type).toBe("item.completed");
      if (event?.type === "item.completed") {
        expect(event.item.type).toBe("command_execution");
        if (event.item.type === "command_execution") {
          expect(event.item.command).toContain("git diff");
          expect(event.item.exit_code).toBe(0);
          expect(event.item.status).toBe("completed");
          expect(event.item.aggregated_output).toContain("diff --git");
        }
      }
    });

    test("parses item.completed event with agent_message item", () => {
      const line = JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_140",
          type: "agent_message",
          text: "- [P2] Avoid including dirty working tree in base-branch diff",
        },
      });

      const event = parseCodexStreamEvent(line);

      expect(event).not.toBeNull();
      expect(event?.type).toBe("item.completed");
      if (event?.type === "item.completed") {
        expect(event.item.type).toBe("agent_message");
        if (event.item.type === "agent_message") {
          expect(event.item.text).toContain("[P2]");
        }
      }
    });

    test("returns null for invalid JSON", () => {
      const event = parseCodexStreamEvent("{invalid json");
      expect(event).toBeNull();
    });

    test("returns null for empty string", () => {
      const event = parseCodexStreamEvent("");
      expect(event).toBeNull();
    });

    test("returns null for non-object JSON", () => {
      const event = parseCodexStreamEvent('"just a string"');
      expect(event).toBeNull();
    });

    test("returns null for object without type field", () => {
      const event = parseCodexStreamEvent('{"foo": "bar"}');
      expect(event).toBeNull();
    });
  });

  describe("formatCodexEventForDisplay", () => {
    test("formats reasoning item.completed event with Reasoning label", () => {
      const event = {
        type: "item.completed" as const,
        item: {
          type: "reasoning" as const,
          id: "item_0",
          text: "Analyzing the code structure",
        },
      };

      const output = formatCodexEventForDisplay(event);

      expect(output).toContain("[Reasoning]");
      expect(output).toContain("Analyzing the code structure");
    });

    test("formats command_execution item.started event", () => {
      const event = {
        type: "item.started" as const,
        item: {
          type: "command_execution" as const,
          id: "item_2",
          command: "/bin/zsh -lc 'git status'",
          aggregated_output: "",
          exit_code: null as number | null,
          status: "in_progress" as const,
        },
      };

      const output = formatCodexEventForDisplay(event);

      expect(output).toContain("Command:");
      expect(output).toContain("git status");
    });

    test("formats command_execution item.completed event with output", () => {
      const event = {
        type: "item.completed" as const,
        item: {
          type: "command_execution" as const,
          id: "item_2",
          command: "/bin/zsh -lc 'git diff'",
          aggregated_output: " M src/cli.ts\n M src/lib/engine.ts",
          exit_code: 0,
          status: "completed" as const,
        },
      };

      const output = formatCodexEventForDisplay(event);

      expect(output).toContain("Output");
      expect(output).toContain("src/cli.ts");
    });

    test("formats agent_message item.completed event as result", () => {
      const event = {
        type: "item.completed" as const,
        item: {
          type: "agent_message" as const,
          id: "item_140",
          text: "No issues found in the code.",
        },
      };

      const output = formatCodexEventForDisplay(event);

      expect(output).toContain("Result");
      expect(output).toContain("No issues found");
    });

    test("returns null for thread.started event", () => {
      const event = {
        type: "thread.started" as const,
        thread_id: "abc-123",
      };

      const output = formatCodexEventForDisplay(event);

      expect(output).toBeNull();
    });

    test("returns null for turn.started event", () => {
      const event = {
        type: "turn.started" as const,
      };

      const output = formatCodexEventForDisplay(event);

      expect(output).toBeNull();
    });

    test("returns null for turn.completed event", () => {
      const event = {
        type: "turn.completed" as const,
        usage: {
          input_tokens: 1000,
          cached_input_tokens: 500,
          output_tokens: 200,
        },
      };

      const output = formatCodexEventForDisplay(event);

      expect(output).toBeNull();
    });

    test("returns null for item.started with reasoning (only show on completed)", () => {
      const event = {
        type: "item.started" as const,
        item: {
          type: "reasoning" as const,
          id: "item_0",
          text: "Thinking...",
        },
      };

      const output = formatCodexEventForDisplay(event);

      expect(output).toBeNull();
    });
  });

  describe("extractCodexResult", () => {
    test("extracts result from agent_message item", () => {
      const jsonl = [
        JSON.stringify({
          type: "thread.started",
          thread_id: "abc-123",
        }),
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "item_0",
            type: "reasoning",
            text: "Thinking...",
          },
        }),
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "item_140",
            type: "agent_message",
            text: "The final answer is 42",
          },
        }),
      ].join("\n");

      const result = extractCodexResult(jsonl);

      expect(result).toBe("The final answer is 42");
    });

    test("returns null when no agent_message found", () => {
      const jsonl = [
        JSON.stringify({
          type: "thread.started",
          thread_id: "abc-123",
        }),
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "item_0",
            type: "reasoning",
            text: "Thinking...",
          },
        }),
      ].join("\n");

      const result = extractCodexResult(jsonl);

      expect(result).toBeNull();
    });

    test("returns null for empty output", () => {
      const result = extractCodexResult("");
      expect(result).toBeNull();
    });

    test("handles output with blank lines", () => {
      const jsonl = [
        JSON.stringify({
          type: "thread.started",
          thread_id: "abc-123",
        }),
        "",
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "item_140",
            type: "agent_message",
            text: "Found it",
          },
        }),
        "",
      ].join("\n");

      const result = extractCodexResult(jsonl);

      expect(result).toBe("Found it");
    });

    test("handles malformed lines gracefully", () => {
      const jsonl = [
        "{invalid json}",
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "item_140",
            type: "agent_message",
            text: "Still works",
          },
        }),
      ].join("\n");

      const result = extractCodexResult(jsonl);

      expect(result).toBe("Still works");
    });

    test("returns last agent_message if multiple found", () => {
      const jsonl = [
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "item_50",
            type: "agent_message",
            text: "First message",
          },
        }),
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "item_140",
            type: "agent_message",
            text: "Last message",
          },
        }),
      ].join("\n");

      const result = extractCodexResult(jsonl);

      expect(result).toBe("Last message");
    });
  });
});
