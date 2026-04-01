import { afterEach, describe, expect, mock, test } from "bun:test";
import type { PendingHandoffArtifact } from "@/lib/handoff";

const EXIT_PREFIX = "__FORCED_EXIT__:";

interface DiscardHarnessOptions {
  handoffs?: PendingHandoffArtifact[];
  hasDiscardCommandDef?: boolean;
  isTTY?: boolean;
  selectValues?: unknown[];
}

interface DiscardHarnessResult {
  listPendingCalls: string[];
  discardCalls: Array<{ projectPath: string; sessionId: string }>;
  appendCalls: Array<{ logPath: string; entry: Record<string, unknown> }>;
  infos: string[];
  errors: string[];
  steps: string[];
  successes: string[];
  selectMessages: string[];
  exitCode: number | undefined;
}

function createPendingHandoff(
  overrides: Partial<PendingHandoffArtifact> = {}
): PendingHandoffArtifact {
  const projectPath = process.cwd();
  return {
    sessionId: "session-id",
    projectPath,
    sourceRepoPath: projectPath,
    logPath: `${projectPath}/.ralph-review/logs/session.jsonl`,
    hiddenRef: "refs/ralph-review/handoffs/session-id",
    patchPath: `${projectPath}/.ralph-review/handoffs/session-id.patch`,
    sourceFingerprint: "fingerprint-1",
    commitSha: "commit-sha-1",
    state: "pending-apply",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

async function runDiscardWithHarness(
  args: string[],
  options: DiscardHarnessOptions = {}
): Promise<DiscardHarnessResult> {
  const handoffs = options.handoffs ?? [];
  const listPendingCalls: string[] = [];
  const discardCalls: Array<{ projectPath: string; sessionId: string }> = [];
  const appendCalls: Array<{ logPath: string; entry: Record<string, unknown> }> = [];
  const infos: string[] = [];
  const errors: string[] = [];
  const steps: string[] = [];
  const successes: string[] = [];
  const selectMessages: string[] = [];
  const selectValues = [...(options.selectValues ?? [])];
  const actualLogger = await import("@/lib/logger");

  mock.module("@/lib/handoff", () => ({
    createOrAutoApplyHandoff: async () => null,
    listProjectPendingHandoffs: async (_storageRoot: string | undefined, projectPath: string) => {
      listPendingCalls.push(projectPath);
      return handoffs.filter((handoff) => handoff.projectPath === projectPath);
    },
    applyPendingHandoff: async () => {
      throw new Error("applyPendingHandoff should not be called in discard tests");
    },
    discardPendingHandoff: async (
      _storageRoot: string | undefined,
      projectPath: string,
      sessionId: string
    ) => {
      discardCalls.push({ projectPath, sessionId });
      const matched = handoffs.find((handoff) => handoff.sessionId === sessionId);
      if (!matched) {
        throw new Error(`Unknown handoff ${sessionId}`);
      }

      return matched;
    },
  }));

  mock.module("@/lib/logger", () => ({
    ...actualLogger,
    appendLog: async (logPath: string, entry: Record<string, unknown>) => {
      appendCalls.push({ logPath, entry });
    },
  }));

  mock.module("@clack/prompts", () => ({
    log: {
      info: (message: string) => {
        infos.push(message);
      },
      error: (message: string) => {
        errors.push(message);
      },
      step: (message: string) => {
        steps.push(message);
      },
      message: () => {},
      success: (message: string) => {
        successes.push(message);
      },
    },
    select: async (input: { message: string }) => {
      selectMessages.push(input.message);
      return selectValues.shift();
    },
    isCancel: (value: unknown) => value === "__CANCEL__",
  }));

  const originalExit = process.exit;
  const originalIsTTY = process.stdout.isTTY;
  process.exit = ((code?: number) => {
    throw new Error(`${EXIT_PREFIX}${code ?? 0}`);
  }) as typeof process.exit;
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: options.isTTY ?? true,
  });

  const { runDiscard } = await import("@/commands/discard");
  let exitCode: number | undefined;

  try {
    if (options.hasDiscardCommandDef === false) {
      await runDiscard(args, {
        getCommandDef: () => undefined,
      });
    } else {
      await runDiscard(args);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(EXIT_PREFIX)) {
      exitCode = Number.parseInt(error.message.slice(EXIT_PREFIX.length), 10);
    } else {
      throw error;
    }
  } finally {
    process.exit = originalExit;
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: originalIsTTY,
    });
  }

  return {
    listPendingCalls,
    discardCalls,
    appendCalls,
    infos,
    errors,
    steps,
    successes,
    selectMessages,
    exitCode,
  };
}

