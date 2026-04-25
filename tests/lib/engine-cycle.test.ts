import { describe, expect, test } from "bun:test";
import { CONFIG_DIR } from "@/lib/config";
import { runReviewCycle } from "@/lib/engine";
import type { GitCheckpoint, GitSessionWorktree } from "@/lib/git";
import { getFindingsArtifactPath } from "@/lib/review-workflow/findings/artifact";
import type { FindingsArtifact } from "@/lib/review-workflow/findings/types";
import type { StructuredParseResult } from "@/lib/structured-output";
import type {
  AgentRole,
  Config,
  IterationResult,
  LogEntry,
  ReviewOptions,
  ReviewSummary,
} from "@/lib/types";
import { CONFIG_SCHEMA_URI, CONFIG_VERSION } from "@/lib/types";

type RunReviewCycleDeps = NonNullable<Parameters<typeof runReviewCycle>[4]>;

interface RunAgentCall {
  role: AgentRole;
  prompt: string;
  timeout: number;
  reviewOptions?: ReviewOptions;
  cwd?: string;
}

interface SessionStateUpdateCall {
  updates: Record<string, unknown>;
  expectedSessionId?: string;
}

interface HarnessState {
  runAgentCalls: RunAgentCall[];
  runAgentResults: IterationResult[];
  reviewParseQueue: Array<StructuredParseResult<ReviewSummary>>;
  appendedEntries: LogEntry[];
  updateSessionStateCalls: SessionStateUpdateCall[];
  savedArtifacts: FindingsArtifact[];
  baselineCommitCalls: Array<{
    repoPath: string;
    sessionId: string;
  }>;
  createSessionWorktreeCalls: Array<{ projectPath: string; worktreeId: string }>;
  discardSessionWorktreeCalls: GitSessionWorktree[];
  createCheckpointCalls: Array<{ projectPath: string; label: string }>;
  rollbackCalls: Array<{ projectPath: string; checkpoint: GitCheckpoint }>;
  discardCheckpointCalls: Array<{ projectPath: string; checkpoint: GitCheckpoint }>;
  operationLog: string[];
}

const TEST_PROJECT_PATH = "/repo/project";
const TEST_SESSION_ID = "session-123";
const TEST_SESSION_PATH = "/tmp/session-123.jsonl";
const TEST_WORKTREE_PATH = "/tmp/rr-worktree";
const TEST_BASELINE_COMMIT_SHA = "baseline-sha-123";
const TEST_SOURCE_BASELINE_COMMIT_SHA = "source-baseline-sha-123";
const TEST_SOURCE_BASELINE_FINGERPRINT = "source-baseline-fingerprint-1";

function createHarnessState(): HarnessState {
  return {
    runAgentCalls: [],
    runAgentResults: [],
    reviewParseQueue: [],
    appendedEntries: [],
    updateSessionStateCalls: [],
    savedArtifacts: [],
    baselineCommitCalls: [],
    createSessionWorktreeCalls: [],
    discardSessionWorktreeCalls: [],
    createCheckpointCalls: [],
    rollbackCalls: [],
    discardCheckpointCalls: [],
    operationLog: [],
  };
}

function createConfig(overrides: Partial<Config> = {}): Config {
  return {
    $schema: CONFIG_SCHEMA_URI,
    version: CONFIG_VERSION,
    reviewer: { agent: "claude" },
    fixer: { agent: "claude" },
    maxIterations: 3,
    iterationTimeout: 10,
    retry: {
      maxRetries: 0,
      baseDelayMs: 0,
      maxDelayMs: 0,
    },
    defaultReview: { type: "uncommitted" },
    notifications: { sound: { enabled: false } },
    ...overrides,
  };
}

function createReviewSummary(findings: ReviewSummary["findings"]): ReviewSummary {
  return {
    findings,
    overall_correctness: findings.length === 0 ? "patch is correct" : "patch is incorrect",
    overall_explanation:
      findings.length === 0 ? "No additional issues found." : "Additional issues remain.",
    overall_confidence_score: 0.91,
  };
}

function createFinding(): ReviewSummary["findings"][number] {
  return {
    title: "Guard undefined config",
    body: "Optional config access can throw when the field is missing.",
    confidence_score: 0.92,
    priority: 1,
    code_location: {
      absolute_file_path: `${TEST_WORKTREE_PATH}/src/lib/config.ts`,
      line_range: {
        start: 10,
        end: 12,
      },
    },
  };
}

function createReviewParse(value: ReviewSummary): StructuredParseResult<ReviewSummary> {
  return {
    ok: true,
    value,
    source: "framed-raw",
    usedRepair: false,
    failureReason: null,
  };
}

function createSuccessResult(output: string): IterationResult {
  return {
    success: true,
    output,
    exitCode: 0,
    duration: 1,
  };
}

