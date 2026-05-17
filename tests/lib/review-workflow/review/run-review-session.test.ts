import { describe, expect, test } from "bun:test";
import type { RunReviewSessionDependencies } from "@/lib/review-workflow/review/run-review-session";
import { runReviewSession } from "@/lib/review-workflow/review/run-review-session";
import type { ReviewOptions } from "@/lib/types";
import {
  createAgentResult,
  createMockAgentRegistry,
  createReviewFinding,
  createReviewParse,
  createReviewSummary,
  createReviewWorkflowConfig,
  createSessionWorktree,
} from "../../../helpers/review-workflow";

function createDependencies(overrides: {
  runAgent: RunReviewSessionDependencies["runAgent"];
  createReviewerPrompt?: RunReviewSessionDependencies["createReviewerPrompt"];
  parseReviewSummaryOutput?: RunReviewSessionDependencies["parseReviewSummaryOutput"];
  deleteSessionRefs?: RunReviewSessionDependencies["deleteSessionRefs"];
  saveFindingsArtifact?: RunReviewSessionDependencies["saveFindingsArtifact"];
}): RunReviewSessionDependencies {
  return {
    createReviewerPrompt: overrides.createReviewerPrompt ?? (() => "REVIEW_PROMPT"),
    createReviewerSummaryRetryReminder: () => "RETRY_REMINDER",
    AGENTS: createMockAgentRegistry(["claude", "codex"]),
    runAgent: overrides.runAgent,
    createCheckpoint: () => ({ kind: "clean", id: "checkpoint-1" }),
    createSessionWorktree: () => createSessionWorktree(),
    deleteSessionRefs: overrides.deleteSessionRefs ?? (() => {}),
    discardCheckpoint: () => {},
    discardSessionWorktree: () => {},
    rollbackToCheckpoint: () => {},
    updateSessionState: async () => true,
    appendLog: async () => {},
    createLogSession: async () => "/tmp/session-123.jsonl",
    getGitBranch: async () => "main",
    parseReviewSummaryOutput: overrides.parseReviewSummaryOutput ?? (() => createReviewParse()),
    saveFindingsArtifact:
      overrides.saveFindingsArtifact ?? (async (_storageRoot, artifact) => artifact),
  };
}

async function runTestReviewSession(
  deps: RunReviewSessionDependencies,
  reviewOptions?: ReviewOptions,
  config = createReviewWorkflowConfig()
) {
  return await runReviewSession(
    config,
    reviewOptions,
    {
      projectPath: "/repo/project",
      sessionId: "session-123",
      sessionPath: "/tmp/session-123.jsonl",
    },
    () => false,
    deps
  );
}

function createArtifactRecorder() {
  const savedArtifacts: Array<{
    findings: Parameters<RunReviewSessionDependencies["saveFindingsArtifact"]>[1]["findings"];
  }> = [];

  return {
    savedArtifacts,
    saveFindingsArtifact: async (
      _storageRoot: string,
      artifact: Parameters<RunReviewSessionDependencies["saveFindingsArtifact"]>[1]
    ) => {
      savedArtifacts.push({ findings: artifact.findings });
      return artifact;
    },
  };
}

function createCacheReviewFinding() {
  return createReviewFinding({
    title: "Avoid stale cache",
    code_location: {
      absolute_file_path: "/repo/project/src/cache.ts",
      line_range: { start: 20, end: 22 },
    },
  });
}

function createTwoFindingParser() {
  let parseCalls = 0;

  return () => {
    parseCalls += 1;

    if (parseCalls === 1) {
      return createReviewParse(createReviewSummary([createReviewFinding()]));
    }

    if (parseCalls === 2) {
      return createReviewParse(createReviewSummary([createCacheReviewFinding()]));
    }

    throw new Error("parse failed after second iteration");
  };
}

function expectPreservedFinding(
  result: Awaited<ReturnType<typeof runTestReviewSession>>,
  savedArtifacts: Array<{
    findings: Parameters<RunReviewSessionDependencies["saveFindingsArtifact"]>[1]["findings"];
  }>
) {
  expect(result.result.artifact).toMatchObject({
    sessionId: "session-123",
    findings: [
      expect.objectContaining({
        id: "F001",
        filePath: "src/file.ts",
      }),
    ],
  });
  expect(savedArtifacts.length).toBeGreaterThanOrEqual(1);
  expect(savedArtifacts.at(-1)?.findings).toMatchObject([
    {
      id: "F001",
      filePath: "src/file.ts",
    },
  ]);
}

function expectPendingFailure(
  result: Awaited<ReturnType<typeof runTestReviewSession>>,
  iterations: number,
  reason: string
) {
  expect(result.result.sessionStatus).toBe("failed");
  expect(result.result.reviewOutcome).toBe("findings-pending");
  expect(result.result.iterations).toBe(iterations);
  expect(result.result.reason).toContain(reason);
}

