import { describe, expect, test } from "bun:test";
import { runReviewCycle } from "@/lib/engine";
import type { GitCheckpoint } from "@/lib/git";
import type { StructuredParseResult } from "@/lib/structured-output";
import {
  type AgentRole,
  CONFIG_SCHEMA_URI,
  CONFIG_VERSION,
  type Config,
  type FixSummary,
  type IterationResult,
  type LogEntry,
  type ReviewOptions,
  type ReviewSummary,
} from "@/lib/types";
import { buildFixSummary } from "../test-utils/fix-summary";

const TEST_PROJECT_PATH = "/tmp/engine-cycle-project";
const TEST_SESSION_PATH = "/tmp/engine-cycle-session.jsonl";
const TEST_SESSION_ID = "engine-cycle-session-id";

type RunReviewCycleDeps = NonNullable<Parameters<typeof runReviewCycle>[4]>;

interface RunAgentCall {
  role: AgentRole;
  prompt: string;
  timeout: number;
  reviewOptions?: ReviewOptions;
}

interface LockfileUpdateCall {
  projectPath: string;
  updates: Record<string, unknown>;
  expectedSessionId?: string;
}

interface AgentResultStep {
  type: "result";
  result: IterationResult;
}

interface AgentThrowStep {
  type: "throw";
  error: unknown;
}

type AgentStep = AgentResultStep | AgentThrowStep;

interface HarnessState {
  runAgentCalls: RunAgentCall[];
  runAgentSteps: AgentStep[];
  appendedEntries: LogEntry[];
  updateLockfileCalls: LockfileUpdateCall[];
  createCheckpointCalls: Array<{ projectPath: string; label: string }>;
  rollbackCalls: Array<{ projectPath: string; checkpoint: GitCheckpoint }>;
  discardCalls: Array<{ projectPath: string; checkpoint: GitCheckpoint }>;
  reviewParseQueue: Array<StructuredParseResult<ReviewSummary>>;
  fixParseQueue: Array<StructuredParseResult<FixSummary>>;
  createCheckpointError: Error | null;
  rollbackError: Error | null;
  discardError: Error | null;
  updateLockfileFailuresRemaining: number;
  onRunAgent?: (role: AgentRole) => void;
  onAppendLog?: (entry: LogEntry) => void;
  capturedSigintHandler?: () => void;
}

function createHarnessState(): HarnessState {
  return {
    runAgentCalls: [],
    runAgentSteps: [],
    appendedEntries: [],
    updateLockfileCalls: [],
    createCheckpointCalls: [],
    rollbackCalls: [],
    discardCalls: [],
    reviewParseQueue: [],
    fixParseQueue: [],
    createCheckpointError: null,
    rollbackError: null,
    discardError: null,
    updateLockfileFailuresRemaining: 0,
    onRunAgent: undefined,
    onAppendLog: undefined,
    capturedSigintHandler: undefined,
  };
}

function parseReviewSuccess(
  value: ReviewSummary,
  usedRepair = false
): StructuredParseResult<ReviewSummary> {
  return {
    ok: true,
    value,
    source: "legacy-direct",
    usedRepair,
    failureReason: null,
  };
}

function parseReviewFailure(reason: string): StructuredParseResult<ReviewSummary> {
  return {
    ok: false,
    value: null,
    source: null,
    usedRepair: false,
    failureReason: reason,
  };
}

function parseFixSuccess(value: FixSummary, usedRepair = false): StructuredParseResult<FixSummary> {
  return {
    ok: true,
    value,
    source: "legacy-direct",
    usedRepair,
    failureReason: null,
  };
}

function parseFixFailure(reason: string): StructuredParseResult<FixSummary> {
  return {
    ok: false,
    value: null,
    source: null,
    usedRepair: false,
    failureReason: reason,
  };
}

function resultStep(result: IterationResult): AgentResultStep {
  return {
    type: "result",
    result,
  };
}

function throwStep(error: unknown): AgentThrowStep {
  return {
    type: "throw",
    error,
  };
}

function successResult(output: string): IterationResult {
  return {
    success: true,
    output,
    exitCode: 0,
    duration: 1,
  };
}

function failureResult(output: string, exitCode = 1): IterationResult {
  return {
    success: false,
    output,
    exitCode,
    duration: 1,
  };
}

