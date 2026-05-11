import { afterEach, describe, expect, mock, test } from "bun:test";
import type { PendingHandoffArtifact } from "@/lib/handoff";
import { captureExitCode, createPromptLogCapture, withStdoutTTY } from "../helpers/capture";
import { createPendingHandoff } from "../helpers/review-workflow";

interface ApplyHarnessOptions {
  handoffs?: PendingHandoffArtifact[];
  hasApplyCommandDef?: boolean;
  isTTY?: boolean;
  selectValues?: unknown[];
  applyError?: Error;
}

interface ApplyHarnessResult {
  listPendingCalls: string[];
  applyCalls: Array<{ projectPath: string; sessionId: string }>;
  appendCalls: Array<{ logPath: string; entry: Record<string, unknown> }>;
  infos: string[];
  errors: string[];
  steps: string[];
  messages: string[];
  successes: string[];
  selectMessages: string[];
  exitCode: number | undefined;
}

async function runApplyWithHarness(
  args: string[],
  options: ApplyHarnessOptions = {}
): Promise<ApplyHarnessResult> {
  const handoffs = options.handoffs ?? [];
  const listPendingCalls: string[] = [];
  const applyCalls: Array<{ projectPath: string; sessionId: string }> = [];
  const appendCalls: Array<{ logPath: string; entry: Record<string, unknown> }> = [];
  const prompts = createPromptLogCapture(options.selectValues);
  const actualLogger = await import("@/lib/logger");

  mock.module("@/lib/handoff", () => ({
    createOrAutoApplyHandoff: async () => null,
    readPendingHandoff: async () => null,
    listProjectPendingHandoffs: async (_storageRoot: string | undefined, projectPath: string) => {
      listPendingCalls.push(projectPath);
      return handoffs.filter((handoff) => handoff.projectPath === projectPath);
    },
    applyPendingHandoff: async (
      _storageRoot: string | undefined,
      projectPath: string,
      sessionId: string
    ) => {
      applyCalls.push({ projectPath, sessionId });
      if (options.applyError) {
        throw options.applyError;
      }

      const matched = handoffs.find((handoff) => handoff.handoffId === sessionId);
      if (!matched) {
        throw new Error(`Unknown handoff ${sessionId}`);
      }

      return matched;
    },
    discardPendingHandoff: async () => {
      throw new Error("discardPendingHandoff should not be called in apply tests");
    },
  }));

  mock.module("@/lib/logger", () => ({
    ...actualLogger,
    appendLog: async (logPath: string, entry: Record<string, unknown>) => {
      appendCalls.push({ logPath, entry });
    },
  }));

  mock.module("@clack/prompts", () => prompts.module);

  const exitCode = await withStdoutTTY(options.isTTY ?? true, async () =>
    captureExitCode(async () => {
      const { runApply } = await import("@/commands/apply");
      if (options.hasApplyCommandDef === false) {
        await runApply(args, {
          getCommandDef: () => undefined,
        });
        return;
      }

      await runApply(args);
    })
  );

  return {
    listPendingCalls,
    applyCalls,
    appendCalls,
    infos: prompts.infos,
    errors: prompts.errors,
    steps: prompts.steps,
    messages: prompts.messages,
    successes: prompts.successes,
    selectMessages: prompts.selectMessages,
    exitCode,
  };
}

afterEach(() => {
  mock.restore();
});