describe("review-workflow/review/runReviewSession", () => {
  test("generates unique fallback session ids when runtime context omits sessionId", async () => {
    const createdWorktreeIds: string[] = [];
    const baseDeps = createDependencies({
      runAgent: async () => createAgentResult(),
    });
    const deps: RunReviewSessionDependencies = {
      ...baseDeps,
      createSessionWorktree: (projectPath, worktreeId, storageRoot) => {
        createdWorktreeIds.push(worktreeId);
        return baseDeps.createSessionWorktree(projectPath, worktreeId, storageRoot);
      },
    };

    await runReviewSession(
      createReviewWorkflowConfig(),
      undefined,
      { projectPath: "/repo/project", sessionPath: "/tmp/session-123.jsonl" },
      () => false,
      deps
    );
    await runReviewSession(
      createReviewWorkflowConfig(),
      undefined,
      { projectPath: "/repo/project", sessionPath: "/tmp/session-123.jsonl" },
      () => false,
      deps
    );

    expect(createdWorktreeIds).toHaveLength(2);
    expect(createdWorktreeIds[0]).not.toBe("session");
    expect(createdWorktreeIds[1]).not.toBe("session");
    expect(createdWorktreeIds[0]).not.toBe(createdWorktreeIds[1]);
  });

  test("classifies exit code 130 as interrupted even without parent SIGINT", async () => {
    const deps = createDependencies({
      runAgent: async () => createAgentResult({ success: false, exitCode: 130 }),
    });

    const result = await runTestReviewSession(deps);

    expect(result.result.sessionStatus).toBe("interrupted");
    expect(result.result.reviewOutcome).toBe("incomplete");
    expect(result.result.iterations).toBe(0);
  });

  test("preserves completed iteration count when reviewer parsing errors after progress", async () => {
    const artifactRecorder = createArtifactRecorder();
    const deletedSessionRefs: string[] = [];
    let parseCalls = 0;
    const deps = createDependencies({
      runAgent: async () => ({
        ...createAgentResult({ output: "structured output" }),
      }),
      parseReviewSummaryOutput: () => {
        parseCalls += 1;
        if (parseCalls === 1) {
          return createReviewParse(createReviewSummary([createReviewFinding()]));
        }
        throw new Error("parse failed after first iteration");
      },
      deleteSessionRefs: (_repoPath, sessionId) => {
        deletedSessionRefs.push(sessionId);
      },
      saveFindingsArtifact: artifactRecorder.saveFindingsArtifact,
    });

    const result = await runTestReviewSession(deps, { forceMaxIterations: true });

    expectPendingFailure(result, 1, "parse failed after first iteration");
    expect(result.result.reason).toContain("Findings were preserved");
    expect(result.result.findings).toEqual([
      expect.objectContaining({
        id: "F001",
        filePath: "src/file.ts",
      }),
    ]);
    expectPreservedFinding(result, artifactRecorder.savedArtifacts);
    expect(deletedSessionRefs).toEqual([]);
  });

  test("preserves accumulated findings when reviewer parsing errors after multiple iterations", async () => {
    const artifactRecorder = createArtifactRecorder();
    const deps = createDependencies({
      runAgent: async () => createAgentResult({ output: "structured output" }),
      parseReviewSummaryOutput: createTwoFindingParser(),
      saveFindingsArtifact: artifactRecorder.saveFindingsArtifact,
    });

    const result = await runTestReviewSession(deps, { forceMaxIterations: true });

    expectPendingFailure(result, 2, "parse failed after second iteration");
    expect(result.result.findings.map((finding) => finding.id)).toEqual(["F001", "F002"]);
    expect(artifactRecorder.savedArtifacts.at(-1)?.findings).toMatchObject([
      {
        id: "F001",
        filePath: "src/file.ts",
      },
      {
        id: "F002",
        filePath: "src/cache.ts",
      },
    ]);
  });

  test("saves findings artifact after a successful review iteration before the next reviewer run", async () => {
    const artifactRecorder = createArtifactRecorder();
    let runAgentCalls = 0;
    const deps = createDependencies({
      runAgent: async () => {
        runAgentCalls += 1;

        if (runAgentCalls === 2) {
          expect(artifactRecorder.savedArtifacts).toHaveLength(1);
          expect(artifactRecorder.savedArtifacts[0]?.findings).toMatchObject([
            {
              id: "F001",
              filePath: "src/file.ts",
            },
          ]);
        }

        return createAgentResult({ output: "structured output" });
      },
      parseReviewSummaryOutput: () =>
        createReviewParse(createReviewSummary([createReviewFinding()])),
      saveFindingsArtifact: artifactRecorder.saveFindingsArtifact,
    });

    await runTestReviewSession(
      deps,
      { forceMaxIterations: true },
      createReviewWorkflowConfig({ maxIterations: 2 })
    );

    expect(artifactRecorder.savedArtifacts.map((artifact) => artifact.findings.length)).toEqual([
      1, 1, 1,
    ]);
  });

  test("updates the same findings artifact with accumulated findings across iterations", async () => {
    const artifactRecorder = createArtifactRecorder();
    const deps = createDependencies({
      runAgent: async () => createAgentResult({ output: "structured output" }),
      parseReviewSummaryOutput: createTwoFindingParser(),
      saveFindingsArtifact: artifactRecorder.saveFindingsArtifact,
    });

    await runTestReviewSession(
      deps,
      { forceMaxIterations: true },
      createReviewWorkflowConfig({ maxIterations: 2 })
    );

    expect(
      artifactRecorder.savedArtifacts.map((artifact) =>
        artifact.findings.map((finding) => finding.id)
      )
    ).toEqual([["F001"], ["F001", "F002"], ["F001", "F002"]]);
  });

  test("preserves findings artifact when an interrupted reviewer run happens after progress", async () => {
    const artifactRecorder = createArtifactRecorder();
    const deletedSessionRefs: string[] = [];
    let runAgentCalls = 0;
    const deps = createDependencies({
      runAgent: async () => {
        runAgentCalls += 1;

        if (runAgentCalls === 1) {
          return createAgentResult({ output: "structured output" });
        }

        return createAgentResult({ success: false, exitCode: 130 });
      },
      parseReviewSummaryOutput: () =>
        createReviewParse(createReviewSummary([createReviewFinding()])),
      deleteSessionRefs: (_repoPath, sessionId) => {
        deletedSessionRefs.push(sessionId);
      },
      saveFindingsArtifact: artifactRecorder.saveFindingsArtifact,
    });

    const result = await runTestReviewSession(deps);

    expect(result.result.sessionStatus).toBe("interrupted");
    expect(result.result.reviewOutcome).toBe("findings-pending");
    expect(result.result.iterations).toBe(1);
    expect(result.result.reason).toContain("Findings were preserved");
    expectPreservedFinding(result, artifactRecorder.savedArtifacts);
    expect(deletedSessionRefs).toEqual([]);
  });

  test("keeps failed sessions incomplete when parsing fails before findings are preserved", async () => {
    const deps = createDependencies({
      runAgent: async () => createAgentResult({ output: "structured output" }),
      parseReviewSummaryOutput: () => {
        throw new Error("parse failed before findings");
      },
    });

    const result = await runTestReviewSession(deps);

    expect(result.result.sessionStatus).toBe("failed");
    expect(result.result.reviewOutcome).toBe("incomplete");
    expect(result.result.iterations).toBe(0);
    expect(result.result.findings).toEqual([]);
    expect(result.result.artifact).toBeUndefined();
  });

  test("builds codex reviewer runs from generated prompt without default review markdown", async () => {
    let capturedPromptOptions:
      | Parameters<RunReviewSessionDependencies["createReviewerPrompt"]>[0]
      | undefined;
    let runAgentCall:
      | {
          prompt: string;
          reviewOptions: ReviewOptions | undefined;
          cwd: string | undefined;
        }
      | undefined;
    const reviewOptions: ReviewOptions = {
      baseBranch: "main",
      customInstructions: "Focus on auth flows.",
    };
    const deps = createDependencies({
      createReviewerPrompt: (options) => {
        capturedPromptOptions = options;
        return "GENERATED_REVIEW_PROMPT";
      },
      runAgent: async (_role, _config, prompt, _timeout, forwardedReviewOptions, cwd) => {
        runAgentCall = {
          prompt: prompt ?? "",
          reviewOptions: forwardedReviewOptions,
          cwd,
        };

        return createAgentResult({ output: "structured output" });
      },
    });

    const result = await runTestReviewSession(
      deps,
      reviewOptions,
      createReviewWorkflowConfig({ reviewer: { agent: "codex" } })
    );

    expect(result.result.sessionStatus).toBe("completed");
    expect(capturedPromptOptions).toMatchObject({
      repoPath: "/tmp/worktree",
      baselineCommitSha: "baseline-sha-123",
      includeDefaultReviewPrompt: false,
      baseBranch: "main",
      customInstructions: "Focus on auth flows.",
    });
    expect(runAgentCall).toEqual({
      prompt: "GENERATED_REVIEW_PROMPT",
      reviewOptions,
      cwd: "/tmp/worktree",
    });
  });

  test("passes commitSha into codex reviewer prompt generation", async () => {
    let capturedPromptOptions:
      | Parameters<RunReviewSessionDependencies["createReviewerPrompt"]>[0]
      | undefined;
    const deps = createDependencies({
      createReviewerPrompt: (options) => {
        capturedPromptOptions = options;
        return "GENERATED_REVIEW_PROMPT";
      },
      runAgent: async () => createAgentResult({ output: "structured output" }),
    });

    const result = await runTestReviewSession(
      deps,
      { commitSha: "abc1234" },
      createReviewWorkflowConfig({ reviewer: { agent: "codex" } })
    );

    expect(result.result.sessionStatus).toBe("completed");
    expect(capturedPromptOptions?.commitSha).toBe("abc1234");
    expect(capturedPromptOptions?.includeDefaultReviewPrompt).toBe(false);
  });
});