function buildReviewSummary(): ReviewSummary {
  return {
    findings: [
      {
        title: "Example finding",
        body: "Something needs attention",
        confidence_score: 0.9,
        priority: 1,
        code_location: {
          absolute_file_path: "/repo/src/example.ts",
          line_range: {
            start: 10,
            end: 12,
          },
        },
      },
    ],
    overall_correctness: "patch is incorrect",
    overall_explanation: "Review summary explanation",
    overall_confidence_score: 0.82,
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

function queueRunAgentSteps(state: HarnessState, ...steps: AgentStep[]): void {
  state.runAgentSteps.push(...steps);
}

function queueReviewParses(
  state: HarnessState,
  ...parses: Array<StructuredParseResult<ReviewSummary>>
): void {
  state.reviewParseQueue.push(...parses);
}

function queueFixParses(
  state: HarnessState,
  ...parses: Array<StructuredParseResult<FixSummary>>
): void {
  state.fixParseQueue.push(...parses);
}

function triggerInterrupt(state: HarnessState): void {
  if (!state.capturedSigintHandler) {
    throw new Error("SIGINT handler was not registered");
  }
  state.capturedSigintHandler();
}

function createDependencies(state: HarnessState): RunReviewCycleDeps {
  const agentStub = {
    config: {
      command: "mock-agent",
      buildArgs: () => [],
      buildEnv: () => ({}),
    },
    usesJsonl: false,
    extractResult: (output: string) => output.trim() || null,
  };

  return {
    createCodeSimplifierPrompt: () => "SIMPLIFIER_PROMPT",
    createFixerPrompt: (reviewText: string) => `FIXER_PROMPT:${reviewText}`,
    createFixerSummaryRetryReminder: () => "FIXER_SUMMARY_RETRY_REMINDER",
    createReviewerPrompt: () => "REVIEWER_PROMPT",
    createReviewerSummaryRetryReminder: () => "REVIEWER_SUMMARY_RETRY_REMINDER",
    AGENTS: {
      claude: agentStub,
      codex: agentStub,
      droid: agentStub,
      gemini: agentStub,
      opencode: agentStub,
      pi: agentStub,
    },
    runAgent: async (
      role: AgentRole,
      _config: Config,
      prompt = "",
      timeout = 0,
      reviewOptions?: ReviewOptions
    ): Promise<IterationResult> => {
      state.runAgentCalls.push({
        role,
        prompt,
        timeout,
        reviewOptions,
      });
      state.onRunAgent?.(role);

      const nextStep = state.runAgentSteps.shift();
      if (!nextStep) {
        throw new Error(`runAgent queue exhausted for role: ${role}`);
      }

      if (nextStep.type === "throw") {
        throw nextStep.error;
      }

      return nextStep.result;
    },
    createCheckpoint: (projectPath: string, label: string): GitCheckpoint => {
      state.createCheckpointCalls.push({ projectPath, label });

      if (state.createCheckpointError) {
        throw state.createCheckpointError;
      }

      return {
        kind: "clean",
        id: `checkpoint-${state.createCheckpointCalls.length}`,
      };
    },
    rollbackToCheckpoint: (projectPath: string, checkpoint: GitCheckpoint) => {
      state.rollbackCalls.push({ projectPath, checkpoint });
      if (state.rollbackError) {
        throw state.rollbackError;
      }
    },
    discardCheckpoint: (projectPath: string, checkpoint: GitCheckpoint) => {
      state.discardCalls.push({ projectPath, checkpoint });
      if (state.discardError) {
        throw state.discardError;
      }
    },
    updateLockfile: async (
      _logsDir: string | undefined,
      projectPath: string,
      updates: Record<string, unknown>,
      lockfileOptions?: { expectedSessionId?: string }
    ) => {
      state.updateLockfileCalls.push({
        projectPath,
        updates,
        expectedSessionId: lockfileOptions?.expectedSessionId,
      });

      if (state.updateLockfileFailuresRemaining > 0) {
        state.updateLockfileFailuresRemaining -= 1;
        throw new Error("lockfile update failed");
      }

      return true;
    },
    getGitBranch: async () => "feature/engine-coverage",
    createLogSession: async () => TEST_SESSION_PATH,
    appendLog: async (_sessionPath: string, entry: LogEntry) => {
      state.appendedEntries.push(entry);
      state.onAppendLog?.(entry);
    },
    parseReviewSummaryOutput: (_resultText: string | null, _rawOutput: string) => {
      return state.reviewParseQueue.shift() ?? parseReviewFailure("mock review parse failure");
    },
    parseFixSummaryOutput: (_resultText: string | null, _rawOutput: string) => {
      return state.fixParseQueue.shift() ?? parseFixFailure("mock fix parse failure");
    },
  };
}

async function withHarness(run: (state: HarnessState, deps: RunReviewCycleDeps) => Promise<void>) {
  const state = createHarnessState();
  const deps = createDependencies(state);
  const originalProcessOn = process.on;
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;

  process.on = ((event: string, listener: (...args: unknown[]) => void) => {
    if (event === "SIGINT") {
      state.capturedSigintHandler = () => listener();
      return process;
    }

    return originalProcessOn.call(process, event, listener);
  }) as typeof process.on;
  console.log = (() => {}) as typeof console.log;
  console.warn = (() => {}) as typeof console.warn;

  try {
    await run(state, deps);
  } finally {
    process.on = originalProcessOn;
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
  }
}

describe("runReviewCycle", () => {
  test("completes successfully when reviewer and fixer return clean stop_iteration result", async () => {
    await withHarness(async (state, deps) => {
      const reviewSummary = buildReviewSummary();
      const cleanFixSummary = buildFixSummary({
        decision: "NO_CHANGES_NEEDED",
        stop_iteration: true,
        fixes: [],
        skipped: [],
      });
      const iterationRoles: AgentRole[] = [];

      queueRunAgentSteps(
        state,
        resultStep(successResult("review output")),
        resultStep(successResult("fix output"))
      );
      queueReviewParses(state, parseReviewSuccess(reviewSummary, true));
      queueFixParses(state, parseFixSuccess(cleanFixSummary, true));

      const result = await runReviewCycle(
        createConfig(),
        (_iteration, role) => {
          iterationRoles.push(role);
        },
        undefined,
        {
          projectPath: TEST_PROJECT_PATH,
          sessionId: TEST_SESSION_ID,
        },
        deps
      );

      expect(result.success).toBe(true);
      expect(result.finalStatus).toBe("completed");
      expect(result.iterations).toBe(1);
      expect(result.reason).toContain("No issues found");
      expect(result.sessionPath).toBe(TEST_SESSION_PATH);

      expect(state.runAgentCalls.map((call) => call.role)).toEqual(["reviewer", "fixer"]);
      expect(iterationRoles).toEqual(["reviewer", "fixer"]);
      expect(
        state.updateLockfileCalls.some((call) => call.updates.reviewSummary !== undefined)
      ).toBe(true);

      const iterationEntry = state.appendedEntries.find((entry) => entry.type === "iteration");
      expect(iterationEntry?.type).toBe("iteration");
      if (iterationEntry?.type === "iteration") {
        expect(iterationEntry.review).toEqual(reviewSummary);
        expect(iterationEntry.fixes?.decision).toBe("NO_CHANGES_NEEDED");
      }

      const sessionEnd = state.appendedEntries.at(-1);
      expect(sessionEnd?.type).toBe("session_end");
      if (sessionEnd?.type === "session_end") {
        expect(sessionEnd.status).toBe("completed");
      }
    });
  });

  test("retries reviewer once and succeeds when retry budget is available", async () => {
    await withHarness(async (state, deps) => {
      queueRunAgentSteps(
        state,
        resultStep(failureResult("initial reviewer failure", 42)),
        resultStep(successResult("review output")),
        resultStep(successResult("fix output"))
      );
      queueReviewParses(state, parseReviewSuccess(buildReviewSummary()));
      queueFixParses(
        state,
        parseFixSuccess(
          buildFixSummary({
            decision: "NO_CHANGES_NEEDED",
            stop_iteration: true,
            fixes: [],
            skipped: [],
          })
        )
      );

      const result = await runReviewCycle(
        createConfig({
          retry: {
            maxRetries: 1,
            baseDelayMs: 0,
            maxDelayMs: 0,
          },
        }),
        undefined,
        undefined,
        {
          projectPath: TEST_PROJECT_PATH,
          sessionId: TEST_SESSION_ID,
        },
        deps
      );

      expect(result.success).toBe(true);
      expect(state.runAgentCalls.map((call) => call.role)).toEqual([
        "reviewer",
        "reviewer",
        "fixer",
      ]);
    });
  });

  test("retries reviewer twice and succeeds on the second retry", async () => {
    await withHarness(async (state, deps) => {
      queueRunAgentSteps(
        state,
        resultStep(failureResult("reviewer failed on initial run", 30)),
        resultStep(failureResult("reviewer failed on first retry", 31)),
        resultStep(successResult("review output after second retry")),
        resultStep(successResult("fix output"))
      );
      queueReviewParses(state, parseReviewSuccess(buildReviewSummary()));
      queueFixParses(
        state,
        parseFixSuccess(
          buildFixSummary({
            decision: "NO_CHANGES_NEEDED",
            stop_iteration: true,
            fixes: [],
            skipped: [],
          })
        )
      );

      const result = await runReviewCycle(
        createConfig({
          retry: {
            maxRetries: 2,
            baseDelayMs: 0,
            maxDelayMs: 0,
          },
        }),
        undefined,
        undefined,
        {
          projectPath: TEST_PROJECT_PATH,
          sessionId: TEST_SESSION_ID,
        },
        deps
      );

      expect(result.success).toBe(true);
      expect(state.runAgentCalls.map((call) => call.role)).toEqual([
        "reviewer",
        "reviewer",
        "reviewer",
        "fixer",
      ]);
    });
  });

  test("returns failed result when reviewer fails and retries are exhausted", async () => {
    await withHarness(async (state, deps) => {
      queueRunAgentSteps(state, resultStep(failureResult("reviewer failed", 9)));

      const result = await runReviewCycle(
        createConfig(),
        undefined,
        undefined,
        {
          projectPath: TEST_PROJECT_PATH,
          sessionId: TEST_SESSION_ID,
        },
        deps
      );

      expect(result.success).toBe(false);
      expect(result.finalStatus).toBe("failed");
      expect(result.iterations).toBe(1);
      expect(result.reason).toContain("Reviewer failed with exit code 9");

      const iterationEntry = state.appendedEntries.find((entry) => entry.type === "iteration");
      expect(iterationEntry?.type).toBe("iteration");
      if (iterationEntry?.type === "iteration") {
        expect(iterationEntry.error?.phase).toBe("reviewer");
        expect(iterationEntry.error?.exitCode).toBe(9);
      }
    });
  });

  test("retries reviewer with format reminder and continues when retry summary is valid", async () => {
    await withHarness(async (state, deps) => {
      queueRunAgentSteps(
        state,
        resultStep(successResult("review output invalid structure")),
        resultStep(successResult("review output repaired")),
        resultStep(successResult("fix output"))
      );
      queueReviewParses(
        state,
        parseReviewFailure("missing summary"),
        parseReviewSuccess(buildReviewSummary())
      );
      queueFixParses(
        state,
        parseFixSuccess(
          buildFixSummary({
            decision: "NO_CHANGES_NEEDED",
            stop_iteration: true,
            fixes: [],
            skipped: [],
          })
        )
      );

      const result = await runReviewCycle(
        createConfig(),
        undefined,
        undefined,
        {
          projectPath: TEST_PROJECT_PATH,
          sessionId: TEST_SESSION_ID,
        },
        deps
      );

      expect(result.success).toBe(true);
      expect(state.runAgentCalls[1]?.prompt).toContain("REVIEWER_SUMMARY_RETRY_REMINDER");
    });
  });

  test("falls back to initial reviewer output when format retry fails", async () => {
    await withHarness(async (state, deps) => {
      queueRunAgentSteps(
        state,
        resultStep(successResult("initial review output")),
        resultStep(failureResult("retry reviewer failed", 13)),
        resultStep(successResult("fix output"))
      );
      queueReviewParses(state, parseReviewFailure("invalid summary"));
      queueFixParses(
        state,
        parseFixSuccess(
          buildFixSummary({
            decision: "NO_CHANGES_NEEDED",
            stop_iteration: true,
            fixes: [],
            skipped: [],
          })
        )
      );

      const result = await runReviewCycle(
        createConfig(),
        undefined,
        undefined,
        {
          projectPath: TEST_PROJECT_PATH,
          sessionId: TEST_SESSION_ID,
        },
        deps
      );

      expect(result.success).toBe(true);
      expect(state.runAgentCalls[1]?.prompt).toContain("REVIEWER_SUMMARY_RETRY_REMINDER");
      expect(
        state.updateLockfileCalls.some((call) => call.updates.reviewSummary !== undefined)
      ).toBe(false);
    });
  });

  test("falls back to initial reviewer output when format retry remains invalid", async () => {
    await withHarness(async (state, deps) => {
      queueRunAgentSteps(
        state,
        resultStep(successResult("initial review output")),
        resultStep(successResult("retry review output still invalid")),
        resultStep(successResult("fix output"))
      );
      queueReviewParses(
        state,
        parseReviewFailure("missing summary"),
        parseReviewFailure("still invalid")
      );
      queueFixParses(
        state,
        parseFixSuccess(
          buildFixSummary({
            decision: "NO_CHANGES_NEEDED",
            stop_iteration: true,
            fixes: [],
            skipped: [],
          })
        )
      );

      const result = await runReviewCycle(
        createConfig(),
        undefined,
        undefined,
        {
          projectPath: TEST_PROJECT_PATH,
          sessionId: TEST_SESSION_ID,
        },
        deps
      );

      expect(result.success).toBe(true);
      expect(state.runAgentCalls[1]?.prompt).toContain("REVIEWER_SUMMARY_RETRY_REMINDER");
      expect(
        state.updateLockfileCalls.some((call) => call.updates.reviewSummary !== undefined)
      ).toBe(false);
    });
  });

  test("stores codex reviewer text when reviewer agent is codex", async () => {
    await withHarness(async (state, deps) => {
      queueRunAgentSteps(
        state,
        resultStep(successResult("codex raw output")),
        resultStep(successResult("fix output"))
      );
      queueFixParses(
        state,
        parseFixSuccess(
          buildFixSummary({
            decision: "NO_CHANGES_NEEDED",
            stop_iteration: true,
            fixes: [],
            skipped: [],
          })
        )
      );

      const result = await runReviewCycle(
        createConfig({
          reviewer: { agent: "codex" },
        }),
        undefined,
        undefined,
        {
          projectPath: TEST_PROJECT_PATH,
          sessionId: TEST_SESSION_ID,
        },
        deps
      );

      expect(result.success).toBe(true);
      expect(
        state.updateLockfileCalls.some(
          (call) => call.updates.codexReviewText === "codex raw output"
        )
      ).toBe(true);
      expect(
        state.updateLockfileCalls.some((call) => call.updates.reviewSummary !== undefined)
      ).toBe(false);
    });
  });

  test("stores codex reviewSummary when codex session extraction returns valid JSON", async () => {
    await withHarness(async (state, deps) => {
      const reviewSummary = buildReviewSummary();
      queueRunAgentSteps(
        state,
        resultStep(successResult("codex raw output")),
        resultStep(successResult("fix output"))
      );
      queueReviewParses(state, parseReviewSuccess(reviewSummary));
      queueFixParses(
        state,
        parseFixSuccess(
          buildFixSummary({
            decision: "NO_CHANGES_NEEDED",
            stop_iteration: true,
            fixes: [],
            skipped: [],
          })
        )
      );

      const result = await runReviewCycle(
        createConfig({
          reviewer: { agent: "codex" },
        }),
        undefined,
        undefined,
        {
          projectPath: TEST_PROJECT_PATH,
          sessionId: TEST_SESSION_ID,
        },
        deps
      );

      expect(result.success).toBe(true);
      expect(
        state.updateLockfileCalls.some((call) => call.updates.reviewSummary !== undefined)
      ).toBe(true);
      expect(
        state.updateLockfileCalls.some((call) => call.updates.codexReviewText !== undefined)
      ).toBe(false);
    });
  });

  test("continues when codex reviewer lockfile updates fail", async () => {
    await withHarness(async (state, deps) => {
      state.updateLockfileFailuresRemaining = 100;
      queueRunAgentSteps(
        state,
        resultStep(successResult("codex raw output")),
        resultStep(successResult("fix output"))
      );
      queueFixParses(
        state,
        parseFixSuccess(
          buildFixSummary({
            decision: "NO_CHANGES_NEEDED",
            stop_iteration: true,
            fixes: [],
            skipped: [],
          })
        )
      );

      const result = await runReviewCycle(
        createConfig({
          reviewer: { agent: "codex" },
        }),
        undefined,
        undefined,
        {
          projectPath: TEST_PROJECT_PATH,
          sessionId: TEST_SESSION_ID,
        },
        deps
      );

      expect(result.success).toBe(true);
      expect(result.finalStatus).toBe("completed");
      expect(state.runAgentCalls.map((call) => call.role)).toEqual(["reviewer", "fixer"]);
      expect(
        state.updateLockfileCalls.some(
          (call) => call.updates.codexReviewText === "codex raw output"
        )
      ).toBe(true);
    });
  });

  test("returns failure when creating pre-fixer checkpoint throws", async () => {
    await withHarness(async (state, deps) => {
      state.createCheckpointError = new Error("checkpoint failed");
      queueRunAgentSteps(state, resultStep(successResult("review output")));
      queueReviewParses(state, parseReviewSuccess(buildReviewSummary()));

      const result = await runReviewCycle(
        createConfig(),
        undefined,
        undefined,
        {
          projectPath: TEST_PROJECT_PATH,
          sessionId: TEST_SESSION_ID,
        },
        deps
      );

      expect(result.success).toBe(false);
      expect(result.finalStatus).toBe("failed");
      expect(result.reason).toContain(
        "Failed to create pre-fixer checkpoint: Error: checkpoint failed"
      );

      const iterationEntry = state.appendedEntries.find((entry) => entry.type === "iteration");
      expect(iterationEntry?.type).toBe("iteration");
      if (iterationEntry?.type === "iteration") {
        expect(iterationEntry.error?.phase).toBe("fixer");
        expect(iterationEntry.error?.message).toContain("Failed to create pre-fixer checkpoint");
      }
    });
  });

  test("rolls back and fails when fixer summary remains missing after reminder retry", async () => {
    await withHarness(async (state, deps) => {
      queueRunAgentSteps(
        state,
        resultStep(successResult("review output")),
        resultStep(successResult("fix output first attempt")),
        resultStep(successResult("fix output retry"))
      );
      queueReviewParses(state, parseReviewSuccess(buildReviewSummary()));
      queueFixParses(state, parseFixFailure("missing summary"), parseFixFailure("still missing"));

      const result = await runReviewCycle(
        createConfig(),
        undefined,
        undefined,
        {
          projectPath: TEST_PROJECT_PATH,
          sessionId: TEST_SESSION_ID,
        },
        deps
      );

      expect(result.success).toBe(false);
      expect(result.reason).toContain("Fixer output incomplete");
      expect(result.reason).toContain("Changes were rolled back to the pre-fixer checkpoint");
      expect(state.runAgentCalls[2]?.prompt).toContain("FIXER_SUMMARY_RETRY_REMINDER");
      expect(state.rollbackCalls).toHaveLength(1);
    });
  });

  test("includes rollback failure details when fixer execution fails and rollback throws", async () => {
    await withHarness(async (state, deps) => {
      state.rollbackError = new Error("rollback exploded");
      queueRunAgentSteps(
        state,
        resultStep(successResult("review output")),
        resultStep(failureResult("fixer failed", 17))
      );
      queueReviewParses(state, parseReviewSuccess(buildReviewSummary()));
      queueFixParses(state, parseFixFailure("unusable fix output"));

      const result = await runReviewCycle(
        createConfig(),
        undefined,
        undefined,
        {
          projectPath: TEST_PROJECT_PATH,
          sessionId: TEST_SESSION_ID,
        },
        deps
      );

      expect(result.success).toBe(false);
      expect(result.reason).toContain("Fixer failed with exit code 17");
      expect(result.reason).toContain("Code may be in a broken state!");
      expect(result.reason).toContain("Rollback failed");
      expect(state.rollbackCalls).toHaveLength(1);

      const iterationEntry = state.appendedEntries.find((entry) => entry.type === "iteration");
      expect(iterationEntry?.type).toBe("iteration");
      if (iterationEntry?.type === "iteration") {
        expect(iterationEntry.rollback?.success).toBe(false);
      }
    });
  });

  test("fails fast when simplifier is enabled and simplifier run fails", async () => {
    await withHarness(async (state, deps) => {
      queueRunAgentSteps(state, resultStep(failureResult("simplifier failed", 5)));

      const result = await runReviewCycle(
        createConfig(),
        undefined,
        {
          simplifier: true,
        },
        {
          projectPath: TEST_PROJECT_PATH,
          sessionId: TEST_SESSION_ID,
        },
        deps
      );

      expect(result.success).toBe(false);
      expect(result.iterations).toBe(0);
      expect(result.reason).toContain("Code simplifier failed with exit code 5");
      expect(state.runAgentCalls.map((call) => call.role)).toEqual(["code-simplifier"]);
    });
  });

  test("runs simplifier before reviewer and fixer when simplifier succeeds", async () => {
    await withHarness(async (state, deps) => {
      queueRunAgentSteps(
        state,
        resultStep(successResult("simplifier output")),
        resultStep(successResult("review output")),
        resultStep(successResult("fix output"))
      );
      queueReviewParses(state, parseReviewSuccess(buildReviewSummary()));
      queueFixParses(
        state,
        parseFixSuccess(
          buildFixSummary({
            decision: "NO_CHANGES_NEEDED",
            stop_iteration: true,
            fixes: [],
            skipped: [],
          })
        )
      );

      const result = await runReviewCycle(
        createConfig(),
        undefined,
        {
          simplifier: true,
        },
        {
          projectPath: TEST_PROJECT_PATH,
          sessionId: TEST_SESSION_ID,
        },
        deps
      );

      expect(result.success).toBe(true);
      expect(result.finalStatus).toBe("completed");
      expect(result.iterations).toBe(1);
      expect(state.runAgentCalls.map((call) => call.role)).toEqual([
        "code-simplifier",
        "reviewer",
        "fixer",
      ]);
    });
  });

  test("swallows simplifier lockfile update failures and still completes", async () => {
    await withHarness(async (state, deps) => {
      state.updateLockfileFailuresRemaining = 100;
      queueRunAgentSteps(
        state,
        resultStep(successResult("simplifier output")),
        resultStep(successResult("review output")),
        resultStep(successResult("fix output"))
      );
      queueReviewParses(state, parseReviewSuccess(buildReviewSummary()));
      queueFixParses(
        state,
        parseFixSuccess(
          buildFixSummary({
            decision: "NO_CHANGES_NEEDED",
            stop_iteration: true,
            fixes: [],
            skipped: [],
          })
        )
      );

      const result = await runReviewCycle(
        createConfig(),
        undefined,
        {
          simplifier: true,
        },
        {
          projectPath: TEST_PROJECT_PATH,
          sessionId: TEST_SESSION_ID,
        },
        deps
      );

      expect(result.success).toBe(true);
      expect(result.finalStatus).toBe("completed");
      expect(state.runAgentCalls.map((call) => call.role)).toEqual([
        "code-simplifier",
        "reviewer",
        "fixer",
      ]);
      expect(state.updateLockfileCalls.length).toBeGreaterThan(0);
    });
  });

  test("returns interrupted result when signal arrives after simplifier succeeds", async () => {
    await withHarness(async (state, deps) => {
      state.onRunAgent = (role) => {
        if (role === "code-simplifier") {
          triggerInterrupt(state);
        }
      };
      queueRunAgentSteps(state, resultStep(successResult("simplifier output")));

      const result = await runReviewCycle(
        createConfig(),
        undefined,
        {
          simplifier: true,
        },
        {
          projectPath: TEST_PROJECT_PATH,
          sessionId: TEST_SESSION_ID,
        },
        deps
      );

      expect(result.success).toBe(false);
      expect(result.finalStatus).toBe("interrupted");
      expect(result.iterations).toBe(0);
    });
  });

  test("returns interrupted result before iteration start when signal arrives after system log", async () => {
    await withHarness(async (state, deps) => {
      state.onAppendLog = (entry) => {
        if (entry.type === "system") {
          triggerInterrupt(state);
        }
      };

      const result = await runReviewCycle(
        createConfig(),
        undefined,
        undefined,
        {
          projectPath: TEST_PROJECT_PATH,
          sessionId: TEST_SESSION_ID,
        },
        deps
      );

      expect(result.success).toBe(false);
      expect(result.finalStatus).toBe("interrupted");
      expect(result.iterations).toBe(0);
      expect(state.runAgentCalls).toHaveLength(0);

      const iterationEntry = state.appendedEntries.find((entry) => entry.type === "iteration");
      expect(iterationEntry?.type).toBe("iteration");
      if (iterationEntry?.type === "iteration") {
        expect(iterationEntry.error?.message).toContain("interrupted before iteration start");
      }
    });
  });

  test("returns interrupted result before fixer when signal arrives during reviewer run", async () => {
    await withHarness(async (state, deps) => {
      state.onRunAgent = (role) => {
        if (role === "reviewer") {
          triggerInterrupt(state);
        }
      };
      queueRunAgentSteps(state, resultStep(successResult("review output")));
      queueReviewParses(state, parseReviewSuccess(buildReviewSummary()));

      const result = await runReviewCycle(
        createConfig(),
        undefined,
        undefined,
        {
          projectPath: TEST_PROJECT_PATH,
          sessionId: TEST_SESSION_ID,
        },
        deps
      );

      expect(result.success).toBe(false);
      expect(result.finalStatus).toBe("interrupted");
      expect(result.iterations).toBe(1);
      expect(state.runAgentCalls.map((call) => call.role)).toEqual(["reviewer"]);

      const iterationEntry = state.appendedEntries.find((entry) => entry.type === "iteration");
      expect(iterationEntry?.type).toBe("iteration");
      if (iterationEntry?.type === "iteration") {
        expect(iterationEntry.error?.message).toContain("interrupted before fixer");
      }
    });
  });

  test("continues to max iterations when forceMaxIterations is enabled after clean pass", async () => {
    await withHarness(async (state, deps) => {
      queueRunAgentSteps(
        state,
        resultStep(successResult("review output 1")),
        resultStep(successResult("fix output 1")),
        resultStep(successResult("review output 2")),
        resultStep(successResult("fix output 2"))
      );
      queueReviewParses(
        state,
        parseReviewSuccess(buildReviewSummary()),
        parseReviewSuccess(buildReviewSummary())
      );
      queueFixParses(
        state,
        parseFixSuccess(
          buildFixSummary({
            decision: "NO_CHANGES_NEEDED",
            stop_iteration: true,
            fixes: [],
            skipped: [],
          })
        ),
        parseFixSuccess(
          buildFixSummary({
            decision: "NO_CHANGES_NEEDED",
            stop_iteration: true,
            fixes: [],
            skipped: [],
          })
        )
      );

      const result = await runReviewCycle(
        createConfig({
          maxIterations: 2,
        }),
        undefined,
        {
          forceMaxIterations: true,
        },
        {
          projectPath: TEST_PROJECT_PATH,
          sessionId: TEST_SESSION_ID,
        },
        deps
      );

      expect(result.success).toBe(true);
      expect(result.finalStatus).toBe("completed");
      expect(result.iterations).toBe(2);
      expect(state.runAgentCalls).toHaveLength(4);
    });
  });

  test("returns max-iterations outcome when issues remain", async () => {
    await withHarness(async (state, deps) => {
      queueRunAgentSteps(
        state,
        resultStep(successResult("review output")),
        resultStep(successResult("fix output"))
      );
      queueReviewParses(state, parseReviewSuccess(buildReviewSummary()));
      queueFixParses(
        state,
        parseFixSuccess(
          buildFixSummary({
            decision: "APPLY_SELECTIVELY",
            stop_iteration: false,
            fixes: [],
            skipped: [],
          })
        )
      );

      const result = await runReviewCycle(
        createConfig({
          maxIterations: 1,
        }),
        undefined,
        undefined,
        {
          projectPath: TEST_PROJECT_PATH,
          sessionId: TEST_SESSION_ID,
        },
        deps
      );

      expect(result.success).toBe(false);
      expect(result.finalStatus).toBe("completed");
      expect(result.reason).toContain("Max iterations (1) reached");
    });
  });

  test("continues to another iteration when fixer explicitly sets stop_iteration false", async () => {
    await withHarness(async (state, deps) => {
      queueRunAgentSteps(
        state,
        resultStep(successResult("review output 1")),
        resultStep(successResult("fix output 1")),
        resultStep(successResult("review output 2")),
        resultStep(successResult("fix output 2"))
      );
      queueReviewParses(
        state,
        parseReviewSuccess(buildReviewSummary()),
        parseReviewSuccess(buildReviewSummary())
      );
      queueFixParses(
        state,
        parseFixSuccess(
          buildFixSummary({
            decision: "APPLY_SELECTIVELY",
            stop_iteration: false,
            fixes: [],
            skipped: [],
          })
        ),
        parseFixSuccess(
          buildFixSummary({
            decision: "NO_CHANGES_NEEDED",
            stop_iteration: true,
            fixes: [],
            skipped: [],
          })
        )
      );

      const result = await runReviewCycle(
        createConfig({
          maxIterations: 2,
        }),
        undefined,
        undefined,
        {
          projectPath: TEST_PROJECT_PATH,
          sessionId: TEST_SESSION_ID,
        },
        deps
      );

      expect(result.success).toBe(true);
      expect(result.finalStatus).toBe("completed");
      expect(result.iterations).toBe(2);
      expect(state.runAgentCalls).toHaveLength(4);
    });
  });

  test("swallows lockfile update errors and still completes", async () => {
    await withHarness(async (state, deps) => {
      state.updateLockfileFailuresRemaining = 100;
      queueRunAgentSteps(
        state,
        resultStep(successResult("review output")),
        resultStep(successResult("fix output"))
      );
      queueReviewParses(state, parseReviewSuccess(buildReviewSummary()));
      queueFixParses(
        state,
        parseFixSuccess(
          buildFixSummary({
            decision: "NO_CHANGES_NEEDED",
            stop_iteration: true,
            fixes: [],
            skipped: [],
          })
        )
      );

      const result = await runReviewCycle(
        createConfig(),
        undefined,
        undefined,
        {
          projectPath: TEST_PROJECT_PATH,
          sessionId: TEST_SESSION_ID,
        },
        deps
      );

      expect(result.success).toBe(true);
      expect(result.finalStatus).toBe("completed");
      expect(state.updateLockfileCalls.length).toBeGreaterThan(0);
    });
  });

  test("logs warning and continues when discard checkpoint fails", async () => {
    await withHarness(async (state, deps) => {
      state.discardError = new Error("discard failed");
      queueRunAgentSteps(
        state,
        resultStep(successResult("review output")),
        resultStep(successResult("fix output"))
      );
      queueReviewParses(state, parseReviewSuccess(buildReviewSummary()));
      queueFixParses(
        state,
        parseFixSuccess(
          buildFixSummary({
            decision: "NO_CHANGES_NEEDED",
            stop_iteration: true,
            fixes: [],
            skipped: [],
          })
        )
      );

      const result = await runReviewCycle(
        createConfig(),
        undefined,
        undefined,
        {
          projectPath: TEST_PROJECT_PATH,
          sessionId: TEST_SESSION_ID,
        },
        deps
      );

      expect(result.success).toBe(true);
      expect(state.discardCalls).toHaveLength(1);
    });
  });

  test("skips checkpoint discard when dependency returns a null checkpoint", async () => {
    await withHarness(async (state, deps) => {
      deps.createCheckpoint = () => null as unknown as GitCheckpoint;
      queueRunAgentSteps(
        state,
        resultStep(successResult("review output")),
        resultStep(successResult("fix output"))
      );
      queueReviewParses(state, parseReviewSuccess(buildReviewSummary()));
      queueFixParses(
        state,
        parseFixSuccess(
          buildFixSummary({
            decision: "NO_CHANGES_NEEDED",
            stop_iteration: true,
            fixes: [],
            skipped: [],
          })
        )
      );

      const result = await runReviewCycle(
        createConfig(),
        undefined,
        undefined,
        {
          projectPath: TEST_PROJECT_PATH,
          sessionId: TEST_SESSION_ID,
        },
        deps
      );

      expect(result.success).toBe(true);
      expect(state.discardCalls).toHaveLength(0);
    });
  });

  test("swallows session_end append failures in finally and still returns result", async () => {
    await withHarness(async (state, deps) => {
      const appendLogBase = deps.appendLog;
      deps.appendLog = async (sessionPath, entry) => {
        if (entry.type === "session_end") {
          throw new Error("session_end append failed");
        }
        await appendLogBase(sessionPath, entry);
      };

      queueRunAgentSteps(
        state,
        resultStep(successResult("review output")),
        resultStep(successResult("fix output"))
      );
      queueReviewParses(state, parseReviewSuccess(buildReviewSummary()));
      queueFixParses(
        state,
        parseFixSuccess(
          buildFixSummary({
            decision: "NO_CHANGES_NEEDED",
            stop_iteration: true,
            fixes: [],
            skipped: [],
          })
        )
      );

      const result = await runReviewCycle(
        createConfig(),
        undefined,
        undefined,
        {
          projectPath: TEST_PROJECT_PATH,
          sessionId: TEST_SESSION_ID,
        },
        deps
      );

      expect(result.success).toBe(true);
      expect(result.finalStatus).toBe("completed");
      expect(state.appendedEntries.some((entry) => entry.type === "session_end")).toBe(false);
    });
  });

  test("rethrows unexpected errors and still appends session_end entry", async () => {
    await withHarness(async (state, deps) => {
      queueRunAgentSteps(state, throwStep(new Error("runner crashed")));

      await expect(
        runReviewCycle(
          createConfig(),
          undefined,
          undefined,
          {
            projectPath: TEST_PROJECT_PATH,
            sessionId: TEST_SESSION_ID,
          },
          deps
        )
      ).rejects.toThrow("runner crashed");

      const sessionEnd = state.appendedEntries.at(-1);
      expect(sessionEnd?.type).toBe("session_end");
      if (sessionEnd?.type === "session_end") {
        expect(sessionEnd.status).toBe("failed");
        expect(sessionEnd.reason).toBe("Unexpected error: runner crashed");
      }
    });
  });

  test("uses fallback session_end reason when non-Error is thrown", async () => {
    await withHarness(async (state, deps) => {
      queueRunAgentSteps(state, throwStep("runner crashed as string"));

      await expect(
        runReviewCycle(
          createConfig(),
          undefined,
          undefined,
          {
            projectPath: TEST_PROJECT_PATH,
            sessionId: TEST_SESSION_ID,
          },
          deps
        )
      ).rejects.toBe("runner crashed as string");

      const sessionEnd = state.appendedEntries.at(-1);
      expect(sessionEnd?.type).toBe("session_end");
      if (sessionEnd?.type === "session_end") {
        expect(sessionEnd.status).toBe("failed");
        expect(sessionEnd.reason).toBe("Review cycle ended unexpectedly");
        expect(sessionEnd.iterations).toBe(1);
      }
    });
  });
});
