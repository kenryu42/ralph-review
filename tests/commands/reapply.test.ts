import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ArchivedAppliedHandoffArtifact } from "@/lib/handoff";

const EXIT_PREFIX = "__FORCED_EXIT__:";

interface ReapplyHarnessOptions {
  handoffs?: ArchivedAppliedHandoffArtifact[];
  matchingHandoffs?: ArchivedAppliedHandoffArtifact[];
  matchingFingerprint?: string;
  hasReapplyCommandDef?: boolean;
  isTTY?: boolean;
  selectValues?: unknown[];
  reapplyError?: Error;
}

interface ReapplyHarnessResult {
  listArchivedCalls: string[];
  listMatchingCalls: string[];
  reapplyCalls: Array<{
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

async function runReapplyWithHarness(
  args: string[],
  options: ReapplyHarnessOptions = {}
): Promise<ReapplyHarnessResult> {
  const handoffs = options.handoffs ?? [];
  const matchingHandoffs = options.matchingHandoffs ?? handoffs;
  const matchingFingerprint = options.matchingFingerprint ?? "current-fingerprint-1";
  const listArchivedCalls: string[] = [];
  const listMatchingCalls: string[] = [];
  const reapplyCalls: Array<{
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
      throw new Error("applyPendingHandoff should not be called in reapply tests");
    },
    discardPendingHandoff: async () => {
      throw new Error("discardPendingHandoff should not be called in reapply tests");
    },
    listProjectArchivedHandoffs: async (_storageRoot: string | undefined, projectPath: string) => {
      listArchivedCalls.push(projectPath);
      return handoffs.filter((handoff) => handoff.projectPath === projectPath);
    },
    listProjectReapplicableHandoffs: async (
      _storageRoot: string | undefined,
      projectPath: string
    ) => {
      listMatchingCalls.push(projectPath);
      return {
        currentFingerprint: matchingFingerprint,
        handoffs: matchingHandoffs.filter((handoff) => handoff.projectPath === projectPath),
      };
    },
    listProjectRevertableHandoffs: async () => ({
      currentFingerprint: matchingFingerprint,
      handoffs: [],
    }),
    reapplyArchivedHandoff: async (
      _storageRoot: string | undefined,
      projectPath: string,
      sessionId: string,
      expectedCurrentFingerprint?: string
    ) => {
      reapplyCalls.push({ projectPath, sessionId, expectedCurrentFingerprint });
      if (options.reapplyError) {
        throw options.reapplyError;
      }

      const matched = handoffs.find((handoff) => handoff.handoffId === sessionId);
      if (!matched) {
        throw new Error(`Unknown archived handoff ${sessionId}`);
      }

      return matched;
    },
    revertArchivedHandoff: async () => {
      throw new Error("revertArchivedHandoff should not be called in reapply tests");
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

  const { runReapply } = await import("@/commands/reapply");
  let exitCode: number | undefined;

  try {
    if (options.hasReapplyCommandDef === false) {
      await runReapply(args, {
        getCommandDef: () => undefined,
      });
    } else {
      await runReapply(args);
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
    reapplyCalls,
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

describe("reapply command", () => {
  test("errors when the reapply command definition is missing", async () => {
    const result = await runReapplyWithHarness([], {
      hasReapplyCommandDef: false,
    });

    expect(result.errors).toEqual(["Internal error: reapply command definition not found"]);
    expect(result.exitCode).toBe(1);
  });

  test("exits on parse errors", async () => {
    const result = await runReapplyWithHarness(["--unknown"]);

    expect(result.errors).toHaveLength(1);
    expect(result.exitCode).toBe(1);
  });

  test("errors when no archived handoff matches the current repository state", async () => {
    const result = await runReapplyWithHarness([], {
      handoffs: [createArchivedHandoff()],
      matchingHandoffs: [],
    });

    expect(result.errors).toEqual([
      "No archived review handoff matches the current repository state for reapply.",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.reapplyCalls).toEqual([]);
    expect(result.spinnerStarts).toEqual(["Checking archived handoff matches..."]);
    expect(result.spinnerStops).toEqual(["Archived handoff scan complete."]);
  });

  test("reapplies the only archived handoff matching the current repository state", async () => {
    const result = await runReapplyWithHarness([], {
      handoffs: [createArchivedHandoff()],
    });

    expect(result.reapplyCalls).toEqual([
      {
        projectPath: process.cwd(),
        sessionId: "session-id",
        expectedCurrentFingerprint: "current-fingerprint-1",
      },
    ]);
    expect(result.steps).toEqual(["Reapplying handoff: session-id"]);
    expect(result.successes).toEqual(["Review handoff reapplied."]);
    expect(result.spinnerStarts).toEqual([
      "Checking archived handoff matches...",
      "Reapplying archived handoff...",
    ]);
    expect(result.spinnerStops).toEqual([
      "Archived handoff scan complete.",
      "Review handoff reapplied.",
    ]);
  });

  test("accepts a unique archived session id prefix", async () => {
    const result = await runReapplyWithHarness(["--session", "session-a"], {
      handoffs: [
        createArchivedHandoff({ sessionId: "session-alpha" }),
        createArchivedHandoff({ sessionId: "session-beta" }),
      ],
      matchingHandoffs: [],
    });

    expect(result.reapplyCalls).toEqual([
      {
        projectPath: process.cwd(),
        sessionId: "session-alpha",
      },
    ]);
    expect(result.listArchivedCalls).toEqual([process.cwd()]);
    expect(result.listMatchingCalls).toEqual([]);
    expect(result.reapplyCalls[0]?.expectedCurrentFingerprint).toBeUndefined();
  });

  test("surfaces archived state mismatch errors from reapply", async () => {
    await expect(
      runReapplyWithHarness(["--session", "session-id"], {
        handoffs: [createArchivedHandoff()],
        reapplyError: new Error(
          'Archived review handoff "session-id" cannot be reapplied because the current repository state does not match its source snapshot.'
        ),
      })
    ).rejects.toThrow(
      'Archived review handoff "session-id" cannot be reapplied because the current repository state does not match its source snapshot.'
    );
  });

  test("prompts when multiple archived handoffs match in an interactive terminal", async () => {
    const result = await runReapplyWithHarness([], {
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

    expect(result.selectMessages).toEqual(["Choose a review handoff to reapply"]);
    expect(result.reapplyCalls[0]?.sessionId).toBe("session-beta");
    expect(result.spinnerStarts[0]).toBe("Checking archived handoff matches...");
    expect(result.spinnerStops[0]).toBe("Archived handoff scan complete.");
  });

  test("returns without reapplying when interactive selection is cancelled", async () => {
    const result = await runReapplyWithHarness([], {
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

    expect(result.reapplyCalls).toEqual([]);
    expect(result.successes).toEqual([]);
  });

  test("errors when multiple archived handoffs match in a non-interactive terminal", async () => {
    const result = await runReapplyWithHarness([], {
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
