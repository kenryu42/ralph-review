import { AGENTS, runAgent } from "@/lib/agents";
import { CONFIG_DIR } from "@/lib/config";
import {
  computeWorkingTreeFingerprintAsync,
  createCheckpoint,
  createSessionWorktree,
  deleteSessionRefs,
  discardCheckpoint,
  discardSessionWorktree,
  rollbackToCheckpoint,
} from "@/lib/git";
import { appendLog, createLogSession, getGitBranch } from "@/lib/logging";
import { createReviewerSummaryRetryReminder } from "@/lib/prompts/protocol";
import {
  getFindingsArtifactPath,
  saveFindingsArtifact,
} from "@/lib/review-workflow/findings/artifact";
import type { FindingsArtifact, StoredFinding } from "@/lib/review-workflow/findings/types";
import {
  createReviewerPrompt,
  type ReviewerPromptOptions,
} from "@/lib/review-workflow/review/prompt";
import { runReviewPhase } from "@/lib/review-workflow/review/run-review-phase";
import type { ReviewSessionResult } from "@/lib/review-workflow/review/types";
import { type SessionState, updateSessionState } from "@/lib/session";
import { parseReviewSummaryOutput } from "@/lib/structured-output";
import type {
  Config,
  IterationResult,
  ReviewOptions,
  ReviewSummary,
  SystemEntry,
} from "@/lib/types";
import { DEFAULT_RETRY_CONFIG } from "@/lib/types";

export interface RunReviewRuntimeContext {
  projectPath?: string;
  sessionId?: string;
  sessionPath?: string;
}

export interface RunReviewSessionDependencies {
  createReviewerPrompt: typeof createReviewerPrompt;
  createReviewerSummaryRetryReminder: typeof createReviewerSummaryRetryReminder;
  AGENTS: typeof AGENTS;
  runAgent: typeof runAgent;
  createCheckpoint: typeof createCheckpoint;
  computeWorkingTreeFingerprintAsync: typeof computeWorkingTreeFingerprintAsync;
  createSessionWorktree: typeof createSessionWorktree;
  deleteSessionRefs: typeof deleteSessionRefs;
  discardCheckpoint: typeof discardCheckpoint;
  discardSessionWorktree: typeof discardSessionWorktree;
  rollbackToCheckpoint: typeof rollbackToCheckpoint;
  updateSessionState: typeof updateSessionState;
  appendLog: typeof appendLog;
  createLogSession: typeof createLogSession;
  getGitBranch: typeof getGitBranch;
  parseReviewSummaryOutput: typeof parseReviewSummaryOutput;
  saveFindingsArtifact: typeof saveFindingsArtifact;
}

