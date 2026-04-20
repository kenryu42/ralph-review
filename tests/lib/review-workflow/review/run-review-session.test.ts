import { describe, expect, test } from "bun:test";
import type { RunReviewSessionDependencies } from "@/lib/review-workflow/review/run-review-session";
import { runReviewSession } from "@/lib/review-workflow/review/run-review-session";
import { CONFIG_SCHEMA_URI, CONFIG_VERSION, type Config, type ReviewSummary } from "@/lib/types";

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

function createDependencies(overrides: {
  runAgent: RunReviewSessionDependencies["runAgent"];
  computeWorkingTreeFingerprintAsync?: RunReviewSessionDependencies["computeWorkingTreeFingerprintAsync"];
  parseReviewSummaryOutput?: RunReviewSessionDependencies["parseReviewSummaryOutput"];
}): RunReviewSessionDependencies {
  const emptySummary: ReviewSummary = {
    findings: [],
    overall_correctness: "patch is correct",
    overall_explanation: "No actionable findings",
    overall_confidence_score: 0.9,
  };

  return {
    createReviewerPrompt: () => "REVIEW_PROMPT",
    createReviewerSummaryRetryReminder: () => "RETRY_REMINDER",
    AGENTS: {
      claude: {
        config: {
          command: "mock",
          buildArgs: () => [],
          buildEnv: () => ({}),
        },
        extractResult: async (output: string) => output,
        detectSessionId: () => null,
        getUpdateInstructions: () => [],
      },
    } as unknown as RunReviewSessionDependencies["AGENTS"],
    runAgent: overrides.runAgent,
    createCheckpoint: () => ({ kind: "clean", id: "checkpoint-1" }),
    computeWorkingTreeFingerprintAsync:
      overrides.computeWorkingTreeFingerprintAsync ?? (async () => "baseline-fingerprint"),
    createSessionWorktree: () => ({
      sourceProjectPath: "/repo/project",
      sourceRepoPath: "/repo/project",
      worktreeProjectPath: "/tmp/worktree",
      agentProjectPath: "/tmp/worktree",
      retainedBranch: "rr-worktree-session-123",
      headKind: "detached",
      baselineCommitSha: "baseline-sha-123",
      baselineRef: "refs/ralph-review/sessions/session-123/baseline",
      sourceBaselineCommitSha: "source-baseline-sha-123",
      sourceBaselineRef: "refs/ralph-review/sessions/session-123/source",
      sourceBaselineFingerprint: "baseline-fingerprint",
    }),
    deleteSessionRefs: () => {},
    discardCheckpoint: () => {},
    discardSessionWorktree: () => {},
    rollbackToCheckpoint: () => {},
    updateSessionState: async () => true,
    appendLog: async () => {},
    createLogSession: async () => "/tmp/session-123.jsonl",
    getGitBranch: async () => "main",
    parseReviewSummaryOutput:
      overrides.parseReviewSummaryOutput ??
      (() => ({
        ok: true,
        value: emptySummary,
        source: "legacy-direct",
        usedRepair: false,
        failureReason: null,
      })),
    saveFindingsArtifact: async (_storageRoot, artifact) => artifact,
  };
}

describe("review-workflow/review/runReviewSession", () => {
  test("classifies exit code 130 as interrupted even without parent SIGINT", async () => {
    const deps = createDependencies({
      runAgent: async () => ({
        success: false,
        output: "",
        exitCode: 130,
        duration: 1,
      }),
    });

    const result = await runReviewSession(
      createConfig(),
      undefined,
      {
        projectPath: "/repo/project",
        sessionId: "session-123",
        sessionPath: "/tmp/session-123.jsonl",
      },
      () => false,
      deps
    );

    expect(result.result.sessionStatus).toBe("interrupted");
    expect(result.result.reviewOutcome).toBe("incomplete");
    expect(result.result.iterations).toBe(0);
  });

  test("preserves completed iteration count when review phase errors after progress", async () => {
    const deps = createDependencies({
      runAgent: async () => ({
        success: true,
        output: "structured output",
        exitCode: 0,
        duration: 1,
      }),
      computeWorkingTreeFingerprintAsync: async () => "mismatched-fingerprint",
    });

    const result = await runReviewSession(
      createConfig(),
      undefined,
      {
        projectPath: "/repo/project",
        sessionId: "session-123",
        sessionPath: "/tmp/session-123.jsonl",
      },
      () => false,
      deps
    );

    expect(result.result.sessionStatus).toBe("failed");
    expect(result.result.reviewOutcome).toBe("incomplete");
    expect(result.result.iterations).toBe(1);
  });
});
