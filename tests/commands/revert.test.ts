import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ArchivedAppliedHandoffArtifact } from "@/lib/handoff";

const EXIT_PREFIX = "__FORCED_EXIT__:";

interface RevertHarnessOptions {
  handoffs?: ArchivedAppliedHandoffArtifact[];
  matchingHandoffs?: ArchivedAppliedHandoffArtifact[];
  matchingFingerprint?: string;
  hasRevertCommandDef?: boolean;
  isTTY?: boolean;
  selectValues?: unknown[];
  revertError?: Error;
}

interface RevertHarnessResult {
  listArchivedCalls: string[];
  listMatchingCalls: string[];
  revertCalls: Array<{
    projectPath: string;
    sessionId: string;
    expectedCurrentFingerprint?: string;
  }>;
  infos: string[];
  errors: string[];
  steps: string[];
  successes: string[];
  selectMessages: string[];
  spinnerStarts: string[];
  spinnerStops: string[];
  exitCode: number | undefined;
}

function createArchivedHandoff(
  overrides: Partial<ArchivedAppliedHandoffArtifact> = {}
): ArchivedAppliedHandoffArtifact {
  const projectPath = process.cwd();
  return {
    handoffId: overrides.handoffId ?? overrides.sessionId ?? "session-id",
    sessionId: "session-id",
    projectPath,
    sourceRepoPath: projectPath,
    logPath: `${projectPath}/.ralph-review/logs/session.jsonl`,
    patchPath: `${projectPath}/.ralph-review/handoff-history/session-id.patch`,
    sourceBaselineFingerprint: "fingerprint-source-1",
    appliedFingerprint: "fingerprint-applied-1",
    commitSha: "commit-sha-1",
    appliedVia: "auto",
    state: "archived-applied",
    createdAt: 1,
    appliedAt: 2,
    ...overrides,
  };
}

