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
  createDiscoveryReviewerPrompt,
  type DiscoveryReviewerPromptOptions,
} from "@/lib/review-workflow/discovery/prompt";
import { runDiscoveryPhase } from "@/lib/review-workflow/discovery/run-discovery-phase";
import type { DiscoverySessionResult } from "@/lib/review-workflow/discovery/types";
import {
  getFindingsArtifactPath,
  saveFindingsArtifact,
} from "@/lib/review-workflow/findings/artifact";
import type { FindingsArtifact, StoredFinding } from "@/lib/review-workflow/findings/types";
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

export interface RunDiscoveryRuntimeContext {
  projectPath?: string;
  sessionId?: string;
  sessionPath?: string;
}

export interface RunDiscoverySessionDependencies {
  createDiscoveryReviewerPrompt: typeof createDiscoveryReviewerPrompt;
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

export const DEFAULT_RUN_DISCOVERY_SESSION_DEPENDENCIES: RunDiscoverySessionDependencies = {
  createDiscoveryReviewerPrompt,
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

async function updateDiscoverySessionState(
  deps: RunDiscoverySessionDependencies,
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
  deps: RunDiscoverySessionDependencies,
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
  deps: RunDiscoverySessionDependencies,
  reviewOptions: ReviewOptions | undefined,
  baselineCommitSha: string,
  reviewerCwd: string,
  iteration: number,
  knownFindings: StoredFinding[],
  wasInterrupted: () => boolean
): Promise<{ summary: ReviewSummary; duration: number }> {
  const promptOptions: DiscoveryReviewerPromptOptions = {
    repoPath: reviewerCwd,
    baselineCommitSha,
    includeDefaultReviewPrompt: config.reviewer.agent !== "codex",
    baseBranch: reviewOptions?.baseBranch,
    commitSha: reviewOptions?.commitSha,
    customInstructions: reviewOptions?.customInstructions,
    knownFindings,
    iteration,
  };
  const reviewerPrompt = deps.createDiscoveryReviewerPrompt(promptOptions);
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
      throw new Error("Discovery reviewer interrupted");
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
        throw new Error("Discovery reviewer interrupted");
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
  worktree: NonNullable<ReturnType<RunDiscoverySessionDependencies["createSessionWorktree"]>>,
  findings: StoredFinding[]
): FindingsArtifact {
  const timestamp = new Date().toISOString();
  const baselineCommitSha = worktree.baselineCommitSha;
  const baselineRef = worktree.baselineRef;
  const sourceBaselineCommitSha = worktree.sourceBaselineCommitSha;
  const sourceBaselineRef = worktree.sourceBaselineRef;
  const sourceBaselineFingerprint = worktree.sourceBaselineFingerprint;

  if (!baselineCommitSha || !baselineRef || !sourceBaselineCommitSha || !sourceBaselineRef) {
    throw new Error("Discovery worktree is missing baseline metadata.");
  }

  if (!sourceBaselineFingerprint) {
    throw new Error("Discovery worktree is missing source baseline fingerprint.");
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

export async function runDiscoverySession(
  config: Config,
  reviewOptions: ReviewOptions | undefined,
  runtimeContext: RunDiscoveryRuntimeContext | undefined,
  wasInterrupted: () => boolean,
  deps: RunDiscoverySessionDependencies = DEFAULT_RUN_DISCOVERY_SESSION_DEPENDENCIES
): Promise<{
  sessionPath: string;
  result: DiscoverySessionResult;
}> {
  const projectPath = runtimeContext?.projectPath ?? process.cwd();
  const sessionId = runtimeContext?.sessionId ?? "session";
  const gitBranch = await deps.getGitBranch(projectPath);
  const sessionPath =
    runtimeContext?.sessionPath ?? (await deps.createLogSession(undefined, projectPath, gitBranch));

  let worktree: ReturnType<RunDiscoverySessionDependencies["createSessionWorktree"]> | null = null;
  let shouldDeleteSessionRefs = true;

  try {
    await updateDiscoverySessionState(deps, projectPath, runtimeContext?.sessionId, {
      sessionPath,
      currentPhase: "discovery",
      phase: "discovery",
      sessionStatus: "running",
      currentAgent: null,
    });

    worktree = deps.createSessionWorktree(projectPath, sessionId);
    const reviewerCwd = worktree.agentProjectPath;

    await updateDiscoverySessionState(deps, projectPath, runtimeContext?.sessionId, {
      sessionPath,
      currentPhase: "discovery",
      phase: "discovery",
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
      throw new Error("Discovery baseline metadata is incomplete.");
    }

    const artifactPath = getFindingsArtifactPath(CONFIG_DIR, projectPath, sessionId);

    await updateDiscoverySessionState(deps, projectPath, runtimeContext?.sessionId, {
      currentPhase: "discovery",
      phase: "discovery",
      sessionStatus: "running",
      currentAgent: null,
      artifactPath,
      baselineCommitSha: reviewerBaselineCommitSha,
      sourceBaselineFingerprint: worktree.sourceBaselineFingerprint,
      accumulatedFindings: [],
      selectedFindingIds: [],
    });

    const phaseResult = await runDiscoveryPhase({
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
      await updateDiscoverySessionState(deps, projectPath, runtimeContext?.sessionId, {
        currentPhase: "discovery",
        phase: "discovery",
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
          phase: "discovery",
          sessionStatus: phaseResult.sessionStatus,
          reviewOutcome: phaseResult.sessionStatus === "interrupted" ? "incomplete" : "clean",
          reason:
            phaseResult.sessionStatus === "interrupted"
              ? "Discovery was interrupted before it completed."
              : "Discovery found no actionable findings.",
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
    await updateDiscoverySessionState(deps, projectPath, runtimeContext?.sessionId, {
      currentPhase: "discovery",
      phase: "discovery",
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
        phase: "discovery",
        sessionStatus: phaseResult.sessionStatus,
        reviewOutcome: "findings-pending",
        reason:
          phaseResult.sessionStatus === "interrupted"
            ? "Discovery was interrupted after persisting findings."
            : "Discovery complete: findings pending.",
        iterations: phaseResult.iterations,
        findings: phaseResult.findings,
        artifact: savedArtifact,
        artifactPath,
      },
    };
  } catch (error) {
    await updateDiscoverySessionState(deps, projectPath, runtimeContext?.sessionId, {
      currentPhase: "discovery",
      phase: "discovery",
      sessionStatus: wasInterrupted() ? "interrupted" : "failed",
      currentAgent: null,
      reviewOutcome: "incomplete",
    });

    return {
      sessionPath,
      result: {
        phase: "discovery",
        sessionStatus: wasInterrupted() ? "interrupted" : "failed",
        reviewOutcome: "incomplete",
        reason:
          error instanceof Error
            ? `Discovery failed: ${error.message}`
            : `Discovery failed: ${error}`,
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