function queueReviewParses(
  state: HarnessState,
  ...parses: Array<StructuredParseResult<ReviewSummary>>
): void {
  state.reviewParseQueue.push(...parses);
}

function queueRunAgentResults(state: HarnessState, ...results: IterationResult[]): void {
  state.runAgentResults.push(...results);
}

function createDependencies(state: HarnessState): RunReviewCycleDeps {
  const worktree: GitSessionWorktree = {
    sourceProjectPath: TEST_PROJECT_PATH,
    sourceRepoPath: "/repo",
    worktreeProjectPath: TEST_WORKTREE_PATH,
    agentProjectPath: TEST_WORKTREE_PATH,
    retainedBranch: "rr-worktree-session-123",
    headKind: "detached",
    baselineCommitSha: TEST_BASELINE_COMMIT_SHA,
    baselineRef: "refs/ralph-review/sessions/session-123/baseline",
    sourceBaselineCommitSha: TEST_SOURCE_BASELINE_COMMIT_SHA,
    sourceBaselineRef: "refs/ralph-review/sessions/session-123/source",
    sourceBaselineFingerprint: TEST_SOURCE_BASELINE_FINGERPRINT,
  };

  return {
    createReviewerPrompt: ({ baselineCommitSha, iteration, knownFindings, customInstructions }) => {
      return [
        `BASELINE=${baselineCommitSha}`,
        `ITERATION=${iteration}`,
        `KNOWN=${(knownFindings ?? []).map((finding) => finding.id).join(",")}`,
        customInstructions ? `CUSTOM=${customInstructions}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    },
    createFixerPrompt: () => {
      throw new Error("fixer prompt should not be used during review");
    },
    createFixerSummaryRetryReminder: () => "retry fixer",
    createTargetedReviewPrompt: () => {
      throw new Error("alternate reviewer prompt should not be used during review");
    },
    createReviewerSummaryRetryReminder: () => "retry reviewer",
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
    } as unknown as RunReviewCycleDeps["AGENTS"],
    runAgent: async (role, _config, prompt, timeout, reviewOptions, cwd) => {
      state.runAgentCalls.push({
        role,
        prompt: prompt ?? "",
        timeout: timeout ?? 0,
        reviewOptions,
        cwd,
      });
      state.operationLog.push(`run-agent:${role}`);

      const next = state.runAgentResults.shift();
      if (!next) {
        throw new Error(`No queued agent result for ${role}`);
      }

      return next;
    },
    createCheckpoint: (projectPath, label) => {
      state.createCheckpointCalls.push({ projectPath, label });
      return {
        kind: "snapshot",
        id: label,
        snapshotDir: `${projectPath}/checkpoint-${label}`,
      };
    },
    createSessionWorktree: (projectPath, worktreeId) => {
      state.createSessionWorktreeCalls.push({ projectPath, worktreeId });
      return worktree;
    },
    deleteSessionRefs: () => {
      state.operationLog.push("delete-session-refs");
    },
    discardCheckpoint: (projectPath, checkpoint) => {
      state.discardCheckpointCalls.push({ projectPath, checkpoint });
    },
    discardSessionWorktree: (createdWorktree) => {
      state.discardSessionWorktreeCalls.push(createdWorktree);
    },
    rollbackToCheckpoint: (projectPath, checkpoint) => {
      state.rollbackCalls.push({ projectPath, checkpoint });
    },
    createOrAutoApplyHandoff: async () => null,
    updateSessionState: async (_storageRoot, _projectPath, _sessionId, updates, options) => {
      state.updateSessionStateCalls.push({
        updates: updates as Record<string, unknown>,
        expectedSessionId: options?.expectedSessionId,
      });
      return true;
    },
    appendLog: async (_logPath, entry) => {
      state.appendedEntries.push(entry);
    },
    createLogSession: async () => TEST_SESSION_PATH,
    getGitBranch: async () => "feature/review",
    parseReviewSummaryOutput: () => {
      const next = state.reviewParseQueue.shift();
      if (!next) {
        throw new Error("No queued review parse result");
      }
      return next;
    },
    saveFindingsArtifact: async (_storageRoot, artifact) => {
      state.savedArtifacts.push(artifact);
      return artifact;
    },
  };
}

describe("runReviewCycle", () => {
  test("runs reviewer against the same baseline worktree, passes known findings forward, and persists findings", async () => {
    const state = createHarnessState();
    queueRunAgentResults(
      state,
      createSuccessResult("review-pass-1"),
      createSuccessResult("review-pass-2")
    );
    queueReviewParses(
      state,
      createReviewParse(createReviewSummary([createFinding()])),
      createReviewParse(createReviewSummary([createFinding()]))
    );

    const result = await runReviewCycle(
      createConfig({ maxIterations: 4 }),
      undefined,
      {
        customInstructions: "Focus on runtime failures.",
      },
      {
        projectPath: TEST_PROJECT_PATH,
        sessionId: TEST_SESSION_ID,
        sessionPath: TEST_SESSION_PATH,
      },
      createDependencies(state)
    );

    expect(result.success).toBe(true);
    expect(result.finalStatus).toBe("completed");
    expect(result.reviewOutcome).toBe("findings-pending");
    expect(result.iterations).toBe(2);
    expect(result.sessionPath).toBe(TEST_SESSION_PATH);

    const reviewerCalls = state.runAgentCalls.filter((call) => call.role === "reviewer");
    expect(reviewerCalls).toHaveLength(2);
    expect(state.runAgentCalls.some((call) => call.role === "fixer")).toBe(false);
    expect(new Set(reviewerCalls.map((call) => call.cwd))).toEqual(new Set([TEST_WORKTREE_PATH]));
    expect(reviewerCalls[1]?.prompt).toContain("KNOWN=F001");
    expect(reviewerCalls[1]?.prompt).toContain("Focus on runtime failures.");

    expect(state.savedArtifacts).toHaveLength(1);
    expect(state.savedArtifacts[0]?.baselineCommitSha).toBe(TEST_BASELINE_COMMIT_SHA);
    expect(state.savedArtifacts[0]?.sourceBaselineCommitSha).toBe(TEST_SOURCE_BASELINE_COMMIT_SHA);
    expect(state.savedArtifacts[0]?.sourceBaselineFingerprint).toBe(
      TEST_SOURCE_BASELINE_FINGERPRINT
    );
    expect(state.savedArtifacts[0]?.findings.map((finding) => finding.id)).toEqual(["F001"]);
    expect(state.savedArtifacts[0]?.selectedFindingIds).toEqual([]);

    const reviewEntries = state.appendedEntries.filter(
      (entry) => entry.type === "review_iteration"
    );
    expect(reviewEntries).toHaveLength(2);
    expect(reviewEntries[0]?.netNewFindingIds).toEqual(["F001"]);
    expect(reviewEntries[1]?.netNewFindingIds).toEqual([]);

    const sessionEnd = state.appendedEntries.find((entry) => entry.type === "session_end");
    expect(sessionEnd?.type).toBe("session_end");
    expect(sessionEnd?.phase).toBe("review");
    expect(sessionEnd?.sessionStatus).toBe("completed");
    expect(sessionEnd?.reviewOutcome).toBe("findings-pending");

    expect(
      state.updateSessionStateCalls.some(
        (call) => call.updates.phase === "review" && call.expectedSessionId === TEST_SESSION_ID
      )
    ).toBe(true);
    expect(
      state.updateSessionStateCalls.some(
        (call) =>
          call.updates.reviewOutcome === "findings-pending" &&
          call.updates.artifactPath ===
            getFindingsArtifactPath(CONFIG_DIR, TEST_PROJECT_PATH, TEST_SESSION_ID)
      )
    ).toBe(true);
  });

  test("returns clean and skips artifact persistence when review finds nothing new on the first pass", async () => {
    const state = createHarnessState();
    queueRunAgentResults(state, createSuccessResult("review-pass-1"));
    queueReviewParses(state, createReviewParse(createReviewSummary([])));

    const result = await runReviewCycle(
      createConfig(),
      undefined,
      undefined,
      {
        projectPath: TEST_PROJECT_PATH,
        sessionId: TEST_SESSION_ID,
        sessionPath: TEST_SESSION_PATH,
      },
      createDependencies(state)
    );

    expect(result.success).toBe(true);
    expect(result.finalStatus).toBe("completed");
    expect(result.reviewOutcome).toBe("clean");
    expect(result.iterations).toBe(1);
    expect(state.savedArtifacts).toHaveLength(0);
    expect(state.runAgentCalls.filter((call) => call.role === "reviewer")).toHaveLength(1);

    const sessionEnd = state.appendedEntries.find((entry) => entry.type === "session_end");
    expect(sessionEnd?.reviewOutcome).toBe("clean");
  });

  test("runs review directly with the reviewer and keeps the original baseline", async () => {
    const state = createHarnessState();
    queueRunAgentResults(state, createSuccessResult("review-pass-1"));
    queueReviewParses(state, createReviewParse(createReviewSummary([])));

    const result = await runReviewCycle(
      createConfig(),
      undefined,
      undefined,
      {
        projectPath: TEST_PROJECT_PATH,
        sessionId: TEST_SESSION_ID,
        sessionPath: TEST_SESSION_PATH,
      },
      createDependencies(state)
    );

    expect(result.reviewOutcome).toBe("clean");
    expect(state.runAgentCalls.map((call) => call.role)).toEqual(["reviewer"]);
    expect(state.baselineCommitCalls).toEqual([]);
  });
});