export const DEFAULT_RUN_REVIEW_SESSION_DEPENDENCIES: RunReviewSessionDependencies = {
  createReviewerPrompt,
  createReviewerSummaryRetryReminder,
  AGENTS,
  runAgent,
  createCheckpoint,
  computeWorkingTreeFingerprintAsync,
  createSessionWorktree,
  deleteSessionRefs,
  discardCheckpoint,
  discardSessionWorktree,
  rollbackToCheckpoint,
  updateSessionState,
  appendLog,
  createLogSession,
  getGitBranch,
  parseReviewSummaryOutput,
  saveFindingsArtifact,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateRetryDelay(attempt: number, config: Config): number {
  const retryConfig = config.retry ?? DEFAULT_RETRY_CONFIG;
  const exponentialDelay = retryConfig.baseDelayMs * 2 ** attempt;
  const jitter = Math.random() * (exponentialDelay / 2);
  return Math.min(exponentialDelay + jitter, retryConfig.maxDelayMs);
}

function isInterruptLikeFailure(result: IterationResult, wasInterrupted: () => boolean): boolean {
  return !result.success && (wasInterrupted() || result.exitCode === 130);
}

async function updateReviewSessionState(
  deps: RunReviewSessionDependencies,
  projectPath: string,
  sessionId: string | undefined,
  updates: Partial<SessionState>
): Promise<void> {
  if (!sessionId) {
    return;
  }

  await deps
    .updateSessionState(undefined, projectPath, sessionId, updates, {
      expectedSessionId: sessionId,
    })
    .catch(() => {});
}

async function runAgentWithRetry(
  role: "reviewer",
  config: Config,
  deps: RunReviewSessionDependencies,
  prompt: string,
  reviewOptions: ReviewOptions | undefined,
  cwd: string,
  wasInterrupted: () => boolean,
  workspaceReset?: {
    checkpointLabelPrefix: string;
  }
): Promise<IterationResult> {
  const retryConfig = config.retry ?? DEFAULT_RETRY_CONFIG;

  const runAttempt = async (attempt: number): Promise<IterationResult> => {
    if (!workspaceReset) {
      return deps.runAgent(role, config, prompt, config.iterationTimeout, reviewOptions, cwd);
    }

    const checkpoint = deps.createCheckpoint(
      cwd,
      `${workspaceReset.checkpointLabelPrefix}-${attempt + 1}-${Date.now()}`
    );

    try {
      const result = await deps.runAgent(
        role,
        config,
        prompt,
        config.iterationTimeout,
        reviewOptions,
        cwd
      );

      if (result.success) {
        deps.discardCheckpoint(cwd, checkpoint);
      } else {
        deps.rollbackToCheckpoint(cwd, checkpoint);
      }

      return result;
    } catch (error) {
      deps.rollbackToCheckpoint(cwd, checkpoint);
      throw error;
    }
  };

  let result = await runAttempt(0);
  if (result.success || isInterruptLikeFailure(result, wasInterrupted)) {
    return result;
  }

  for (let attempt = 1; attempt <= retryConfig.maxRetries; attempt++) {
    await sleep(calculateRetryDelay(attempt - 1, config));
    result = await runAttempt(attempt);
    if (result.success || isInterruptLikeFailure(result, wasInterrupted)) {
      return result;
    }
  }

  return result;
}

async function runReviewerIteration(
  config: Config,
  deps: RunReviewSessionDependencies,
  reviewOptions: ReviewOptions | undefined,
  baselineCommitSha: string,
  reviewerCwd: string,
  iteration: number,
  knownFindings: StoredFinding[],
  wasInterrupted: () => boolean
): Promise<{ summary: ReviewSummary; duration: number }> {
  const promptOptions: ReviewerPromptOptions = {
    repoPath: reviewerCwd,
    baselineCommitSha,
    includeDefaultReviewPrompt: config.reviewer.agent !== "codex",
    baseBranch: reviewOptions?.baseBranch,
    commitSha: reviewOptions?.commitSha,
    customInstructions: reviewOptions?.customInstructions,
    knownFindings,
    iteration,
  };
  const reviewerPrompt = deps.createReviewerPrompt(promptOptions);
  const startTime = Date.now();

  let reviewResult = await runAgentWithRetry(
    "reviewer",
    config,
    deps,
    reviewerPrompt,
    reviewOptions,
    reviewerCwd,
    wasInterrupted
  );
  if (!reviewResult.success) {
    if (isInterruptLikeFailure(reviewResult, wasInterrupted)) {
      throw new Error("Reviewer interrupted");
    }
    throw new Error(`Reviewer failed with exit code ${reviewResult.exitCode}`);
  }

  const reviewerAgentModule = deps.AGENTS[config.reviewer.agent];
  let extractedReviewerText = await reviewerAgentModule.extractResult(reviewResult.output);
  let reviewParseResult = deps.parseReviewSummaryOutput(extractedReviewerText, reviewResult.output);

  if (!reviewParseResult.ok && !wasInterrupted()) {
    const retryPrompt = `${reviewerPrompt}\n${deps.createReviewerSummaryRetryReminder()}`;
    reviewResult = await runAgentWithRetry(
      "reviewer",
      config,
      deps,
      retryPrompt,
      reviewOptions,
      reviewerCwd,
      wasInterrupted
    );

    if (!reviewResult.success) {
      if (isInterruptLikeFailure(reviewResult, wasInterrupted)) {
        throw new Error("Reviewer interrupted");
      }
      throw new Error(`Reviewer failed with exit code ${reviewResult.exitCode}`);
    }

    extractedReviewerText = await reviewerAgentModule.extractResult(reviewResult.output);
    reviewParseResult = deps.parseReviewSummaryOutput(extractedReviewerText, reviewResult.output);
  }

  if (!reviewParseResult.ok) {
    throw new Error(
      `Reviewer output missing valid structured summary (${reviewParseResult.failureReason ?? "unknown error"})`
    );
  }

  return {
    summary: reviewParseResult.value,
    duration: Date.now() - startTime,
  };
}

function createFindingsArtifact(
  sessionId: string,
  projectPath: string,
  sessionPath: string,
  worktree: NonNullable<ReturnType<RunReviewSessionDependencies["createSessionWorktree"]>>,
  findings: StoredFinding[]
): FindingsArtifact {
  const timestamp = new Date().toISOString();
  const baselineCommitSha = worktree.baselineCommitSha;
  const baselineRef = worktree.baselineRef;
  const sourceBaselineCommitSha = worktree.sourceBaselineCommitSha;
  const sourceBaselineRef = worktree.sourceBaselineRef;
  const sourceBaselineFingerprint = worktree.sourceBaselineFingerprint;

  if (!baselineCommitSha || !baselineRef || !sourceBaselineCommitSha || !sourceBaselineRef) {
    throw new Error("Review worktree is missing baseline metadata.");
  }

  if (!sourceBaselineFingerprint) {
    throw new Error("Review worktree is missing source baseline fingerprint.");
  }

  return {
    artifactVersion: 1,
    sessionId,
    projectPath,
    logPath: sessionPath,
    baselineRef,
    baselineCommitSha,
    sourceBaselineRef,
    sourceBaselineCommitSha,
    sourceBaselineFingerprint,
    findings,
    selectedFindingIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function runReviewSession(
  config: Config,
  reviewOptions: ReviewOptions | undefined,
  runtimeContext: RunReviewRuntimeContext | undefined,
  wasInterrupted: () => boolean,
  deps: RunReviewSessionDependencies = DEFAULT_RUN_REVIEW_SESSION_DEPENDENCIES
): Promise<{
  sessionPath: string;
  result: ReviewSessionResult;
}> {
  const projectPath = runtimeContext?.projectPath ?? process.cwd();
  const sessionId = runtimeContext?.sessionId ?? "session";
  const gitBranch = await deps.getGitBranch(projectPath);
  const sessionPath =
    runtimeContext?.sessionPath ?? (await deps.createLogSession(undefined, projectPath, gitBranch));

  let worktree: ReturnType<RunReviewSessionDependencies["createSessionWorktree"]> | null = null;
  let shouldDeleteSessionRefs = true;

  try {
    await updateReviewSessionState(deps, projectPath, runtimeContext?.sessionId, {
      sessionPath,
      currentPhase: "review",
      phase: "review",
      sessionStatus: "running",
      currentAgent: null,
    });

    worktree = deps.createSessionWorktree(projectPath, sessionId);
    const reviewerCwd = worktree.agentProjectPath;

    await updateReviewSessionState(deps, projectPath, runtimeContext?.sessionId, {
      sessionPath,
      currentPhase: "review",
      phase: "review",
      sessionStatus: "running",
      worktreeProjectPath: worktree.worktreeProjectPath,
      worktreeBranch: worktree.retainedBranch,
    });

    const systemEntry: SystemEntry = {
      type: "system",
      timestamp: Date.now(),
      sessionId: runtimeContext?.sessionId,
      projectPath,
      gitBranch,
      worktreeProjectPath: worktree.worktreeProjectPath,
      worktreeBranch: worktree.retainedBranch,
      reviewer: config.reviewer,
      fixer: config.fixer,
      maxIterations: config.maxIterations,
      reviewOptions,
    };
    await deps.appendLog(sessionPath, systemEntry);

    const reviewerBaselineCommitSha = worktree.baselineCommitSha;
    const reviewerBaselineFingerprint = worktree.sourceBaselineFingerprint;

    if (!reviewerBaselineCommitSha || !reviewerBaselineFingerprint) {
      throw new Error("Review baseline metadata is incomplete.");
    }

    const artifactPath = getFindingsArtifactPath(CONFIG_DIR, projectPath, sessionId);

    await updateReviewSessionState(deps, projectPath, runtimeContext?.sessionId, {
      currentPhase: "review",
      phase: "review",
      sessionStatus: "running",
      currentAgent: null,
      artifactPath,
      baselineCommitSha: reviewerBaselineCommitSha,
      sourceBaselineFingerprint: worktree.sourceBaselineFingerprint,
      accumulatedFindings: [],
      selectedFindingIds: [],
    });

    const phaseResult = await runReviewPhase({
      config,
      reviewOptions,
      sessionId: runtimeContext?.sessionId,
      projectPath,
      findingPathRoots: [projectPath, reviewerCwd],
      sessionPath,
      reviewerWorktreePath: reviewerCwd,
      baselineFingerprint: reviewerBaselineFingerprint,
      appendLog: deps.appendLog,
      updateSessionState: deps.updateSessionState,
      computeWorkingTreeFingerprint: deps.computeWorkingTreeFingerprintAsync,
      wasInterrupted,
      runReviewerIteration: async (iteration, knownFindings) => {
        const reviewerResult = await runReviewerIteration(
          config,
          deps,
          reviewOptions,
          reviewerBaselineCommitSha,
          reviewerCwd,
          iteration,
          knownFindings,
          wasInterrupted
        );

        return {
          findings: reviewerResult.summary.findings,
          duration: reviewerResult.duration,
        };
      },
    });

    if (phaseResult.findings.length === 0) {
      await updateReviewSessionState(deps, projectPath, runtimeContext?.sessionId, {
        currentPhase: "review",
        phase: "review",
        sessionStatus: phaseResult.sessionStatus,
        currentAgent: null,
        accumulatedFindings: [],
        selectedFindingIds: [],
        reviewOutcome: phaseResult.sessionStatus === "interrupted" ? "incomplete" : "clean",
      });

      if (phaseResult.sessionStatus !== "interrupted") {
        deps.deleteSessionRefs(projectPath, sessionId);
      }

      return {
        sessionPath,
        result: {
          phase: "review",
          sessionStatus: phaseResult.sessionStatus,
          reviewOutcome: phaseResult.sessionStatus === "interrupted" ? "incomplete" : "clean",
          reason:
            phaseResult.sessionStatus === "interrupted"
              ? "Review was interrupted before it completed."
              : "Review found no actionable findings.",
          iterations: phaseResult.iterations,
          findings: [],
        },
      };
    }

    const savedArtifact = await deps.saveFindingsArtifact(
      CONFIG_DIR,
      createFindingsArtifact(sessionId, projectPath, sessionPath, worktree, phaseResult.findings)
    );
    shouldDeleteSessionRefs = false;
    await updateReviewSessionState(deps, projectPath, runtimeContext?.sessionId, {
      currentPhase: "review",
      phase: "review",
      sessionStatus: phaseResult.sessionStatus,
      currentAgent: null,
      artifactPath,
      baselineCommitSha: worktree.baselineCommitSha,
      sourceBaselineFingerprint: worktree.sourceBaselineFingerprint,
      accumulatedFindings: phaseResult.findings,
      selectedFindingIds: [],
      reviewOutcome: "findings-pending",
    });

    return {
      sessionPath,
      result: {
        phase: "review",
        sessionStatus: phaseResult.sessionStatus,
        reviewOutcome: "findings-pending",
        reason:
          phaseResult.sessionStatus === "interrupted"
            ? "Review was interrupted after persisting findings."
            : "Review complete: findings pending.",
        iterations: phaseResult.iterations,
        findings: phaseResult.findings,
        artifact: savedArtifact,
        artifactPath,
      },
    };
  } catch (error) {
    await updateReviewSessionState(deps, projectPath, runtimeContext?.sessionId, {
      currentPhase: "review",
      phase: "review",
      sessionStatus: wasInterrupted() ? "interrupted" : "failed",
      currentAgent: null,
      reviewOutcome: "incomplete",
    });

    return {
      sessionPath,
      result: {
        phase: "review",
        sessionStatus: wasInterrupted() ? "interrupted" : "failed",
        reviewOutcome: "incomplete",
        reason:
          error instanceof Error ? `Review failed: ${error.message}` : `Review failed: ${error}`,
        iterations: 0,
        findings: [],
      },
    };
  } finally {
    if (shouldDeleteSessionRefs && worktree) {
      try {
        deps.deleteSessionRefs(projectPath, sessionId);
      } catch {
        // Best effort cleanup; final session result is still reported to the caller.
      }
    }
    if (worktree) {
      try {
        deps.discardSessionWorktree(worktree);
      } catch {
        // Best effort cleanup; final session result is still reported to the caller.
      }
    }
  }
}
