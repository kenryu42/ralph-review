import { AGENTS, runAgent } from "@/lib/agents";
import {
  createCheckpoint,
  createSessionWorktree,
  discardCheckpoint,
  discardSessionWorktree,
  type RetainedSessionWorktree,
  rollbackToCheckpoint,
} from "@/lib/git";
import { createOrAutoApplyHandoff } from "@/lib/handoff";
import { appendLog, createLogSession, getGitBranch } from "@/lib/logging";
import {
  createFixerSummaryRetryReminder,
  createReviewerSummaryRetryReminder,
} from "@/lib/prompts/protocol";
import { createFixerPrompt } from "@/lib/review-workflow/remediation/prompt";
import {
  createReviewerPrompt,
  createTargetedReviewPrompt,
} from "@/lib/review-workflow/review/prompt";
import {
  DEFAULT_RUN_REVIEW_SESSION_DEPENDENCIES,
  type RunReviewRuntimeContext,
  type RunReviewSessionDependencies,
  runReviewSession,
} from "@/lib/review-workflow/review/run-review-session";
import { updateSessionState } from "@/lib/session";
import { parseFixSummaryOutput, parseReviewSummaryOutput } from "@/lib/structured-output";
import type {
  AgentRole,
  Config,
  FixSummary,
  HandoffStatus,
  IterationResult,
  RetryConfig,
  ReviewOutcome,
  ReviewSummary,
  SessionEndEntry,
  SessionStatus,
} from "@/lib/types";

export interface RunReviewCycleDependencies extends RunReviewSessionDependencies {
  createFixerPrompt: typeof createFixerPrompt;
  createFixerSummaryRetryReminder: typeof createFixerSummaryRetryReminder;
  createTargetedReviewPrompt: typeof createTargetedReviewPrompt;
  createOrAutoApplyHandoff: typeof createOrAutoApplyHandoff;
}

const DEFAULT_RUN_REVIEW_CYCLE_DEPENDENCIES: RunReviewCycleDependencies = {
  ...DEFAULT_RUN_REVIEW_SESSION_DEPENDENCIES,
  createReviewerPrompt,
  createFixerPrompt,
  createFixerSummaryRetryReminder,
  createTargetedReviewPrompt,
  createReviewerSummaryRetryReminder,
  AGENTS,
  runAgent,
  createCheckpoint,
  createSessionWorktree,
  discardCheckpoint,
  discardSessionWorktree,
  rollbackToCheckpoint,
  createOrAutoApplyHandoff,
  updateSessionState,
  appendLog,
  createLogSession,
  getGitBranch,
  parseReviewSummaryOutput,
};

export function calculateRetryDelay(attempt: number, config: RetryConfig): number {
  const exponentialDelay = config.baseDelayMs * 2 ** attempt;
  const jitter = Math.random() * (exponentialDelay / 2);
  const delay = exponentialDelay + jitter;
  return Math.min(delay, config.maxDelayMs);
}

export function formatAgentFailureWarning(
  role: AgentRole,
  exitCode: number,
  retriesExhausted: number
): string {
  const roleName = role.toUpperCase();
  const border = "═".repeat(60);
  const warning = `
╔${border}╗
║  ⚠️  ${roleName} AGENT FAILED - EXIT CODE ${exitCode}
║
║  All ${retriesExhausted} retries exhausted
║
║  ⚠️  WARNING: Code may be in a BROKEN state!
║  The ${role} may have been interrupted mid-execution.
║
║  Please verify your code still compiles and runs correctly.
║  Check: git diff, run tests, verify build
╚${border}╝`;
  return warning;
}

export function extractFixSummaryFromOutput(
  resultText: string | null,
  rawOutput: string
): FixSummary | null {
  const parsed = parseFixSummaryOutput(resultText, rawOutput);
  return parsed.ok ? parsed.value : null;
}

export interface CycleResult {
  success: boolean;
  finalStatus: SessionEndEntry["status"];
  iterations: number;
  reason: string;
  sessionPath: string;
  phase?: SessionEndEntry["phase"];
  sessionStatus?: SessionStatus;
  reviewOutcome?: ReviewOutcome;
  terminalReview?: ReviewSummary;
  handoffStatus?: HandoffStatus;
  handoffUpdatedAt?: number;
  commitSha?: string;
  retainedWorktree?: RetainedSessionWorktree;
  artifactPath?: string;
  artifact?: ReturnType<RunReviewSessionDependencies["saveFindingsArtifact"]> extends Promise<
    infer T
  >
    ? T
    : never;
}

