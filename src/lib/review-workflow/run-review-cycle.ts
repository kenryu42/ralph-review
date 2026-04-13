import { AGENTS, runAgent } from "@/lib/agents";
import {
  createCheckpoint,
  createSessionWorktree,
  discardCheckpoint,
  discardSessionWorktree,
  type GitCheckpoint,
  type GitSessionWorktree,
  type RetainedSessionWorktree,
  rollbackToCheckpoint,
} from "@/lib/git";
import { createOrAutoApplyHandoff, type SessionHandoffResult } from "@/lib/handoff";
import { appendLog, createLogSession, getGitBranch } from "@/lib/logging";
import {
  createFixerSummaryRetryReminder,
  createReviewerSummaryRetryReminder,
} from "@/lib/prompts/protocol";
import { createCodeSimplifierPrompt } from "@/lib/prompts/simplifier";
import { createReviewerPrompt } from "@/lib/review-workflow/discovery/prompt";
import { createFixerPrompt } from "@/lib/review-workflow/remediation/prompt";
import { type SessionState, updateSessionState } from "@/lib/session";
import {
  extractJsonBlock as extractJsonBlockFromOutput,
  parseFixSummaryCandidate,
  parseFixSummaryOutput,
  parseReviewSummaryCandidate,
  parseReviewSummaryOutput,
} from "@/lib/structured-output";
import type {
  AgentRole,
  CodexReviewSummary,
  Config,
  FixSummary,
  HandoffStatus,
  IterationEntry,
  IterationResult,
  RetryConfig,
  ReviewOptions,
  ReviewOutcome,
  ReviewSummary,
  SessionEndEntry,
  SystemEntry,
} from "@/lib/types";
import { DEFAULT_RETRY_CONFIG } from "@/lib/types";

interface RunReviewCycleDependencies {
  createCodeSimplifierPrompt: typeof createCodeSimplifierPrompt;
  createFixerPrompt: typeof createFixerPrompt;
  createFixerSummaryRetryReminder: typeof createFixerSummaryRetryReminder;
  createReviewerPrompt: typeof createReviewerPrompt;
  createReviewerSummaryRetryReminder: typeof createReviewerSummaryRetryReminder;
  AGENTS: typeof AGENTS;
  runAgent: typeof runAgent;
  createCheckpoint: typeof createCheckpoint;
  createSessionWorktree: typeof createSessionWorktree;
  discardCheckpoint: typeof discardCheckpoint;
  discardSessionWorktree: typeof discardSessionWorktree;
  rollbackToCheckpoint: typeof rollbackToCheckpoint;
  createOrAutoApplyHandoff: typeof createOrAutoApplyHandoff;
  updateSessionState: typeof updateSessionState;
  appendLog: typeof appendLog;
  createLogSession: typeof createLogSession;
  getGitBranch: typeof getGitBranch;
  parseFixSummaryOutput: typeof parseFixSummaryOutput;
  parseReviewSummaryOutput: typeof parseReviewSummaryOutput;
}