afterEach(() => {
  mock.restore();
});

describe("discard command", () => {
  test("errors when the discard command definition is missing", async () => {
    const result = await runDiscardWithHarness([], {
      hasDiscardCommandDef: false,
    });

    expect(result.errors).toEqual(["Internal error: discard command definition not found"]);
    expect(result.exitCode).toBe(1);
  });

  test("exits on parse errors", async () => {
    const result = await runDiscardWithHarness(["--unknown"]);

    expect(result.errors).toHaveLength(1);
    expect(result.exitCode).toBe(1);
  });

  test("prints info when there are no pending handoffs", async () => {
    const result = await runDiscardWithHarness([]);

    expect(result.infos).toEqual(["No pending review handoffs for current working directory."]);
    expect(result.discardCalls).toEqual([]);
  });

  test("discards the selected pending handoff", async () => {
    const result = await runDiscardWithHarness([], {
      handoffs: [createPendingHandoff()],
    });

    expect(result.errors).toEqual([]);
    expect(result.infos).toEqual([]);
    expect(result.discardCalls).toEqual([
      {
        projectPath: process.cwd(),
        sessionId: "session-id",
      },
    ]);
    expect(result.steps).toEqual(["Discarding handoff: session-id"]);
    expect(result.successes).toEqual(["Review handoff discarded."]);
    expect(result.appendCalls).toHaveLength(1);
    expect(result.appendCalls[0]?.logPath).toBe(
      `${process.cwd()}/.ralph-review/logs/session.jsonl`
    );
    expect(result.appendCalls[0]?.entry).toMatchObject({
      type: "handoff",
      handoffStatus: "discarded",
      commitSha: "commit-sha-1",
    });
    expect(typeof result.appendCalls[0]?.entry.timestamp).toBe("number");
  });

  test("errors when the session selector is blank", async () => {
    const result = await runDiscardWithHarness(["--session", "   "], {
      handoffs: [createPendingHandoff()],
    });

    expect(result.errors).toEqual(["Session selector cannot be empty."]);
    expect(result.exitCode).toBe(1);
  });

  test("accepts a unique session id prefix", async () => {
    const result = await runDiscardWithHarness(["--session", "session-a"], {
      handoffs: [
        createPendingHandoff({ sessionId: "session-alpha" }),
        createPendingHandoff({ sessionId: "session-beta" }),
      ],
    });

    expect(result.discardCalls).toEqual([
      {
        projectPath: process.cwd(),
        sessionId: "session-alpha",
      },
    ]);
  });

  test("errors when the session selector does not match any pending handoff", async () => {
    const result = await runDiscardWithHarness(["--session", "session-z"], {
      handoffs: [createPendingHandoff({ sessionId: "session-alpha" })],
    });

    expect(result.errors).toEqual([
      'No pending review handoff matches "session-z" in the current project.',
    ]);
    expect(result.exitCode).toBe(1);
  });

  test("errors when the session selector matches multiple prefixes", async () => {
    const result = await runDiscardWithHarness(["--session", "session-a"], {
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
    const result = await runDiscardWithHarness([], {
      handoffs: [
        createPendingHandoff({ sessionId: "session-alpha" }),
        createPendingHandoff({ sessionId: "session-beta" }),
      ],
      selectValues: ["session-beta"],
    });

    expect(result.selectMessages).toEqual(["Choose a review handoff to discard"]);
    expect(result.discardCalls[0]?.sessionId).toBe("session-beta");
  });

  test("returns without discarding when interactive selection is cancelled", async () => {
    const result = await runDiscardWithHarness([], {
      handoffs: [
        createPendingHandoff({ sessionId: "session-alpha" }),
        createPendingHandoff({ sessionId: "session-beta" }),
      ],
      selectValues: ["__CANCEL__"],
    });

    expect(result.discardCalls).toEqual([]);
    expect(result.successes).toEqual([]);
  });

  test("prints info when interactive selection returns no matching handoff", async () => {
    const result = await runDiscardWithHarness([], {
      handoffs: [
        createPendingHandoff({ sessionId: "session-alpha" }),
        createPendingHandoff({ sessionId: "session-beta" }),
      ],
      selectValues: ["session-missing"],
    });

    expect(result.infos).toEqual([]);
    expect(result.discardCalls).toEqual([]);
    expect(result.successes).toEqual([]);
  });

  test("errors when multiple pending handoffs exist in a non-interactive terminal", async () => {
    const result = await runDiscardWithHarness([], {
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
