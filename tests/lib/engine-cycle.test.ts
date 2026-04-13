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
  persistedSnapshots: Array<{
    projectPath: string;
    sessionId: string;
    sourceSnapshotPath: string;
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
const TEST_REVIEWED_SNAPSHOT_PATH = "/tmp/rr-storage/snapshots/session-123/reviewed";

function createHarnessState(): HarnessState {
  return {
    runAgentCalls: [],
    runAgentResults: [],
    reviewParseQueue: [],
    appendedEntries: [],
    updateSessionStateCalls: [],
    savedArtifacts: [],
    persistedSnapshots: [],
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
    "code-simplifier": { agent: "claude" },
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
      absolute_file_path: `${TEST_REVIEWED_SNAPSHOT_PATH}/src/lib/config.ts`,
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
    source: "legacy-direct",
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
    sourceSnapshotDir: "/tmp/source-snapshot-dir",
    sourceFingerprint: "source-worktree-fingerprint",
  };

  return {
    createCodeSimplifierPrompt: ({ repoPath, baseBranch, commitSha, customInstructions }) => {
      state.operationLog.push("create-simplifier-prompt");
      return [
        "SIMPLIFIER",
        repoPath,
        baseBranch ?? "",
        commitSha ?? "",
        customInstructions ?? "",
      ].join("|");
    },
    createDiscoveryReviewerPrompt: ({
      reviewedSnapshotPath,
      iteration,
      knownFindings,
      customInstructions,
    }) => {
      return [
        `SNAPSHOT=${reviewedSnapshotPath}`,
        `ITERATION=${iteration}`,
        `KNOWN=${(knownFindings ?? []).map((finding) => finding.id).join(",")}`,
        customInstructions ? `CUSTOM=${customInstructions}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    },
    createFixerPrompt: () => {
      throw new Error("fixer prompt should not be used during discovery");
    },
    createFixerSummaryRetryReminder: () => "retry fixer",
    createReviewerPrompt: () => {
      throw new Error("legacy reviewer prompt should not be used during discovery");
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
    getGitBranch: async () => "feature/discovery",
    parseReviewSummaryOutput: () => {
      const next = state.reviewParseQueue.shift();
      if (!next) {
        throw new Error("No queued review parse result");
      }
      return next;
    },
    persistReviewedSnapshot: async (_storageRoot, projectPath, sessionId, sourceSnapshotPath) => {
      state.operationLog.push("persist-reviewed-snapshot");
      state.persistedSnapshots.push({
        projectPath,
        sessionId,
        sourceSnapshotPath,
      });
      return {
        reviewedSnapshotPath: TEST_REVIEWED_SNAPSHOT_PATH,
        sourceFingerprint: "snapshot-fingerprint",
      };
    },
    saveFindingsArtifact: async (_storageRoot, artifact) => {
      state.savedArtifacts.push(artifact);
      return artifact;
    },
    computeSnapshotFingerprint: async () => "snapshot-fingerprint",
  };
}

describe("runReviewCycle", () => {
  test("runs reviewer against the same frozen snapshot path, passes known findings forward, and persists findings", async () => {
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
    expect(new Set(reviewerCalls.map((call) => call.cwd))).toEqual(
      new Set([TEST_REVIEWED_SNAPSHOT_PATH])
    );
    expect(reviewerCalls[1]?.prompt).toContain("KNOWN=F001");
    expect(reviewerCalls[1]?.prompt).toContain("Focus on runtime failures.");

    expect(state.persistedSnapshots).toEqual([
      {
        projectPath: TEST_PROJECT_PATH,
        sessionId: TEST_SESSION_ID,
        sourceSnapshotPath: TEST_WORKTREE_PATH,
      },
    ]);

    expect(state.savedArtifacts).toHaveLength(1);
    expect(state.savedArtifacts[0]?.reviewedSnapshotPath).toBe(TEST_REVIEWED_SNAPSHOT_PATH);
    expect(state.savedArtifacts[0]?.sourceFingerprint).toBe("snapshot-fingerprint");
    expect(state.savedArtifacts[0]?.findings.map((finding) => finding.id)).toEqual(["F001"]);
    expect(state.savedArtifacts[0]?.selectedFindingIds).toEqual([]);

    const discoveryEntries = state.appendedEntries.filter(
      (entry) => entry.type === "discovery_iteration"
    );
    expect(discoveryEntries).toHaveLength(2);
    expect(discoveryEntries[0]?.netNewFindingIds).toEqual(["F001"]);
    expect(discoveryEntries[1]?.netNewFindingIds).toEqual([]);

    const sessionEnd = state.appendedEntries.find((entry) => entry.type === "session_end");
    expect(sessionEnd?.type).toBe("session_end");
    expect(sessionEnd?.phase).toBe("discovery");
    expect(sessionEnd?.sessionStatus).toBe("completed");
    expect(sessionEnd?.reviewOutcome).toBe("findings-pending");

    expect(
      state.updateSessionStateCalls.some(
        (call) => call.updates.phase === "discovery" && call.expectedSessionId === TEST_SESSION_ID
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

  test("returns clean and skips artifact persistence when discovery finds nothing new on the first pass", async () => {
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

  test("runs the simplifier before freezing the reviewed snapshot when enabled", async () => {
    const state = createHarnessState();
    queueRunAgentResults(
      state,
      createSuccessResult("simplifier-pass"),
      createSuccessResult("review-pass-1")
    );
    queueReviewParses(state, createReviewParse(createReviewSummary([])));

    const result = await runReviewCycle(
      createConfig(),
      undefined,
      {
        simplifier: true,
      },
      {
        projectPath: TEST_PROJECT_PATH,
        sessionId: TEST_SESSION_ID,
        sessionPath: TEST_SESSION_PATH,
      },
      createDependencies(state)
    );

    expect(result.reviewOutcome).toBe("clean");
    expect(state.runAgentCalls.map((call) => call.role)).toEqual(["code-simplifier", "reviewer"]);
    expect(state.persistedSnapshots).toEqual([
      {
        projectPath: TEST_PROJECT_PATH,
        sessionId: TEST_SESSION_ID,
        sourceSnapshotPath: TEST_WORKTREE_PATH,
      },
    ]);
    expect(state.operationLog.indexOf("run-agent:code-simplifier")).toBeLessThan(
      state.operationLog.indexOf("persist-reviewed-snapshot")
    );
    expect(state.operationLog.indexOf("persist-reviewed-snapshot")).toBeLessThan(
      state.operationLog.indexOf("run-agent:reviewer")
    );
  });
});
