import { describe, expect, test } from "bun:test";
import type { RetainedSessionWorktree } from "@/lib/git";
import type { FindingId, FindingsArtifact } from "@/lib/review-workflow/findings/types";
import {
  type RunFixSessionDependencies,
  runFixSession,
} from "@/lib/review-workflow/remediation/run-fix-session";
import {
  createFindingsArtifact,
  createReviewWorkflowConfig,
} from "../../../helpers/review-workflow";

type BatchFixResult = NonNullable<
  NonNullable<Parameters<typeof createDependencies>[0]>["batchFixResults"]
>[number];

function createFixResult(
  findingId: FindingId,
  status: BatchFixResult["status"],
  summary: string
): BatchFixResult {
  return { findingId, status, summary };
}

function createFixSessionOptions(ids: FindingId[] = ["F001"]) {
  return {
    sessionId: "session-123",
    selector: {
      ids,
    },
    isTTY: false,
  };
}

async function runSelectedFixSession(deps: RunFixSessionDependencies, ids: FindingId[] = ["F001"]) {
  return await runFixSession(createReviewWorkflowConfig(), createFixSessionOptions(ids), deps);
}

function createRetainedArtifact(retainedWorktree: Partial<RetainedSessionWorktree> = {}) {
  return {
    ...createFindingsArtifact(),
    retainedWorktree: {
      worktreeProjectPath: "/tmp/retained-worktree",
      worktreeBranch: "rr-worktree-session-123",
      mergeReady: true,
      commitSha: "retained-commit-sha",
      ...retainedWorktree,
    },
  };
}

function expectRetainedWorktree(value: unknown) {
  expect(value).toEqual({
    worktreeProjectPath: "/tmp/worktree",
    worktreeBranch: "rr-worktree-session-123",
    mergeReady: true,
    commitSha: "retained-commit-sha",
  });
}