const DEFAULT_RUN_REVIEW_CYCLE_DEPENDENCIES: RunReviewCycleDependencies = {
  createCodeSimplifierPrompt,
  createFixerPrompt,
  createFixerSummaryRetryReminder,
  createReviewerPrompt,
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
  parseFixSummaryOutput,
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createIterationEntry(
  iteration: number,
  startTime: number,
  options: {
    error?: { phase: AgentRole; message: string; exitCode?: number };
    review?: ReviewSummary;
    codexReview?: CodexReviewSummary;
    fixes?: FixSummary;
  } = {}
): IterationEntry {
  return {
    type: "iteration",
    timestamp: Date.now(),
    iteration,
    duration: Date.now() - startTime,
    ...(options.error && { error: options.error }),
    ...(options.review && { review: options.review }),
    ...(options.codexReview && { codexReview: options.codexReview }),
    ...(options.fixes && { fixes: options.fixes }),
  };
}

function isInterruptLikeFailure(result: IterationResult): boolean {
  return !result.success && (wasInterrupted() || result.exitCode === 130);
}

function createInterruptedCycleResult(sessionPath: string, iteration: number): CycleResult {
  return {
    success: false,
    finalStatus: "interrupted",
    iterations: iteration,
    reason: "Review cycle was interrupted",
    sessionPath,
  };
}

async function handleInterruptedAgentFailure(
  role: AgentRole,
  exitCode: number,
  iteration: number,
  startTime: number,
  sessionPath: string,
  deps: RunReviewCycleDependencies,
  options: {
    review?: ReviewSummary;
    codexReview?: CodexReviewSummary;
  } = {}
): Promise<CycleResult> {
  const entry = createIterationEntry(iteration, startTime, {
    error: {
      phase: role,
      message: `${role.charAt(0).toUpperCase() + role.slice(1)} interrupted`,
      exitCode,
    },
    review: options.review,
    codexReview: options.codexReview,
  });
  await deps.appendLog(sessionPath, entry);
  return createInterruptedCycleResult(sessionPath, iteration);
}

async function handleAgentFailure(
  role: AgentRole,
  exitCode: number,
  retryConfig: RetryConfig,
  iteration: number,
  startTime: number,
  sessionPath: string,
  deps: RunReviewCycleDependencies,
  options: {
    review?: ReviewSummary;
    codexReview?: CodexReviewSummary;
  } = {}
): Promise<CycleResult> {
  const warning = formatAgentFailureWarning(role, exitCode, retryConfig.maxRetries);
  console.log(warning);

  const entry = createIterationEntry(iteration, startTime, {
    error: {
      phase: role,
      message: `${role.charAt(0).toUpperCase() + role.slice(1)} failed after ${retryConfig.maxRetries} retries`,
      exitCode,
    },
    review: options.review,
    codexReview: options.codexReview,
  });
  await deps.appendLog(sessionPath, entry);

  const brokenWarning = role === "fixer" ? " Code may be in a broken state!" : "";
  return {
    success: false,
    finalStatus: "failed",
    iterations: iteration,
    reason:
      `${role.charAt(0).toUpperCase() + role.slice(1)} failed with exit code ${exitCode} after ${retryConfig.maxRetries} retries.` +
      brokenWarning,
    sessionPath,
  };
}

function printHeader(text: string, colorCode: string = "\x1b[36m") {
  const width = 58;
  const border = "─".repeat(width);
  const content = text.slice(0, width - 2).padEnd(width - 2);
  const reset = "\x1b[0m";
  const bold = "\x1b[1m";
  const indent = "  ";

  console.log("");
  console.log(`${indent}${bold}${colorCode}╭${border}╮${reset}`);
  console.log(`${indent}${bold}${colorCode}│${" ".repeat(width)}│${reset}`);
  console.log(`${indent}${bold}${colorCode}│  ${content}│${reset}`);
  console.log(`${indent}${bold}${colorCode}│${" ".repeat(width)}│${reset}`);
  console.log(`${indent}${bold}${colorCode}╰${border}╯${reset}`);
  console.log("");
}

async function runAgentWithRetry(
  role: AgentRole,
  config: Config,
  deps: RunReviewCycleDependencies,
  prompt: string = "",
  timeout: number = config.iterationTimeout,
  reviewOptions?: ReviewOptions,
  cwd?: string,
  workspaceReset?: {
    checkpointLabelPrefix: string;
  }
): Promise<IterationResult> {
  const retryConfig = config.retry ?? DEFAULT_RETRY_CONFIG;
  type RunAgentAttemptResult = {
    result: IterationResult;
    shouldRetry: boolean;
  };

  const terminalWorkspaceResetFailure = (message: string): RunAgentAttemptResult => ({
    result: {
      success: false,
      output: message,
      exitCode: 1,
      duration: 0,
    },
    shouldRetry: false,
  });

  const runAgentAttempt = async (attempt: number): Promise<RunAgentAttemptResult> => {
    if (!workspaceReset) {
      return {
        result: await deps.runAgent(role, config, prompt, timeout, reviewOptions, cwd),
        shouldRetry: true,
      };
    }

    if (!cwd) {
      throw new Error(`${role} retry workspace reset requires a working directory.`);
    }

    let checkpoint: GitCheckpoint;
    try {
      checkpoint = deps.createCheckpoint(
        cwd,
        `${workspaceReset.checkpointLabelPrefix}-${attempt + 1}-${Date.now()}`
      );
    } catch (error) {
      return terminalWorkspaceResetFailure(`Failed to create ${role} retry checkpoint: ${error}`);
    }

    let attemptResult: IterationResult;
    try {
      attemptResult = await deps.runAgent(role, config, prompt, timeout, reviewOptions, cwd);
    } catch (error) {
      try {
        deps.rollbackToCheckpoint(cwd, checkpoint);
      } catch (rollbackError) {
        return terminalWorkspaceResetFailure(
          `Failed to rollback ${role} retry checkpoint after agent error: ${rollbackError}`
        );
      }
      throw error;
    }

    if (attemptResult.success) {
      try {
        deps.discardCheckpoint(cwd, checkpoint);
      } catch (error) {
        console.log(`  ⚠️  Failed to discard ${role} retry checkpoint: ${error}`);
      }
      return {
        result: attemptResult,
        shouldRetry: true,
      };
    }

    try {
      deps.rollbackToCheckpoint(cwd, checkpoint);
    } catch (error) {
      try {
        deps.discardCheckpoint(cwd, checkpoint);
      } catch (discardError) {
        console.log(`  ⚠️  Failed to discard ${role} retry checkpoint: ${discardError}`);
      }
      return terminalWorkspaceResetFailure(`Failed to rollback ${role} retry checkpoint: ${error}`);
    }
    return {
      result: attemptResult,
      shouldRetry: true,
    };
  };

  let attemptResult = await runAgentAttempt(0);
  let result = attemptResult.result;

  if (result.success || isInterruptLikeFailure(result) || !attemptResult.shouldRetry) {
    return result;
  }

  console.log(`  ❌ ${role} failed (exit code ${result.exitCode})`);

  for (let attempt = 1; attempt <= retryConfig.maxRetries; attempt++) {
    const delay = calculateRetryDelay(attempt - 1, retryConfig);
    console.log(
      `  ⏳ Retry ${attempt}/${retryConfig.maxRetries} in ${Math.round(delay / 1000)}s...`
    );
    await sleep(delay);

    attemptResult = await runAgentAttempt(attempt);
    result = attemptResult.result;

    if (result.success || isInterruptLikeFailure(result) || !attemptResult.shouldRetry) {
      return result;
    }

    console.log(`  ❌ ${role} failed (exit code ${result.exitCode})`);
  }

  return result;
}

interface ReviewerExecutionResult {
  reviewResult: IterationResult;
  extractedReviewerText: string | null;
  reviewParseResult: ReturnType<RunReviewCycleDependencies["parseReviewSummaryOutput"]>;
}

async function runReviewerAndParseSummary(
  config: Config,
  deps: RunReviewCycleDependencies,
  reviewerPrompt: string,
  reviewOptions: ReviewOptions | undefined,
  cwd: string
): Promise<ReviewerExecutionResult> {
  let reviewResult = await runAgentWithRetry(
    "reviewer",
    config,
    deps,
    reviewerPrompt,
    config.iterationTimeout,
    reviewOptions,
    cwd
  );

  if (!reviewResult.success) {
    return {
      reviewResult,
      extractedReviewerText: null,
      reviewParseResult: deps.parseReviewSummaryOutput(null, reviewResult.output),
    };
  }

  const reviewerAgentModule = deps.AGENTS[config.reviewer.agent];
  let extractedReviewerText = await reviewerAgentModule.extractResult(reviewResult.output);
  let reviewParseResult = deps.parseReviewSummaryOutput(extractedReviewerText, reviewResult.output);

  if (config.reviewer.agent !== "codex" && !reviewParseResult.ok && !wasInterrupted()) {
    const initialReviewResult = reviewResult;
    const initialExtractedReviewerText = extractedReviewerText;
    const initialReviewParseResult = reviewParseResult;

    for (
      let attempt = 1;
      attempt <= REVIEWER_SUMMARY_RETRY_COUNT &&
      reviewResult.success &&
      !reviewParseResult.ok &&
      !wasInterrupted();
      attempt++
    ) {
      console.log(
        `  ⚠️  Reviewer output missing structured summary (${reviewParseResult.failureReason}). Retrying reviewer with format reminder...`
      );
      const reviewRetryPrompt = `${reviewerPrompt}\n${deps.createReviewerSummaryRetryReminder()}`;
      const retryResult = await runAgentWithRetry(
        "reviewer",
        config,
        deps,
        reviewRetryPrompt,
        config.iterationTimeout,
        reviewOptions,
        cwd
      );

      if (!retryResult.success) {
        console.log(
          "  ⚠️  Reviewer format retry failed. Continuing with the initial reviewer output."
        );
        reviewResult = initialReviewResult;
        extractedReviewerText = initialExtractedReviewerText;
        reviewParseResult = initialReviewParseResult;
        break;
      }

      reviewResult = retryResult;
      extractedReviewerText = await reviewerAgentModule.extractResult(reviewResult.output);
      reviewParseResult = deps.parseReviewSummaryOutput(extractedReviewerText, reviewResult.output);
    }

    if (!reviewParseResult.ok) {
      if (reviewResult !== initialReviewResult) {
        console.log(
          "  ⚠️  Reviewer format retry still produced invalid structured summary. Continuing with the initial reviewer output."
        );
      }
      reviewResult = initialReviewResult;
      extractedReviewerText = initialExtractedReviewerText;
      reviewParseResult = initialReviewParseResult;
    }
  }

  return {
    reviewResult,
    extractedReviewerText,
    reviewParseResult,
  };
}

export interface CycleResult {
  success: boolean;
  finalStatus: SessionEndEntry["status"];
  iterations: number;
  reason: string;
  sessionPath: string;
  reviewOutcome?: ReviewOutcome;
  terminalReview?: ReviewSummary;
  handoffStatus?: HandoffStatus;
  handoffUpdatedAt?: number;
  commitSha?: string;
  retainedWorktree?: RetainedSessionWorktree;
}

const REVIEWER_SUMMARY_RETRY_COUNT = 1;
const FIXER_SUMMARY_RETRY_COUNT = 1;

export type OnIterationCallback = (
  iteration: number,
  role: "reviewer" | "fixer",
  result: IterationResult
) => void;

export interface RunReviewRuntimeContext {
  projectPath?: string;
  sessionId?: string;
  sessionPath?: string;
}

function createWorktreeFailureResult(
  sessionPath: string,
  iteration: number,
  reason: string
): CycleResult {
  return {
    success: false,
    finalStatus: "failed",
    iterations: iteration,
    reason,
    sessionPath,
  };
}

function applyReviewOutcome(
  result: CycleResult,
  reviewOutcome: ReviewOutcome,
  terminalReview?: ReviewSummary
): CycleResult {
  result.reviewOutcome = reviewOutcome;
  if (terminalReview) {
    result.terminalReview = terminalReview;
  }
  result.success = result.success && reviewOutcome === "clean";
  return result;
}

function applyHandoffResult(
  result: CycleResult,
  handoff: SessionHandoffResult | null
): CycleResult {
  result.handoffStatus = handoff?.handoffStatus;
  result.handoffUpdatedAt = handoff?.handoffUpdatedAt;
  result.commitSha = handoff?.commitSha;
  result.retainedWorktree = undefined;
  return result;
}

function applyWorktreeCleanupFailure(
  result: CycleResult | undefined,
  sessionPath: string,
  iteration: number,
  phase: "finalize" | "discard",
  error: unknown
): CycleResult {
  const detail = `${error}`;

  if (!result) {
    return createWorktreeFailureResult(
      sessionPath,
      iteration,
      `Session worktree ${phase} failed: ${detail}`
    );
  }

  result.success = false;
  result.finalStatus = "failed";
  result.reason = `${result.reason} Session worktree ${phase} failed (${detail}).`;
  result.handoffStatus = undefined;
  result.handoffUpdatedAt = undefined;
  result.commitSha = undefined;
  result.retainedWorktree = undefined;
  return result;
}

export function extractJsonBlock(output: string): string | null {
  return extractJsonBlockFromOutput(output);
}

export function extractFixSummaryFromOutput(
  resultText: string | null,
  rawOutput: string
): FixSummary | null {
  const parsed = parseFixSummaryOutput(resultText, rawOutput);
  return parsed.ok ? parsed.value : null;
}

export function parseFixSummary(jsonString: string): FixSummary | null {
  const parsed = parseFixSummaryCandidate(jsonString);
  return parsed.ok ? parsed.value : null;
}

export function parseReviewSummary(jsonString: string): ReviewSummary | null {
  const parsed = parseReviewSummaryCandidate(jsonString);
  return parsed.ok ? parsed.value : null;
}

export function determineCycleResult(
  hasIssues: boolean,
  iterations: number,
  maxIterations: number,
  wasInterrupted: boolean,
  sessionPath: string
): CycleResult {
  if (wasInterrupted) {
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

function createSessionEndEntry(
  result: CycleResult | undefined,
  error: unknown,
  wasInterrupted: boolean,
  iterationsFallback: number
): SessionEndEntry {
  const status: SessionEndEntry["status"] =
    result?.finalStatus ?? (wasInterrupted ? "interrupted" : "failed");

  const reason =
    result?.reason ??
    (error instanceof Error ? `Unexpected error: ${error.message}` : undefined) ??
    (wasInterrupted ? "Review cycle was interrupted" : "Review cycle ended unexpectedly");

  return {
    type: "session_end",
    timestamp: Date.now(),
    status,
    reason,
    iterations: result?.iterations ?? iterationsFallback,
    reviewOutcome: result?.reviewOutcome,
    handoffStatus: result?.handoffStatus,
    handoffUpdatedAt: result?.handoffUpdatedAt,
    commitSha: result?.commitSha ?? result?.retainedWorktree?.commitSha,
    mergeReady: result?.retainedWorktree?.mergeReady,
    worktreeBranch: result?.retainedWorktree?.worktreeBranch,
    worktreeProjectPath: result?.retainedWorktree?.worktreeProjectPath,
    terminalReview: result?.terminalReview,
  };
}

let interrupted = false;

function setupSignalHandler(): void {
  process.on("SIGINT", () => {
    console.log("\n⚠️  Interrupt received. Completing current iteration...");
    interrupted = true;
  });
}

function wasInterrupted(): boolean {
  return interrupted;
}

function resetInterrupt(): void {
  interrupted = false;
}

export async function runReviewCycle(
  config: Config,
  onIteration?: OnIterationCallback,
  reviewOptions?: ReviewOptions,
  runtimeContext?: RunReviewRuntimeContext,
  deps: RunReviewCycleDependencies = DEFAULT_RUN_REVIEW_CYCLE_DEPENDENCIES
): Promise<CycleResult> {
  resetInterrupt();
  setupSignalHandler();

  const projectPath = runtimeContext?.projectPath ?? process.cwd();
  const sessionId = runtimeContext?.sessionId;
  const gitBranch = await deps.getGitBranch(projectPath);
  const sessionPath =
    runtimeContext?.sessionPath ?? (await deps.createLogSession(undefined, projectPath, gitBranch));

  let finalResult: CycleResult | undefined;
  let unhandledError: unknown;
  const finish = (result: CycleResult): CycleResult => {
    finalResult = result;
    return result;
  };

  let iteration = 0;
  let hasRemainingIssues = true;
  const retryConfig = config.retry ?? DEFAULT_RETRY_CONFIG;
  let worktree: GitSessionWorktree | null = null;
  let currentTreeRetainable = false;
  let hasSuccessfulReviewIteration = false;
  let agentProjectPath: string | null = null;
  const updateCurrentSessionState = async (updates: Partial<SessionState>): Promise<void> => {
    if (!sessionId) {
      return;
    }

    await deps
      .updateSessionState(undefined, projectPath, sessionId, updates, {
        expectedSessionId: sessionId,
      })
      .catch(() => {});
  };

  try {
    await updateCurrentSessionState({
      sessionPath,
    });

    try {
      worktree = deps.createSessionWorktree(projectPath, sessionId ?? "session");
    } catch (error) {
      return finish(
        createWorktreeFailureResult(sessionPath, 0, `Failed to create session worktree: ${error}`)
      );
    }

    await updateCurrentSessionState({
      sessionPath,
      worktreeProjectPath: worktree.worktreeProjectPath,
      worktreeBranch: worktree.retainedBranch,
    });

    const systemEntry: SystemEntry = {
      type: "system",
      timestamp: Date.now(),
      sessionId,
      projectPath,
      gitBranch,
      worktreeProjectPath: worktree.worktreeProjectPath,
      worktreeBranch: worktree.retainedBranch,
      reviewer: config.reviewer,
      fixer: config.fixer,
      codeSimplifier: config["code-simplifier"],
      maxIterations: config.maxIterations,
      reviewOptions,
    };
    await deps.appendLog(sessionPath, systemEntry);

    const agentProjectPathResolved = worktree.agentProjectPath;
    agentProjectPath = agentProjectPathResolved;
    currentTreeRetainable = true;
    const createReviewerPromptForAgent = (): string =>
      deps.createReviewerPrompt({
        repoPath: agentProjectPathResolved,
        baseBranch: reviewOptions?.baseBranch,
        commitSha: reviewOptions?.commitSha,
        customInstructions: reviewOptions?.customInstructions,
      });

    const canRetainResult = (result: CycleResult): boolean => {
      if (!currentTreeRetainable) {
        return false;
      }
      return hasSuccessfulReviewIteration || result.finalStatus !== "interrupted";
    };

    const terminalIncompleteResult = (result: CycleResult): CycleResult =>
      canRetainResult(result) ? applyReviewOutcome(result, "incomplete") : result;

    const runTerminalReviewerClassification = async (): Promise<{
      reviewOutcome: ReviewOutcome;
      terminalReview?: ReviewSummary;
    }> => {
      await updateCurrentSessionState({
        currentAgent: "reviewer",
        reviewSummary: undefined,
        codexReviewText: undefined,
      });
      printHeader("Running terminal reviewer classification...", "\x1b[36m");

      const reviewerPrompt = createReviewerPromptForAgent();

      const { reviewResult, reviewParseResult } = await runReviewerAndParseSummary(
        config,
        deps,
        reviewerPrompt,
        reviewOptions,
        agentProjectPathResolved
      );

      if (!reviewResult.success) {
        console.log("  ⚠️  Terminal reviewer classification failed. Marking result as incomplete.");
        return { reviewOutcome: "incomplete" };
      }

      if (!reviewParseResult.ok) {
        console.log(
          `  ⚠️  Terminal reviewer summary was invalid (${reviewParseResult.failureReason ?? "unknown error"}). Marking result as incomplete.`
        );
        return { reviewOutcome: "incomplete" };
      }

      const terminalReview = reviewParseResult.value;
      await updateCurrentSessionState({ reviewSummary: terminalReview });
      if (terminalReview.findings.length === 0) {
        return { reviewOutcome: "clean", terminalReview };
      }

      return { reviewOutcome: "incomplete", terminalReview };
    };

    if (reviewOptions?.simplifier) {
      await updateCurrentSessionState({ currentAgent: "code-simplifier" });
      printHeader("Running code simplifier agent...", "\x1b[34m");

      const { baseBranch, commitSha, customInstructions } = reviewOptions;
      const simplifierPrompt = deps.createCodeSimplifierPrompt({
        repoPath: agentProjectPath,
        baseBranch,
        commitSha,
        customInstructions,
      });
      currentTreeRetainable = false;
      const simplifierResult = await runAgentWithRetry(
        "code-simplifier",
        config,
        deps,
        simplifierPrompt,
        config.iterationTimeout,
        reviewOptions,
        agentProjectPath,
        {
          checkpointLabelPrefix: `${sessionId ?? "session"}-simplifier`,
        }
      );

      if (!simplifierResult.success) {
        const exitCode = simplifierResult.exitCode;
        if (isInterruptLikeFailure(simplifierResult)) {
          return finish(createInterruptedCycleResult(sessionPath, iteration));
        }
        console.log(formatAgentFailureWarning("code-simplifier", exitCode, retryConfig.maxRetries));
        return finish({
          success: false,
          finalStatus: "failed",
          iterations: 0,
          reason:
            `Code simplifier failed with exit code ${exitCode} ` +
            `after ${retryConfig.maxRetries} retries.`,
          sessionPath,
        });
      } else {
        currentTreeRetainable = true;
      }

      if (wasInterrupted()) {
        return finish(
          terminalIncompleteResult(
            determineCycleResult(true, iteration, config.maxIterations, true, sessionPath)
          )
        );
      }
    }

    while (iteration < config.maxIterations) {
      iteration++;
      const iterationStartTime = Date.now();

      if (wasInterrupted()) {
        const entry = createIterationEntry(iteration, iterationStartTime, {
          error: { phase: "reviewer", message: "Review cycle interrupted before iteration start" },
        });
        await deps.appendLog(sessionPath, entry);
        return finish(
          terminalIncompleteResult(
            determineCycleResult(
              hasRemainingIssues,
              iteration - 1,
              config.maxIterations,
              true,
              sessionPath
            )
          )
        );
      }

      await updateCurrentSessionState({
        currentAgent: "reviewer",
        iteration,
        reviewSummary: undefined,
        codexReviewText: undefined,
      });
      printHeader("Running reviewer...", "\x1b[36m");

      const reviewerPrompt = createReviewerPromptForAgent();

      const reviewerExecution = await runReviewerAndParseSummary(
        config,
        deps,
        reviewerPrompt,
        reviewOptions,
        agentProjectPath
      );
      const reviewResult = reviewerExecution.reviewResult;

      if (!reviewResult.success) {
        if (isInterruptLikeFailure(reviewResult)) {
          return finish(
            terminalIncompleteResult(
              await handleInterruptedAgentFailure(
                "reviewer",
                reviewResult.exitCode,
                iteration,
                iterationStartTime,
                sessionPath,
                deps
              )
            )
          );
        }
        return finish(
          terminalIncompleteResult(
            await handleAgentFailure(
              "reviewer",
              reviewResult.exitCode,
              retryConfig,
              iteration,
              iterationStartTime,
              sessionPath,
              deps
            )
          )
        );
      }

      const extractedReviewerText = reviewerExecution.extractedReviewerText;
      const reviewParseResult = reviewerExecution.reviewParseResult;

      if (onIteration) {
        onIteration(iteration, "reviewer", reviewResult);
      }

      if (wasInterrupted()) {
        const entry = createIterationEntry(iteration, iterationStartTime, {
          error: { phase: "reviewer", message: "Review cycle interrupted before fixer" },
        });
        await deps.appendLog(sessionPath, entry);
        return finish(
          terminalIncompleteResult(
            determineCycleResult(true, iteration, config.maxIterations, true, sessionPath)
          )
        );
      }

      await updateCurrentSessionState({ currentAgent: "fixer" });
      printHeader("Running fixer to verify and apply fixes...", "\x1b[35m");

      let reviewSummary: ReviewSummary | null = null;
      let codexReviewSummary: CodexReviewSummary | null = null;
      const reviewTextForFixer = extractedReviewerText ?? reviewResult.output;

      let reviewJson: string | null = null;

      if (config.reviewer.agent === "codex") {
        if (!reviewParseResult.ok) {
          console.log(
            `  ⚠️  Could not parse codex session review JSON (${reviewParseResult.failureReason ?? "unknown error"}). Falling back to raw codex output.`
          );
          codexReviewSummary = { text: reviewTextForFixer };
          await updateCurrentSessionState({ codexReviewText: reviewTextForFixer });
        }
      } else if (!reviewParseResult.ok) {
        console.log(
          `  ⚠️  Could not parse reviewer summary JSON (${reviewParseResult.failureReason ?? "unknown error"})`
        );
      }

      if (reviewParseResult.ok) {
        reviewSummary = reviewParseResult.value;
        reviewJson = JSON.stringify(reviewSummary);
        if (reviewParseResult.usedRepair) {
          console.log("  ⚠️  Reviewer summary required deterministic local JSON repair.");
        }
      }

      if (reviewSummary) {
        await updateCurrentSessionState({ reviewSummary });
      }

      const fixerPrompt = deps.createFixerPrompt(reviewJson ?? reviewTextForFixer);
      const fixerAgentModule = deps.AGENTS[config.fixer.agent];
      const fixerWorkspaceReset = {
        checkpointLabelPrefix: `${sessionId ?? "session"}-fixer-${iteration}`,
      };
      let fallbackFixerCheckpoint: GitCheckpoint | null = null;
      if (hasSuccessfulReviewIteration) {
        try {
          fallbackFixerCheckpoint = deps.createCheckpoint(
            agentProjectPathResolved,
            `${sessionId ?? "session"}-fixer-fallback-${iteration}-${Date.now()}`
          );
        } catch (error) {
          console.log(`  ⚠️  Failed to create pre-fixer fallback checkpoint: ${error}`);
        }
      }
      const restoreFallbackFixerCheckpoint = (): boolean => {
        if (!fallbackFixerCheckpoint) {
          return false;
        }
        const checkpoint = fallbackFixerCheckpoint;
        fallbackFixerCheckpoint = null;
        try {
          deps.rollbackToCheckpoint(agentProjectPathResolved, checkpoint);
          return true;
        } catch (error) {
          console.log(`  ⚠️  Failed to restore pre-fixer fallback checkpoint: ${error}`);
          try {
            deps.discardCheckpoint(agentProjectPathResolved, checkpoint);
          } catch (discardError) {
            console.log(
              `  ⚠️  Failed to discard pre-fixer fallback checkpoint after rollback error: ${discardError}`
            );
          }
          return false;
        }
      };
      const discardFallbackFixerCheckpoint = (): void => {
        if (!fallbackFixerCheckpoint) {
          return;
        }
        const checkpoint = fallbackFixerCheckpoint;
        fallbackFixerCheckpoint = null;
        try {
          deps.discardCheckpoint(agentProjectPathResolved, checkpoint);
        } catch (error) {
          console.log(`  ⚠️  Failed to discard pre-fixer fallback checkpoint: ${error}`);
        }
      };

      currentTreeRetainable = false;
      let fixResult = await runAgentWithRetry(
        "fixer",
        config,
        deps,
        fixerPrompt,
        config.iterationTimeout,
        undefined,
        agentProjectPath,
        fixerWorkspaceReset
      );
      let resultText = await fixerAgentModule.extractResult(fixResult.output);
      let fixParseResult = deps.parseFixSummaryOutput(resultText, fixResult.output);
      let fixSummary = fixParseResult.ok ? fixParseResult.value : null;

      if (fixResult.success && !fixSummary) {
        for (
          let attempt = 1;
          attempt <= FIXER_SUMMARY_RETRY_COUNT &&
          fixResult.success &&
          !fixSummary &&
          !wasInterrupted();
          attempt++
        ) {
          console.log(
            `  ⚠️  Fixer output missing structured summary (${fixParseResult.failureReason}). Retrying fixer with format reminder...`
          );
          const summaryRetryPrompt = `${fixerPrompt}\n${deps.createFixerSummaryRetryReminder()}`;
          fixResult = await runAgentWithRetry(
            "fixer",
            config,
            deps,
            summaryRetryPrompt,
            config.iterationTimeout,
            undefined,
            agentProjectPath,
            fixerWorkspaceReset
          );
          resultText = await fixerAgentModule.extractResult(fixResult.output);
          fixParseResult = deps.parseFixSummaryOutput(resultText, fixResult.output);
          fixSummary = fixParseResult.ok ? fixParseResult.value : null;
        }
      }

      if (fixParseResult.ok && fixParseResult.usedRepair) {
        console.log("  ⚠️  Fixer summary required deterministic local JSON repair.");
      }

      if (!fixSummary && fixResult.success) {
        console.log(
          `  ❌ Fixer returned incomplete output (missing fix summary JSON: ${fixParseResult.failureReason}).`
        );
        const entry = createIterationEntry(iteration, iterationStartTime, {
          error: {
            phase: "fixer",
            message: `Fixer output incomplete: missing fix summary JSON (${fixParseResult.failureReason})`,
          },
          review: reviewSummary ?? undefined,
          codexReview: codexReviewSummary ?? undefined,
        });
        await deps.appendLog(sessionPath, entry);
        const result = {
          success: false,
          finalStatus: "failed" as const,
          iterations: iteration,
          reason: "Fixer output incomplete (missing fix summary JSON).",
          sessionPath,
        };
        currentTreeRetainable = restoreFallbackFixerCheckpoint();
        return finish(currentTreeRetainable ? terminalIncompleteResult(result) : result);
      }

      if (onIteration) {
        onIteration(iteration, "fixer", fixResult);
      }

      if (!fixResult.success) {
        if (isInterruptLikeFailure(fixResult)) {
          const interruptedResult = await handleInterruptedAgentFailure(
            "fixer",
            fixResult.exitCode,
            iteration,
            iterationStartTime,
            sessionPath,
            deps,
            {
              review: reviewSummary ?? undefined,
              codexReview: codexReviewSummary ?? undefined,
            }
          );
          currentTreeRetainable = restoreFallbackFixerCheckpoint();
          return finish(
            currentTreeRetainable ? terminalIncompleteResult(interruptedResult) : interruptedResult
          );
        }
        const failedResult = await handleAgentFailure(
          "fixer",
          fixResult.exitCode,
          retryConfig,
          iteration,
          iterationStartTime,
          sessionPath,
          deps,
          {
            review: reviewSummary ?? undefined,
            codexReview: codexReviewSummary ?? undefined,
          }
        );
        currentTreeRetainable = restoreFallbackFixerCheckpoint();
        return finish(
          currentTreeRetainable ? terminalIncompleteResult(failedResult) : failedResult
        );
      }

      discardFallbackFixerCheckpoint();

      const iterationEntry = createIterationEntry(iteration, iterationStartTime, {
        review: reviewSummary ?? undefined,
        codexReview: codexReviewSummary ?? undefined,
        fixes: fixSummary ?? undefined,
      });
      await deps.appendLog(sessionPath, iterationEntry);

      currentTreeRetainable = true;
      hasSuccessfulReviewIteration = true;

      if (fixSummary?.stop_iteration === true) {
        hasRemainingIssues = false;
        console.log("✅ No issues to fix - code is clean!");
        if (!reviewOptions?.forceMaxIterations) {
          return finish(
            applyReviewOutcome(
              determineCycleResult(false, iteration, config.maxIterations, false, sessionPath),
              "clean"
            )
          );
        }
        console.log("ℹ️  stop_iteration true; continuing due to --force");
      } else {
        // Treat any non-clean signal conservatively and continue iterating.
        hasRemainingIssues = true;
      }

      printHeader("Fixes applied. Re-running reviewer...", "\x1b[36m");
    }

    if (reviewOptions?.forceMaxIterations && !hasRemainingIssues) {
      console.log(`ℹ️  Max iterations (${config.maxIterations}) reached after clean pass`);
    } else {
      console.log(`⚠️  Max iterations (${config.maxIterations}) reached`);
    }

    const terminalClassification = await runTerminalReviewerClassification();
    return finish(
      applyReviewOutcome(
        determineCycleResult(
          terminalClassification.reviewOutcome !== "clean",
          iteration,
          config.maxIterations,
          wasInterrupted(),
          sessionPath
        ),
        terminalClassification.reviewOutcome,
        terminalClassification.terminalReview
      )
    );
  } catch (error) {
    unhandledError = error;
    throw error;
  } finally {
    if (worktree) {
      if (finalResult?.reviewOutcome) {
        try {
          if (
            finalResult?.reviewOutcome &&
            currentTreeRetainable &&
            (hasSuccessfulReviewIteration || finalResult.finalStatus !== "interrupted")
          ) {
            const autoApply =
              finalResult.reviewOutcome === "clean" && finalResult.finalStatus === "completed";
            const handoff = await deps.createOrAutoApplyHandoff(undefined, {
              sessionId: sessionId ?? "session",
              projectPath,
              logPath: sessionPath,
              worktree,
              autoApply,
            });
            finalResult = applyHandoffResult(finalResult, handoff);
            try {
              deps.discardSessionWorktree(worktree);
            } catch (discardError) {
              finalResult = applyWorktreeCleanupFailure(
                finalResult,
                sessionPath,
                iteration,
                "discard",
                discardError
              );
            }
          } else if (finalResult) {
            try {
              deps.discardSessionWorktree(worktree);
            } catch (discardError) {
              finalResult = applyWorktreeCleanupFailure(
                finalResult,
                sessionPath,
                iteration,
                "discard",
                discardError
              );
            }
          }
        } catch (error) {
          try {
            deps.discardSessionWorktree(worktree);
          } catch (discardError) {
            console.log(`  ⚠️  Failed to discard worktree after finalize error: ${discardError}`);
          }
          finalResult = applyWorktreeCleanupFailure(
            finalResult,
            sessionPath,
            iteration,
            "finalize",
            error
          );
        }
      } else {
        try {
          deps.discardSessionWorktree(worktree);
        } catch (error) {
          console.log(`  ⚠️  Failed to discard session worktree: ${error}`);
          finalResult = applyWorktreeCleanupFailure(
            finalResult,
            sessionPath,
            iteration,
            "discard",
            error
          );
        }
      }
    }

    const sessionEndEntry = createSessionEndEntry(
      finalResult,
      unhandledError,
      wasInterrupted(),
      iteration
    );
    await deps.appendLog(sessionPath, sessionEndEntry).catch(() => {});
  }
}
