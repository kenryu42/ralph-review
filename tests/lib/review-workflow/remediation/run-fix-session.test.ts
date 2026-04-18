import { describe, expect, test } from "bun:test";
import type { RetainedSessionWorktree } from "@/lib/git";
import type {
  FindingId,
  FindingsArtifact,
  StoredFinding,
} from "@/lib/review-workflow/findings/types";
import {
  type RunFixSessionDependencies,
  runFixSession,
} from "@/lib/review-workflow/remediation/run-fix-session";
import { CONFIG_SCHEMA_URI, CONFIG_VERSION, type Config } from "@/lib/types";

function createFinding(
  id: StoredFinding["id"],
  priority: StoredFinding["priority"]
): StoredFinding {
  return {
    id,
    fingerprint: `fp-${id}`,
    locationKey: `src/file-${id}.ts:10:12`,
    title: `Finding ${id}`,
    body: `Body for ${id}`,
    priority,
    confidenceScore: 0.91,
    filePath: `src/file-${id}.ts`,
    startLine: 10,
    endLine: 12,
  };
}

function createArtifact(): FindingsArtifact {
  return {
    artifactVersion: 1,
    sessionId: "session-123",
    projectPath: "/repo/project",
    logPath: "/tmp/session-123.jsonl",
    baselineRef: "refs/ralph-review/sessions/session-123/baseline",
    baselineCommitSha: "baseline-sha-123",
    sourceBaselineRef: "refs/ralph-review/sessions/session-123/source",
    sourceBaselineCommitSha: "source-baseline-sha-123",
    sourceBaselineFingerprint: "tracked-fingerprint-1",
    findings: [
      createFinding("F001", "P0"),
      createFinding("F002", "P1"),
      createFinding("F003", "P2"),
    ],
    selectedFindingIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function createConfig(): Config {
  return {
    $schema: CONFIG_SCHEMA_URI,
    version: CONFIG_VERSION,
    reviewer: { agent: "claude" },
    fixer: { agent: "claude" },
    maxIterations: 3,
    iterationTimeout: 10,
    defaultReview: { type: "uncommitted" },
    notifications: { sound: { enabled: false } },
  };
}

function createDependencies(
  state: {
    artifact?: FindingsArtifact;
    promptSelectionIds?: string[] | null;
    validateError?: Error;
    batchFixResults?: Array<{
      findingId: FindingId;
      status: "resolved" | "unresolved";
      summary: string;
    }>;
    finalizeSessionWorktreeResult?: RetainedSessionWorktree | null;
    discardedWorktrees?: string[];
    finalizedWorktrees?: string[];
  } = {}
): RunFixSessionDependencies {
  const artifact = state.artifact ?? createArtifact();
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
      expect(baselineCommitSha).toBe(artifact.baselineCommitSha);
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
    finalizeResult: async ({ artifact: finalizedArtifact, selection, fixResults }) => ({
      phase: "complete" as const,
      sessionStatus: "completed" as const,
      reviewOutcome: fixResults.some((result) => result.status === "unresolved")
        ? ("incomplete" as const)
        : ("fixed-selected" as const),
      reason: fixResults.some((result) => result.status === "unresolved")
        ? "Some selected findings remain unresolved after remediation."
        : "Selected findings were resolved by remediation.",
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
    }),
    finalizeSessionWorktree: (currentWorktree) => {
      state.finalizedWorktrees?.push(currentWorktree.worktreeProjectPath);
      return (
        state.finalizeSessionWorktreeResult ?? {
          worktreeProjectPath: currentWorktree.worktreeProjectPath,
          worktreeBranch: currentWorktree.retainedBranch,
          mergeReady: true,
          commitSha: "retained-commit-sha",
        }
      );
    },
    discardSessionWorktree: (currentWorktree) => {
      state.discardedWorktrees?.push(currentWorktree.worktreeProjectPath);
    },
  };
}

describe("review-workflow/remediation/runFixSession", () => {
  test("selects findings by explicit ids", async () => {
    const result = await runFixSession(
      createConfig(),
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
      createConfig(),
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
      createConfig(),
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
      createConfig(),
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
      createConfig(),
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
      createConfig(),
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
      createConfig(),
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
      createConfig(),
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

    const result = await runFixSession(
      createConfig(),
      {
        sessionId: "session-123",
        selector: {
          ids: ["F001"],
        },
        isTTY: false,
      },
      createDependencies({
        batchFixResults: [
          {
            findingId: "F001",
            status: "unresolved",
            summary: "Could not prove a safe remediation.",
          },
        ],
        finalizedWorktrees,
        discardedWorktrees,
      })
    );

    expect(result.sessionStatus).toBe("completed");
    expect(result.phase).toBe("complete");
    expect(result.reviewOutcome).toBe("incomplete");
    expect(result.reason).toBe("Some selected findings remain unresolved after remediation.");
    expect(result.selection.selectedFindingIds).toEqual(["F001"]);
    expect(result.fixResults).toEqual([
      {
        findingId: "F001",
        status: "unresolved",
        summary: "Could not prove a safe remediation.",
      },
    ]);
    expect(result.retainedWorktree).toEqual({
      worktreeProjectPath: "/tmp/worktree",
      worktreeBranch: "rr-worktree-session-123",
      mergeReady: true,
      commitSha: "retained-commit-sha",
    });
    expect(finalizedWorktrees).toEqual(["/tmp/worktree"]);
    expect(discardedWorktrees).toEqual([]);
  });
});