function createDependencies(
  state: {
    artifact?: FindingsArtifact;
    promptSelectionIds?: string[] | null;
    validateError?: Error;
    batchFixResults?: Array<{
      findingId: FindingId;
      status: "resolved" | "skipped" | "unresolved";
      summary: string;
    }>;
    finalizeSessionWorktreeResult?: RetainedSessionWorktree | null;
    discardedWorktrees?: string[];
    finalizedWorktrees?: string[];
    createdWorktreeStartPoints?: string[];
    retainedWorktreeUpdates?: Array<RetainedSessionWorktree | undefined>;
    finalizeResultHandoffWhenResolved?: boolean;
  } = {}
): RunFixSessionDependencies {
  const artifact = state.artifact ?? createFindingsArtifact();
  const worktree = {
    sourceProjectPath: artifact.projectPath,
    sourceRepoPath: artifact.projectPath,
    worktreeProjectPath: "/tmp/worktree",
    agentProjectPath: "/tmp/worktree",
    retainedBranch: "rr-worktree-session-123",
    headKind: "detached" as const,
    baselineCommitSha: artifact.baselineCommitSha,
    baselineRef: artifact.baselineRef,
    sourceBaselineFingerprint: artifact.sourceBaselineFingerprint,
  };

  return {
    loadFindingsArtifactBySessionId: async () => artifact,
    validateArtifactBaseline: async () => {
      if (state.validateError) {
        throw state.validateError;
      }

      return {
        baselineCommitSha: artifact.baselineCommitSha,
      };
    },
    createSessionWorktreeAt: (projectPath, worktreeId, baselineCommitSha) => {
      expect(projectPath).toBe(artifact.projectPath);
      expect(worktreeId).toBe(`${artifact.sessionId}-fix`);
      state.createdWorktreeStartPoints?.push(baselineCommitSha);
      return worktree;
    },
    updateSelection: async (_storageRoot, projectPath, sessionId, selectedFindingIds) => {
      expect(projectPath).toBe(artifact.projectPath);
      expect(sessionId).toBe(artifact.sessionId);
      return {
        ...artifact,
        selectedFindingIds,
      };
    },
    appendLog: async () => {},
    promptForSelection: async () =>
      (state.promptSelectionIds as FindingId[] | null | undefined) ?? null,
    runBatchFixPhase: async ({ selection }) => ({
      phase: "batch-fix",
      sessionStatus: "completed",
      fixResults:
        state.batchFixResults ??
        selection.selectedFindingIds.map((findingId) => ({
          findingId,
          status: "resolved" as const,
          summary: `Resolved ${findingId}`,
        })),
    }),
    appendFixResults: async (_storageRoot, _projectPath, _sessionId, fixResults) => ({
      ...artifact,
      fixResults,
    }),
    updateRetainedWorktree: async (_storageRoot, projectPath, sessionId, retainedWorktree) => {
      expect(projectPath).toBe(artifact.projectPath);
      expect(sessionId).toBe(artifact.sessionId);
      state.retainedWorktreeUpdates?.push(retainedWorktree);
      return {
        ...artifact,
        retainedWorktree,
      };
    },
    finalizeResult: async ({ artifact: finalizedArtifact, selection, fixResults }) => ({
      phase: "complete" as const,
      sessionStatus: "completed" as const,
      reviewOutcome: fixResults.some((result) => result.status === "unresolved")
        ? ("incomplete" as const)
        : ("fixed-selected" as const),
      reason:
        fixResults.some((result) => result.status === "unresolved") &&
        fixResults.some((result) => result.status === "resolved")
          ? "Some selected findings were resolved, but others remain unresolved. Ralph retained the remediation worktree instead of creating a handoff because the partial edits may be unsafe to apply automatically."
          : fixResults.some((result) => result.status === "unresolved")
            ? "Some selected findings remain unresolved after remediation."
            : fixResults.some((result) => result.status === "resolved")
              ? "Selected findings were resolved by remediation."
              : "Selected findings were skipped after verification.",
      artifact: finalizedArtifact,
      selection,
      fixResults,
      unresolvedSelectedFindings: artifact.findings.filter((finding) =>
        fixResults.some(
          (result) => result.findingId === finding.id && result.status === "unresolved"
        )
      ),
      unselectedFindings: artifact.findings.filter(
        (finding) => !selection.selectedFindingIds.includes(finding.id)
      ),
      handoffStatus:
        state.finalizeResultHandoffWhenResolved &&
        fixResults.some((result) => result.status === "resolved") &&
        !fixResults.some((result) => result.status === "unresolved")
          ? ("applied-auto" as const)
          : undefined,
      handoffId:
        state.finalizeResultHandoffWhenResolved &&
        fixResults.some((result) => result.status === "resolved") &&
        !fixResults.some((result) => result.status === "unresolved")
          ? "session-123-handoff-1"
          : undefined,
      handoffUpdatedAt:
        state.finalizeResultHandoffWhenResolved &&
        fixResults.some((result) => result.status === "resolved") &&
        !fixResults.some((result) => result.status === "unresolved")
          ? 123
          : undefined,
      commitSha:
        state.finalizeResultHandoffWhenResolved &&
        fixResults.some((result) => result.status === "resolved") &&
        !fixResults.some((result) => result.status === "unresolved")
          ? "handoff-commit-sha"
          : undefined,
    }),
    finalizeSessionWorktree: (currentWorktree) => {
      state.finalizedWorktrees?.push(currentWorktree.worktreeProjectPath);
      return Object.hasOwn(state, "finalizeSessionWorktreeResult")
        ? (state.finalizeSessionWorktreeResult ?? null)
        : {
            worktreeProjectPath: currentWorktree.worktreeProjectPath,
            worktreeBranch: currentWorktree.retainedBranch,
            mergeReady: true,
            commitSha: "retained-commit-sha",
          };
    },
    discardSessionWorktree: (currentWorktree) => {
      state.discardedWorktrees?.push(currentWorktree.worktreeProjectPath);
    },
  };
}