describe("apply command", () => {
  test("errors when the apply command definition is missing", async () => {
    const result = await runApplyWithHarness([], {
      hasApplyCommandDef: false,
    });

    expect(result.errors).toEqual(["Internal error: apply command definition not found"]);
    expect(result.exitCode).toBe(1);
  });

  test("exits on parse errors", async () => {
    const result = await runApplyWithHarness(["--unknown"]);

    expect(result.errors).toHaveLength(1);
    expect(result.exitCode).toBe(1);
  });

  test("prints info when there are no pending handoffs", async () => {
    const result = await runApplyWithHarness([]);

    expect(result.infos).toEqual(["No pending review handoffs for current working directory."]);
    expect(result.applyCalls).toEqual([]);
  });

  test("applies the only pending handoff for the current project", async () => {
    const result = await runApplyWithHarness([], {
      handoffs: [createPendingHandoff()],
    });

    expect(result.applyCalls).toEqual([
      {
        projectPath: process.cwd(),
        sessionId: "session-id",
      },
    ]);
    expect(result.steps).toEqual(["Applying handoff: session-id"]);
    expect(result.successes).toEqual(["Review handoff applied."]);
    expect(result.appendCalls).toHaveLength(1);
    expect(result.appendCalls[0]?.logPath).toBe(
      `${process.cwd()}/.ralph-review/logs/session.jsonl`
    );
    expect(result.appendCalls[0]?.entry).toMatchObject({
      type: "handoff",
      handoffStatus: "applied-manual",
      commitSha: "commit-sha-1",
    });
    expect(typeof result.appendCalls[0]?.entry.timestamp).toBe("number");
  });

  test("errors when the session selector is blank", async () => {
    const result = await runApplyWithHarness(["--session", "   "], {
      handoffs: [createPendingHandoff()],
    });

    expect(result.errors).toEqual(["Session selector cannot be empty."]);
    expect(result.exitCode).toBe(1);
  });

  test("accepts a unique session id prefix", async () => {
    const result = await runApplyWithHarness(["--session", "session-a"], {
      handoffs: [
        createPendingHandoff({ sessionId: "session-alpha" }),
        createPendingHandoff({ sessionId: "session-beta" }),
      ],
    });

    expect(result.applyCalls).toEqual([
      {
        projectPath: process.cwd(),
        sessionId: "session-alpha",
      },
    ]);
  });

  test("errors when the session selector does not match any pending handoff", async () => {
    const result = await runApplyWithHarness(["--session", "session-z"], {
      handoffs: [createPendingHandoff({ sessionId: "session-alpha" })],
    });

    expect(result.errors).toEqual([
      'No pending review handoff matches "session-z" in the current project.',
    ]);
    expect(result.exitCode).toBe(1);
  });

  test("errors when the session selector matches multiple prefixes", async () => {
    const result = await runApplyWithHarness(["--session", "session-a"], {
      handoffs: [
        createPendingHandoff({ sessionId: "session-alpha" }),
        createPendingHandoff({ sessionId: "session-atom" }),
      ],
    });

    expect(result.errors).toEqual([
      'Session selector "session-a" is ambiguous for the current project.',
    ]);
    expect(result.exitCode).toBe(1);
  });

  test("prompts when multiple pending handoffs exist in an interactive terminal", async () => {
    const result = await runApplyWithHarness([], {
      handoffs: [
        createPendingHandoff({ sessionId: "session-alpha" }),
        createPendingHandoff({ sessionId: "session-beta" }),
      ],
      selectValues: ["session-beta"],
    });

    expect(result.selectMessages).toEqual(["Choose a review handoff to apply"]);
    expect(result.applyCalls[0]?.sessionId).toBe("session-beta");
  });

  test("returns without applying when interactive selection is cancelled", async () => {
    const result = await runApplyWithHarness([], {
      handoffs: [
        createPendingHandoff({ sessionId: "session-alpha" }),
        createPendingHandoff({ sessionId: "session-beta" }),
      ],
      selectValues: ["__CANCEL__"],
    });

    expect(result.applyCalls).toEqual([]);
    expect(result.successes).toEqual([]);
  });

  test("prints info when interactive selection returns no matching handoff", async () => {
    const result = await runApplyWithHarness([], {
      handoffs: [
        createPendingHandoff({ sessionId: "session-alpha" }),
        createPendingHandoff({ sessionId: "session-beta" }),
      ],
      selectValues: ["session-missing"],
    });

    expect(result.infos).toEqual([]);
    expect(result.applyCalls).toEqual([]);
    expect(result.successes).toEqual([]);
  });

  test("errors when multiple pending handoffs exist in a non-interactive terminal", async () => {
    const result = await runApplyWithHarness([], {
      handoffs: [
        createPendingHandoff({ sessionId: "session-alpha" }),
        createPendingHandoff({ sessionId: "session-beta" }),
      ],
      isTTY: false,
    });

    expect(result.errors).toEqual([
      "Multiple pending review handoffs exist for this project. Re-run with --session <id|name>.",
    ]);
    expect(result.exitCode).toBe(1);
  });
});