export type OnIterationCallback = (
  iteration: number,
  role: "reviewer" | "fixer",
  result: IterationResult
) => void;

export function determineCycleResult(
  hasIssues: boolean,
  iterations: number,
  maxIterations: number,
  wasInterruptedFlag: boolean,
  sessionPath: string
): CycleResult {
  if (wasInterruptedFlag) {
    return {
      success: false,
      finalStatus: "interrupted",
      iterations,
      reason: "Review cycle was interrupted",
      sessionPath,
    };
  }

  if (!hasIssues) {
    return {
      success: true,
      finalStatus: "completed",
      iterations,
      reason: "No issues found - code is clean",
      sessionPath,
    };
  }

  if (iterations >= maxIterations) {
    return {
      success: false,
      finalStatus: "completed",
      iterations,
      reason: `Max iterations (${maxIterations}) reached - some issues may remain`,
      sessionPath,
    };
  }

  return {
    success: false,
    finalStatus: "failed",
    iterations,
    reason: "Review cycle ended unexpectedly",
    sessionPath,
  };
}

let interrupted = false;
let signalHandlerRegistered = false;

function setupSignalHandler(): void {
  if (signalHandlerRegistered) {
    return;
  }

  process.on("SIGINT", () => {
    console.log("\n⚠️  Interrupt received. Finishing the current review step...");
    interrupted = true;
  });
  signalHandlerRegistered = true;
}

function wasInterrupted(): boolean {
  return interrupted;
}

function resetInterrupt(): void {
  interrupted = false;
}

function mapSessionStatusToFinalStatus(status: SessionStatus): CycleResult["finalStatus"] {
  if (status === "failed") {
    return "failed";
  }

  if (status === "interrupted") {
    return "interrupted";
  }

  return "completed";
}

function createSessionEndEntry(
  result: CycleResult | undefined,
  error: unknown,
  iterationsFallback: number
): SessionEndEntry {
  const status = result?.finalStatus ?? (wasInterrupted() ? "interrupted" : "failed");
  const reason =
    result?.reason ??
    (error instanceof Error ? `Unexpected error: ${error.message}` : undefined) ??
    (wasInterrupted() ? "Review cycle was interrupted" : "Review cycle ended unexpectedly");

  return {
    type: "session_end",
    timestamp: Date.now(),
    status,
    reason,
    iterations: result?.iterations ?? iterationsFallback,
    phase: result?.phase,
    sessionStatus: result?.sessionStatus,
    reviewOutcome: result?.reviewOutcome,
    handoffStatus: result?.handoffStatus,
    handoffUpdatedAt: result?.handoffUpdatedAt,
    commitSha: result?.commitSha,
    mergeReady: result?.retainedWorktree?.mergeReady,
    worktreeBranch: result?.retainedWorktree?.worktreeBranch,
    worktreeProjectPath: result?.retainedWorktree?.worktreeProjectPath,
    terminalReview: result?.terminalReview,
  };
}

export async function runReviewCycle(
  config: Config,
  _onIteration?: OnIterationCallback,
  reviewOptions?: Parameters<typeof runReviewSession>[1],
  runtimeContext?: RunReviewRuntimeContext,
  deps: RunReviewCycleDependencies = DEFAULT_RUN_REVIEW_CYCLE_DEPENDENCIES
): Promise<CycleResult> {
  resetInterrupt();
  setupSignalHandler();

  let finalResult: CycleResult | undefined;
  let unhandledError: unknown;
  let sessionPath =
    runtimeContext?.sessionPath ??
    (await deps.createLogSession(undefined, runtimeContext?.projectPath ?? process.cwd()));

  try {
    const review = await runReviewSession(
      config,
      reviewOptions,
      runtimeContext,
      wasInterrupted,
      deps
    );

    sessionPath = review.sessionPath;
    finalResult = {
      success: review.result.sessionStatus === "completed",
      finalStatus: mapSessionStatusToFinalStatus(review.result.sessionStatus),
      iterations: review.result.iterations,
      reason: review.result.reason,
      sessionPath: review.sessionPath,
      phase: review.result.phase,
      sessionStatus: review.result.sessionStatus,
      reviewOutcome: review.result.reviewOutcome,
      artifact: review.result.artifact,
      artifactPath: review.result.artifactPath,
    };

    return finalResult;
  } catch (error) {
    unhandledError = error;
    throw error;
  } finally {
    const sessionEndEntry = createSessionEndEntry(
      finalResult,
      unhandledError,
      finalResult?.iterations ?? 0
    );
    await deps.appendLog(sessionPath, sessionEndEntry).catch(() => {});
  }
}