describe("review-workflow/remediation/runFixSession", () => {
  test("selects findings by explicit ids", async () => {
    const result = await runFixSession(
      createReviewWorkflowConfig(),
      {
        sessionId: "session-123",
        selector: {
          ids: ["F002"],
        },
        isTTY: false,
      },
      createDependencies()
    );

    expect(result.reviewOutcome).toBe("fixed-selected");
    expect(result.selection.selectedFindingIds).toEqual(["F002"]);
  });

  test("selects findings by priority union", async () => {
    const result = await runFixSession(
      createReviewWorkflowConfig(),
      {
        sessionId: "session-123",
        selector: {
          priorities: ["P0", "P2"],
        },
        isTTY: false,
      },
      createDependencies()
    );

    expect(result.selection.selectedFindingIds).toEqual(["F001", "F003"]);
  });

  test("fails with a clear error when selector modes are mixed", async () => {
    const result = await runFixSession(
      createReviewWorkflowConfig(),
      {
        sessionId: "session-123",
        selector: {
          all: true,
          ids: ["F001"],
        },
        isTTY: false,
      },
      createDependencies()
    );

    expect(result.sessionStatus).toBe("failed");
    expect(result.reason).toContain("mutually exclusive");
  });

  test("fails with guidance when no selector is provided in a non-interactive terminal", async () => {
    const result = await runFixSession(
      createReviewWorkflowConfig(),
      {
        sessionId: "session-123",
        isTTY: false,
      },
      createDependencies()
    );

    expect(result.sessionStatus).toBe("failed");
    expect(result.reason).toContain("Re-run with one of --all, --priority, or --id");
  });

  test("prompts interactively when no selector is provided in a tty", async () => {
    const result = await runFixSession(
      createReviewWorkflowConfig(),
      {
        sessionId: "session-123",
        isTTY: true,
      },
      createDependencies({
        promptSelectionIds: ["F001", "F003"],
      })
    );

    expect(result.selection.selectedFindingIds).toEqual(["F001", "F003"]);
  });

  test("keeps findings pending when interactive selection returns none", async () => {
    const result = await runFixSession(
      createReviewWorkflowConfig(),
      {
        sessionId: "session-123",
        isTTY: true,
      },
      createDependencies({
        promptSelectionIds: [],
      })
    );

    expect(result.sessionStatus).toBe("pending-user");
    expect(result.reviewOutcome).toBe("findings-pending");
  });

  test("fails before workspace creation when snapshot validation fails", async () => {
    const result = await runFixSession(
      createReviewWorkflowConfig(),
      {
        sessionId: "session-123",
        selector: {
          all: true,
        },
        isTTY: false,
      },
      createDependencies({
        validateError: new Error("Baseline commit baseline-sha-123 not found"),
      })
    );

    expect(result.sessionStatus).toBe("failed");
    expect(result.reason).toContain("Baseline commit baseline-sha-123 not found");
  });

  test("publishes remediation progress updates for session-state consumers", async () => {
    const updates: Array<Record<string, unknown>> = [];

    const result = await runFixSession(
      createReviewWorkflowConfig(),
      {
        sessionId: "session-123",
        selector: {
          ids: ["F001"],
        },
        isTTY: false,
        onProgress: async (nextUpdates) => {
          updates.push(nextUpdates as Record<string, unknown>);
        },
      },
      createDependencies()
    );

    expect(result.reviewOutcome).toBe("fixed-selected");
    expect(updates).toContainEqual({
      currentPhase: "selection",
      phase: "selection",
      sessionStatus: "running",
      currentAgent: null,
      selectedFindingIds: ["F001"],
    });
    expect(updates).toContainEqual({
      currentPhase: "selection",
      phase: "selection",
      sessionStatus: "running",
      currentAgent: null,
      worktreeProjectPath: "/tmp/worktree",
      worktreeBranch: "rr-worktree-session-123",
      selectedFindingIds: ["F001"],
      baselineCommitSha: "baseline-sha-123",
      sourceBaselineFingerprint: "tracked-fingerprint-1",
    });
    expect(updates).toContainEqual({
      currentPhase: "batch-fix",
      phase: "batch-fix",
      sessionStatus: "running",
      currentAgent: "fixer",
      selectedFindingIds: ["F001"],
    });
    expect(updates.at(-1)).toEqual({
      currentPhase: "complete",
      phase: "complete",
      sessionStatus: "completed",
      currentAgent: null,
      selectedFindingIds: ["F001"],
      reviewOutcome: "fixed-selected",
      handoffStatus: undefined,
      handoffUpdatedAt: undefined,
      commitSha: undefined,
    });
  });

  test("retains the worktree when remediation leaves selected findings unresolved", async () => {
    const finalizedWorktrees: string[] = [];
    const discardedWorktrees: string[] = [];
    const unresolvedResult = createFixResult(
      "F001",
      "unresolved",
      "Could not prove a safe remediation."
    );

    const result = await runSelectedFixSession(
      createDependencies({
        batchFixResults: [unresolvedResult],
        finalizedWorktrees,
        discardedWorktrees,
      })
    );

    expect(result.sessionStatus).toBe("completed");
    expect(result.phase).toBe("complete");
    expect(result.reviewOutcome).toBe("incomplete");
    expect(result.reason).toBe("Some selected findings remain unresolved after remediation.");
    expect(result.selection.selectedFindingIds).toEqual(["F001"]);
    expect(result.fixResults).toEqual([unresolvedResult]);
    expectRetainedWorktree(result.retainedWorktree);
    expect(finalizedWorktrees).toEqual(["/tmp/worktree"]);
    expect(discardedWorktrees).toEqual([]);
  });

  test("retains the worktree when remediation resolves some selected findings but leaves others unresolved", async () => {
    const finalizedWorktrees: string[] = [];
    const discardedWorktrees: string[] = [];

    const result = await runSelectedFixSession(
      createDependencies({
        batchFixResults: [
          createFixResult("F001", "resolved", "Resolved with a focused code change."),
          createFixResult("F002", "unresolved", "Skipped because the finding was not proven."),
        ],
        finalizedWorktrees,
        discardedWorktrees,
        finalizeResultHandoffWhenResolved: true,
      }),
      ["F001", "F002"]
    );

    expect(result.reviewOutcome).toBe("incomplete");
    expect(result.reason).toBe(
      "Some selected findings were resolved, but others remain unresolved. Ralph retained the remediation worktree instead of creating a handoff because the partial edits may be unsafe to apply automatically."
    );
    expect(result.handoffStatus).toBeUndefined();
    expectRetainedWorktree(result.retainedWorktree);
    expect(finalizedWorktrees).toEqual(["/tmp/worktree"]);
    expect(discardedWorktrees).toEqual([]);
  });

  test("does not retain the worktree when unresolved-only remediation has no changes", async () => {
    const finalizedWorktrees: string[] = [];
    const discardedWorktrees: string[] = [];
    const retainedWorktreeUpdates: Array<RetainedSessionWorktree | undefined> = [];

    const result = await runSelectedFixSession(
      createDependencies({
        batchFixResults: [
          createFixResult("F001", "unresolved", "Could not prove a safe remediation."),
        ],
        finalizeSessionWorktreeResult: null,
        finalizedWorktrees,
        discardedWorktrees,
        retainedWorktreeUpdates,
      })
    );

    expect(result.reviewOutcome).toBe("incomplete");
    expect(result.retainedWorktree).toBeUndefined();
    expect(finalizedWorktrees).toEqual(["/tmp/worktree"]);
    expect(retainedWorktreeUpdates).toEqual([]);
    expect(discardedWorktrees).toEqual(["/tmp/worktree"]);
  });

  test("does not retain the worktree when selected findings are skipped only", async () => {
    const finalizedWorktrees: string[] = [];
    const retainedWorktreeUpdates: Array<RetainedSessionWorktree | undefined> = [];

    const result = await runSelectedFixSession(
      createDependencies({
        batchFixResults: [createFixResult("F001", "skipped", "SKIP: false positive.")],
        finalizedWorktrees,
        retainedWorktreeUpdates,
      })
    );

    expect(result.reviewOutcome).toBe("fixed-selected");
    expect(result.reason).toBe("Selected findings were skipped after verification.");
    expect(result.retainedWorktree).toBeUndefined();
    expect(finalizedWorktrees).toEqual([]);
    expect(retainedWorktreeUpdates).toEqual([]);
  });

  test("persists the retained worktree metadata when remediation is incomplete", async () => {
    const retainedWorktreeUpdates: Array<RetainedSessionWorktree | undefined> = [];

    const result = await runSelectedFixSession(
      createDependencies({
        batchFixResults: [
          createFixResult("F001", "unresolved", "Could not prove a safe remediation."),
        ],
        retainedWorktreeUpdates,
      })
    );

    expect(result.reviewOutcome).toBe("incomplete");
    expect(retainedWorktreeUpdates).toEqual([
      {
        worktreeProjectPath: "/tmp/worktree",
        worktreeBranch: "rr-worktree-session-123",
        mergeReady: true,
        commitSha: "retained-commit-sha",
      },
    ]);
  });

  test("starts follow-up remediation from the retained partial-fix commit", async () => {
    const createdWorktreeStartPoints: string[] = [];
    const artifact = createRetainedArtifact();

    const result = await runSelectedFixSession(
      createDependencies({
        artifact,
        createdWorktreeStartPoints,
      })
    );

    expect(result.reviewOutcome).toBe("fixed-selected");
    expect(createdWorktreeStartPoints).toEqual(["retained-commit-sha"]);
  });

  test("fails instead of falling back to baseline when retained metadata has no commit", async () => {
    const createdWorktreeStartPoints: string[] = [];
    const artifact = createRetainedArtifact({ commitSha: undefined });

    const result = await runSelectedFixSession(
      createDependencies({
        artifact,
        createdWorktreeStartPoints,
        validateError: new Error("Retained remediation commit is missing"),
      })
    );

    expect(result.sessionStatus).toBe("failed");
    expect(result.reason).toContain("Retained remediation commit is missing");
    expect(createdWorktreeStartPoints).toEqual([]);
  });

  test("clears retained worktree metadata after a resumed remediation succeeds", async () => {
    const retainedWorktreeUpdates: Array<RetainedSessionWorktree | undefined> = [];
    const discardedWorktrees: string[] = [];
    const artifact = createRetainedArtifact();

    const result = await runSelectedFixSession(
      createDependencies({
        artifact,
        discardedWorktrees,
        retainedWorktreeUpdates,
      })
    );

    expect(result.reviewOutcome).toBe("fixed-selected");
    expect(retainedWorktreeUpdates).toEqual([undefined]);
    expect(discardedWorktrees).toEqual(["/tmp/retained-worktree", "/tmp/worktree"]);
  });
});