async function runRevertWithHarness(
  args: string[],
  options: RevertHarnessOptions = {}
): Promise<RevertHarnessResult> {
  const handoffs = options.handoffs ?? [];
  const matchingHandoffs = options.matchingHandoffs ?? handoffs;
  const matchingFingerprint = options.matchingFingerprint ?? "current-fingerprint-1";
  const listArchivedCalls: string[] = [];
  const listMatchingCalls: string[] = [];
  const revertCalls: Array<{
    projectPath: string;
    sessionId: string;
    expectedCurrentFingerprint?: string;
  }> = [];
  const infos: string[] = [];
  const errors: string[] = [];
  const steps: string[] = [];
  const successes: string[] = [];
  const selectMessages: string[] = [];
  const spinnerStarts: string[] = [];
  const spinnerStops: string[] = [];
  const selectValues = [...(options.selectValues ?? [])];

  mock.module("@/lib/handoff", () => ({
    createOrAutoApplyHandoff: async () => null,
    readPendingHandoff: async () => null,
    listProjectPendingHandoffs: async () => [],
    applyPendingHandoff: async () => {
      throw new Error("applyPendingHandoff should not be called in revert tests");
    },
    discardPendingHandoff: async () => {
      throw new Error("discardPendingHandoff should not be called in revert tests");
    },
    listProjectArchivedHandoffs: async (_storageRoot: string | undefined, projectPath: string) => {
      listArchivedCalls.push(projectPath);
      return handoffs.filter((handoff) => handoff.projectPath === projectPath);
    },
    listProjectRevertableHandoffs: async (
      _storageRoot: string | undefined,
      projectPath: string
    ) => {
      listMatchingCalls.push(projectPath);
      return {
        currentFingerprint: matchingFingerprint,
        handoffs: matchingHandoffs.filter((handoff) => handoff.projectPath === projectPath),
      };
    },
    listProjectReapplicableHandoffs: async () => ({
      currentFingerprint: matchingFingerprint,
      handoffs: [],
    }),
    revertArchivedHandoff: async (
      _storageRoot: string | undefined,
      projectPath: string,
      sessionId: string,
      expectedCurrentFingerprint?: string
    ) => {
      revertCalls.push({ projectPath, sessionId, expectedCurrentFingerprint });
      if (options.revertError) {
        throw options.revertError;
      }

      const matched = handoffs.find((handoff) => handoff.handoffId === sessionId);
      if (!matched) {
        throw new Error(`Unknown archived handoff ${sessionId}`);
      }

      return matched;
    },
    reapplyArchivedHandoff: async () => {
      throw new Error("reapplyArchivedHandoff should not be called in revert tests");
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
    spinner: () => ({
      start: (message: string) => {
        spinnerStarts.push(message);
      },
      stop: (message: string) => {
        spinnerStops.push(message);
      },
    }),
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

  const { runRevert } = await import("@/commands/revert");
  let exitCode: number | undefined;

  try {
    if (options.hasRevertCommandDef === false) {
      await runRevert(args, {
        getCommandDef: () => undefined,
      });
    } else {
      await runRevert(args);
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
    listArchivedCalls,
    listMatchingCalls,
    revertCalls,
    infos,
    errors,
    steps,
    successes,
    selectMessages,
    spinnerStarts,
    spinnerStops,
    exitCode,
  };
}

afterEach(() => {
  mock.restore();
});

describe("revert command", () => {
  test("errors when the revert command definition is missing", async () => {
    const result = await runRevertWithHarness([], {
      hasRevertCommandDef: false,
    });

    expect(result.errors).toEqual(["Internal error: revert command definition not found"]);
    expect(result.exitCode).toBe(1);
  });

  test("exits on parse errors", async () => {
    const result = await runRevertWithHarness(["--unknown"]);

    expect(result.errors).toHaveLength(1);
    expect(result.exitCode).toBe(1);
  });

  test("errors when no archived handoff matches the current repository state", async () => {
    const result = await runRevertWithHarness([], {
      handoffs: [createArchivedHandoff()],
      matchingHandoffs: [],
    });

    expect(result.errors).toEqual([
      "No archived review handoff matches the current repository state for revert.",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.revertCalls).toEqual([]);
    expect(result.spinnerStarts).toEqual(["Checking archived handoff matches..."]);
    expect(result.spinnerStops).toEqual(["Archived handoff scan complete."]);
  });

  test("reverts the only archived handoff matching the current repository state", async () => {
    const result = await runRevertWithHarness([], {
      handoffs: [createArchivedHandoff()],
    });

    expect(result.revertCalls).toEqual([
      {
        projectPath: process.cwd(),
        sessionId: "session-id",
        expectedCurrentFingerprint: "current-fingerprint-1",
      },
    ]);
    expect(result.steps).toEqual(["Reverting handoff: session-id"]);
    expect(result.successes).toEqual(["Review handoff reverted."]);
    expect(result.spinnerStarts).toEqual([
      "Checking archived handoff matches...",
      "Reverting archived handoff...",
    ]);
    expect(result.spinnerStops).toEqual([
      "Archived handoff scan complete.",
      "Review handoff reverted.",
    ]);
  });

  test("accepts a unique archived session id prefix", async () => {
    const result = await runRevertWithHarness(["--session", "session-a"], {
      handoffs: [
        createArchivedHandoff({ sessionId: "session-alpha" }),
        createArchivedHandoff({ sessionId: "session-beta" }),
      ],
      matchingHandoffs: [],
    });

    expect(result.revertCalls).toEqual([
      {
        projectPath: process.cwd(),
        sessionId: "session-alpha",
      },
    ]);
    expect(result.listArchivedCalls).toEqual([process.cwd()]);
    expect(result.listMatchingCalls).toEqual([]);
    expect(result.revertCalls[0]?.expectedCurrentFingerprint).toBeUndefined();
  });

  test("surfaces archived state mismatch errors from revert", async () => {
    await expect(
      runRevertWithHarness(["--session", "session-id"], {
        handoffs: [createArchivedHandoff()],
        revertError: new Error(
          'Archived review handoff "session-id" cannot be reverted because the current repository state does not match its applied snapshot.'
        ),
      })
    ).rejects.toThrow(
      'Archived review handoff "session-id" cannot be reverted because the current repository state does not match its applied snapshot.'
    );
  });

  test("prompts when multiple archived handoffs match in an interactive terminal", async () => {
    const result = await runRevertWithHarness([], {
      matchingHandoffs: [
        createArchivedHandoff({ sessionId: "session-alpha" }),
        createArchivedHandoff({ sessionId: "session-beta" }),
      ],
      handoffs: [
        createArchivedHandoff({ sessionId: "session-alpha" }),
        createArchivedHandoff({ sessionId: "session-beta" }),
      ],
      selectValues: ["session-beta"],
    });

    expect(result.selectMessages).toEqual(["Choose a review handoff to revert"]);
    expect(result.revertCalls[0]?.sessionId).toBe("session-beta");
    expect(result.spinnerStarts[0]).toBe("Checking archived handoff matches...");
    expect(result.spinnerStops[0]).toBe("Archived handoff scan complete.");
  });

  test("returns without reverting when interactive selection is cancelled", async () => {
    const result = await runRevertWithHarness([], {
      matchingHandoffs: [
        createArchivedHandoff({ sessionId: "session-alpha" }),
        createArchivedHandoff({ sessionId: "session-beta" }),
      ],
      handoffs: [
        createArchivedHandoff({ sessionId: "session-alpha" }),
        createArchivedHandoff({ sessionId: "session-beta" }),
      ],
      selectValues: ["__CANCEL__"],
    });

    expect(result.revertCalls).toEqual([]);
    expect(result.successes).toEqual([]);
  });

  test("errors when multiple archived handoffs match in a non-interactive terminal", async () => {
    const result = await runRevertWithHarness([], {
      matchingHandoffs: [
        createArchivedHandoff({ sessionId: "session-alpha" }),
        createArchivedHandoff({ sessionId: "session-beta" }),
      ],
      isTTY: false,
    });

    expect(result.errors).toEqual([
      "Multiple archived review handoffs match the current repository state. Re-run with --session <id|name>.",
    ]);
    expect(result.exitCode).toBe(1);
  });
});
