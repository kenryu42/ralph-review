import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  extractCodexResult,
  formatCodexEventForDisplay,
  parseCodexStreamEvent,
} from "@/lib/agents/codex";

const TEST_THREAD_ID = "019c7011-02b8-7171-bf4f-1655372d8cf6";

let originalHome: string | undefined;

function padDatePart(value: number): string {
  return value.toString().padStart(2, "0");
}

function createHomeDir(): string {
  return `/tmp/rr-codex-session-tests-${crypto.randomUUID()}`;
}

function buildSessionPath(
  homeDir: string,
  threadId: string,
  dayOffset = 0,
  timePart = "00-00-00"
): string {
  const date = new Date();
  date.setDate(date.getDate() - dayOffset);
  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());
  return `${homeDir}/.codex/sessions/${year}/${month}/${day}/rollout-${year}-${month}-${day}T${timePart}-${threadId}.jsonl`;
}

async function writeSessionLines(
  homeDir: string,
  threadId: string,
  lines: string[],
  dayOffset = 0,
  timePart = "00-00-00"
): Promise<string> {
  const sessionPath = buildSessionPath(homeDir, threadId, dayOffset, timePart);
  await Bun.write(sessionPath, `${lines.join("\n")}\n`);
  return sessionPath;
}

function createReviewOutput(overallExplanation: string): Record<string, unknown> {
  return {
    findings: [],
    overall_correctness: "patch is correct",
    overall_explanation: overallExplanation,
    overall_confidence_score: 0.9,
  };
}

async function writeExitedReviewModeSession(
  homeDir: string,
  threadId: string,
  reviewOutput: unknown,
  dayOffset = 0,
  timePart = "00-00-00"
): Promise<string> {
  const lines = [
    JSON.stringify({
      type: "event_msg",
      payload: {
        type: "exited_review_mode",
        review_output: reviewOutput,
      },
    }),
  ];
  return writeSessionLines(homeDir, threadId, lines, dayOffset, timePart);
}

function threadStartedLine(threadId: string): string {
  return JSON.stringify({ type: "thread.started", thread_id: threadId });
}

function turnCompletedLine(): string {
  return JSON.stringify({
    type: "turn.completed",
    usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 },
  });
}

function agentMessageLine(text: string): string {
  return JSON.stringify({
    type: "item.completed",
    item: { id: "item_140", type: "agent_message", text },
  });
}

function buildSessionStreamJsonl(threadId: string, agentText: string): string {
  return [threadStartedLine(threadId), turnCompletedLine(), agentMessageLine(agentText)].join("\n");
}

beforeEach(() => {
  originalHome = process.env.HOME;
});

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
    return;
  }

  process.env.HOME = originalHome;
});

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

    test("formats item.started command when command is not shell wrapped", () => {
      const event = {
        type: "item.started" as const,
        item: {
          type: "command_execution" as const,
          id: "item_3",
          command: "git status --porcelain=v1",
          aggregated_output: "",
          exit_code: null as number | null,
          status: "in_progress" as const,
        },
      };

      const output = formatCodexEventForDisplay(event);

      expect(output).toContain("Command:");
      expect(output).toContain("git status --porcelain=v1");
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

    test("formats command_execution item.completed event without aggregated output", () => {
      const event = {
        type: "item.completed" as const,
        item: {
          type: "command_execution" as const,
          id: "item_4",
          command: "git diff",
          aggregated_output: "",
          exit_code: 1,
          status: "completed" as const,
        },
      };

      const output = formatCodexEventForDisplay(event);

      expect(output).toContain("Command: git diff");
      expect(output).toContain("exit: 1");
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
    test("extracts result from agent_message item", async () => {
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

      const result = await extractCodexResult(jsonl);

      expect(result).toBe("The final answer is 42");
    });

    test("returns null when no agent_message found", async () => {
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

      const result = await extractCodexResult(jsonl);

      expect(result).toBeNull();
    });

    test("returns null for empty output", async () => {
      const result = await extractCodexResult("");
      expect(result).toBeNull();
    });

    test("handles output with blank lines", async () => {
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

      const result = await extractCodexResult(jsonl);

      expect(result).toBe("Found it");
    });

    test("handles malformed lines gracefully", async () => {
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

      const result = await extractCodexResult(jsonl);

      expect(result).toBe("Still works");
    });

    test("returns last agent_message if multiple found", async () => {
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

      const result = await extractCodexResult(jsonl);

      expect(result).toBe("Last message");
    });

    test("prefers exited_review_mode.review_output from codex session file", async () => {
      const homeDir = createHomeDir();
      process.env.HOME = homeDir;
      const reviewOutput = createReviewOutput("Session review JSON");

      await writeExitedReviewModeSession(homeDir, TEST_THREAD_ID, reviewOutput);

      const result = await extractCodexResult(
        buildSessionStreamJsonl(TEST_THREAD_ID, "Fallback stream message")
      );

      expect(result).toBe(JSON.stringify(reviewOutput));
    });

    test("uses trimmed string from exited_review_mode.review_output", async () => {
      const homeDir = createHomeDir();
      process.env.HOME = homeDir;

      await writeExitedReviewModeSession(homeDir, TEST_THREAD_ID, "  Session review text  ");

      const result = await extractCodexResult(
        buildSessionStreamJsonl(TEST_THREAD_ID, "Fallback stream message")
      );

      expect(result).toBe("Session review text");
    });

    test("falls back when exited_review_mode.review_output is only whitespace", async () => {
      const homeDir = createHomeDir();
      process.env.HOME = homeDir;

      await writeExitedReviewModeSession(homeDir, TEST_THREAD_ID, "   ");

      const result = await extractCodexResult(
        buildSessionStreamJsonl(TEST_THREAD_ID, "Fallback stream message")
      );

      expect(result).toBe("Fallback stream message");
    });

    test("falls back when session event payload is not an object", async () => {
      const homeDir = createHomeDir();
      process.env.HOME = homeDir;

      await writeSessionLines(homeDir, TEST_THREAD_ID, [
        JSON.stringify({
          type: "event_msg",
          payload: "bad payload",
        }),
      ]);

      const result = await extractCodexResult(
        buildSessionStreamJsonl(TEST_THREAD_ID, "Fallback stream message")
      );

      expect(result).toBe("Fallback stream message");
    });

    test("falls back when session payload type is not exited_review_mode", async () => {
      const homeDir = createHomeDir();
      process.env.HOME = homeDir;

      await writeSessionLines(homeDir, TEST_THREAD_ID, [
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "review_mode_update",
            review_output: createReviewOutput("Ignored review JSON"),
          },
        }),
      ]);

      const result = await extractCodexResult(
        buildSessionStreamJsonl(TEST_THREAD_ID, "Fallback stream message")
      );

      expect(result).toBe("Fallback stream message");
    });

    test("falls back when session line is not event_msg", async () => {
      const homeDir = createHomeDir();
      process.env.HOME = homeDir;

      await writeSessionLines(homeDir, TEST_THREAD_ID, [
        JSON.stringify({
          type: "thread.started",
          thread_id: TEST_THREAD_ID,
        }),
      ]);

      const result = await extractCodexResult(
        buildSessionStreamJsonl(TEST_THREAD_ID, "Fallback stream message")
      );

      expect(result).toBe("Fallback stream message");
    });

    test("falls back when session file has no exited_review_mode events", async () => {
      const homeDir = createHomeDir();
      process.env.HOME = homeDir;

      await writeSessionLines(homeDir, TEST_THREAD_ID, [
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "review_mode_update",
          },
        }),
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "step",
            value: "still not exited review mode",
          },
        }),
      ]);

      const result = await extractCodexResult(
        buildSessionStreamJsonl(TEST_THREAD_ID, "Fallback stream message")
      );

      expect(result).toBe("Fallback stream message");
    });

    test("falls back when session file exists but cannot be read", async () => {
      const homeDir = createHomeDir();
      process.env.HOME = homeDir;

      const sessionPath = await writeSessionLines(homeDir, TEST_THREAD_ID, [
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "exited_review_mode",
            review_output: "This should not be readable",
          },
        }),
      ]);
      const chmodResult = Bun.spawnSync({ cmd: ["chmod", "000", sessionPath] });
      expect(chmodResult.exitCode).toBe(0);

      try {
        let readError: unknown = null;
        try {
          await Bun.file(sessionPath).text();
        } catch (error) {
          readError = error;
        }
        expect(readError).not.toBeNull();

        const result = await extractCodexResult(
          buildSessionStreamJsonl(TEST_THREAD_ID, "Fallback stream message")
        );
        expect(result).toBe("Fallback stream message");
      } finally {
        Bun.spawnSync({ cmd: ["chmod", "644", sessionPath] });
      }
    });

    test("uses the latest same-day session file for a thread", async () => {
      const homeDir = createHomeDir();
      process.env.HOME = homeDir;

      const earlierReviewOutput = createReviewOutput("Earlier session JSON");
      const latestReviewOutput = createReviewOutput("Latest session JSON");

      await writeExitedReviewModeSession(
        homeDir,
        TEST_THREAD_ID,
        earlierReviewOutput,
        0,
        "00-00-00"
      );
      await writeExitedReviewModeSession(
        homeDir,
        TEST_THREAD_ID,
        latestReviewOutput,
        0,
        "23-59-59"
      );

      const result = await extractCodexResult(
        buildSessionStreamJsonl(TEST_THREAD_ID, "Fallback stream message")
      );

      expect(result).toBe(JSON.stringify(latestReviewOutput));
    });

    test("ignores stale exited_review_mode output from older turns", async () => {
      const homeDir = createHomeDir();
      process.env.HOME = homeDir;

      await writeSessionLines(homeDir, TEST_THREAD_ID, [
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "exited_review_mode",
            review_output: createReviewOutput("Older review JSON"),
          },
        }),
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "exited_review_mode",
            review_output: null,
          },
        }),
      ]);

      const result = await extractCodexResult(
        buildSessionStreamJsonl(TEST_THREAD_ID, "Fresh stream message")
      );

      expect(result).toBe("Fresh stream message");
    });

    test("falls back to stream text when turn.completed is missing", async () => {
      const homeDir = createHomeDir();
      process.env.HOME = homeDir;

      await writeExitedReviewModeSession(
        homeDir,
        TEST_THREAD_ID,
        createReviewOutput("Session review JSON")
      );

      const jsonl = [
        threadStartedLine(TEST_THREAD_ID),
        agentMessageLine("Fallback stream message"),
      ].join("\n");

      const result = await extractCodexResult(jsonl);

      expect(result).toBe("Fallback stream message");
    });

    test("falls back to stream text when session file is missing", async () => {
      process.env.HOME = createHomeDir();

      const result = await extractCodexResult(
        buildSessionStreamJsonl(TEST_THREAD_ID, "Fallback stream message")
      );

      expect(result).toBe("Fallback stream message");
    });

    test("falls back to stream text when HOME is unavailable", async () => {
      delete process.env.HOME;

      const result = await extractCodexResult(
        buildSessionStreamJsonl(TEST_THREAD_ID, "Fallback stream message")
      );

      expect(result).toBe("Fallback stream message");
    });

    test("finds session files within the 3-day lookup window", async () => {
      const homeDir = createHomeDir();
      process.env.HOME = homeDir;
      const reviewOutput = createReviewOutput("Session review JSON");

      await writeExitedReviewModeSession(homeDir, TEST_THREAD_ID, reviewOutput, 2);

      const result = await extractCodexResult(
        buildSessionStreamJsonl(TEST_THREAD_ID, "Fallback stream message")
      );

      expect(result).toBe(JSON.stringify(reviewOutput));
    });
  });
});
