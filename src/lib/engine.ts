import { createCodeSimplifierPrompt, createFixerPrompt, createReviewerPrompt } from "@/lib/prompts";
import { AGENTS, runAgent } from "./agents";
import {
  createCheckpoint,
  discardCheckpoint,
  type GitCheckpoint,
  rollbackToCheckpoint,
} from "./git";
import { updateLockfile } from "./lockfile";
import { appendLog, createLogSession, getGitBranch } from "./logger";
import type {
  AgentRole,
  CodexReviewSummary,
  Config,
  FixSummary,
  IterationEntry,
  IterationResult,
  RetryConfig,
  ReviewOptions,
  ReviewSummary,
  RollbackActionResult,
  SessionEndEntry,
  SystemEntry,
} from "./types";
import { DEFAULT_RETRY_CONFIG, isFixSummary, isReviewSummary } from "./types";

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
    rollback?: RollbackActionResult;
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
    ...(options.rollback && { rollback: options.rollback }),
  };
}

async function handleAgentFailure(
  role: AgentRole,
  exitCode: number,
  retryConfig: RetryConfig,
  iteration: number,
  startTime: number,
  sessionPath: string,
  options: {
    review?: ReviewSummary;
    codexReview?: CodexReviewSummary;
    rollback?: RollbackActionResult;
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
    rollback: options.rollback,
  });
  await appendLog(sessionPath, entry);

  const brokenWarning = role === "fixer" ? " Code may be in a broken state!" : "";
  const rollbackSuffix = rollbackReasonSuffix(options.rollback);
  return {
    success: false,
    finalStatus: "failed",
    iterations: iteration,
    reason:
      `${role.charAt(0).toUpperCase() + role.slice(1)} failed with exit code ${exitCode} after ${retryConfig.maxRetries} retries.` +
      `${brokenWarning}${rollbackSuffix}`,
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
  prompt: string = "",
  timeout: number = config.iterationTimeout,
  reviewOptions?: ReviewOptions
): Promise<IterationResult> {
  const retryConfig = config.retry ?? DEFAULT_RETRY_CONFIG;

  let result = await runAgent(role, config, prompt, timeout, reviewOptions);

  if (result.success) {
    return result;
  }

  console.log(`  ❌ ${role} failed (exit code ${result.exitCode})`);

  for (let attempt = 1; attempt <= retryConfig.maxRetries; attempt++) {
    const delay = calculateRetryDelay(attempt - 1, retryConfig);
    console.log(
      `  ⏳ Retry ${attempt}/${retryConfig.maxRetries} in ${Math.round(delay / 1000)}s...`
    );
    await sleep(delay);

    result = await runAgent(role, config, prompt, timeout, reviewOptions);

    if (result.success) {
      return result;
    }

    console.log(`  ❌ ${role} failed (exit code ${result.exitCode})`);
  }

  return result;
}

export interface CycleResult {
  success: boolean;
  finalStatus: SessionEndEntry["status"];
  iterations: number;
  reason: string;
  sessionPath: string;
}

const FIXER_SUMMARY_RETRY_COUNT = 1;

function createRollbackOutcome(
  attempted: boolean,
  success: boolean,
  reason?: string
): RollbackActionResult {
  return {
    attempted,
    success,
    ...(reason ? { reason } : {}),
  };
}

export function rollbackReasonSuffix(rollback: RollbackActionResult | undefined): string {
  if (!rollback) {
    return "";
  }

  if (rollback.success) {
    return " Changes were rolled back to the pre-fixer checkpoint.";
  }

  const reason = rollback.reason ?? "unknown rollback error";
  return ` Rollback failed (${reason}). Please restore manually from git history.`;
}

function applyRollback(projectPath: string, checkpoint: GitCheckpoint): RollbackActionResult {
  try {
    rollbackToCheckpoint(projectPath, checkpoint);
    return createRollbackOutcome(true, true);
  } catch (error) {
    return createRollbackOutcome(true, false, `${error}`);
  }
}

export type OnIterationCallback = (
  iteration: number,
  role: "reviewer" | "fixer",
  result: IterationResult
) => void;

export interface RunReviewRuntimeContext {
  projectPath?: string;
  sessionId?: string;
}

export function extractJsonBlock(output: string): string | null {
  const match = output.match(/```json\s*\n([\s\S]*?)\n```/);
  if (!match?.[1]) {
    return null;
  }
  return match[1].trim();
}

function extractBalancedJsonObjects(text: string): string[] {
  const objects: string[] = [];
  let depth = 0;
  let startIndex = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (inString) {
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        startIndex = i;
      }
      depth += 1;
      continue;
    }

    if (char === "}") {
      if (depth === 0) {
        continue;
      }

      depth -= 1;
      if (depth === 0 && startIndex >= 0) {
        objects.push(text.slice(startIndex, i + 1));
        startIndex = -1;
      }
    }
  }

  return objects;
}

export function extractFixSummaryFromOutput(
  resultText: string | null,
  rawOutput: string
): FixSummary | null {
  const candidates = [resultText, rawOutput]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim());
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);

    const blockJson = extractJsonBlock(candidate);
    if (blockJson) {
      const parsedBlock = parseFixSummary(blockJson);
      if (parsedBlock) {
        return parsedBlock;
      }
    }

    const parsedDirect = parseFixSummary(candidate);
    if (parsedDirect) {
      return parsedDirect;
    }

    const objects = extractBalancedJsonObjects(candidate);
    for (let index = objects.length - 1; index >= 0; index--) {
      const objectJson = objects[index];
      if (!objectJson) {
        continue;
      }

      const parsedObject = parseFixSummary(objectJson);
      if (parsedObject) {
        return parsedObject;
      }
    }
  }

  return null;
}

export function parseFixSummary(jsonString: string): FixSummary | null {
  try {
    const parsed: unknown = JSON.parse(jsonString);
    if (isFixSummary(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function parseReviewSummary(jsonString: string): ReviewSummary | null {
  try {
    const parsed: unknown = JSON.parse(jsonString);
    if (isReviewSummary(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
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
  runtimeContext?: RunReviewRuntimeContext
): Promise<CycleResult> {
  resetInterrupt();
  setupSignalHandler();

  const projectPath = runtimeContext?.projectPath ?? process.cwd();
  const sessionId = runtimeContext?.sessionId;
  const gitBranch = await getGitBranch(projectPath);
  const sessionPath = await createLogSession(undefined, projectPath, gitBranch);
  if (sessionId) {
    await updateLockfile(
      undefined,
      projectPath,
      {
        sessionPath,
      },
      {
        expectedSessionId: sessionId,
      }
    ).catch(() => {});
  }
  const systemEntry: SystemEntry = {
    type: "system",
    timestamp: Date.now(),
    sessionId,
    projectPath,
    gitBranch,
    reviewer: config.reviewer,
    fixer: config.fixer,
    codeSimplifier: config["code-simplifier"],
    maxIterations: config.maxIterations,
    reviewOptions,
  };
  await appendLog(sessionPath, systemEntry);

  let finalResult: CycleResult | undefined;
  let unhandledError: unknown;
  const finish = (result: CycleResult): CycleResult => {
    finalResult = result;
    return result;
  };

  let iteration = 0;
  let hasRemainingIssues = true;
  const retryConfig = config.retry ?? DEFAULT_RETRY_CONFIG;

  try {
    if (reviewOptions?.simplifier) {
      await updateLockfile(
        undefined,
        projectPath,
        { currentAgent: "code-simplifier" },
        {
          expectedSessionId: sessionId,
        }
      ).catch(() => {});
      printHeader("Running code simplifier agent...", "\x1b[34m");

      const { baseBranch, commitSha, customInstructions } = reviewOptions;

      const simplifierPrompt = createCodeSimplifierPrompt({
        repoPath: projectPath,
        baseBranch,
        commitSha,
        customInstructions,
      });
      const simplifierResult = await runAgentWithRetry(
        "code-simplifier",
        config,
        simplifierPrompt,
        config.iterationTimeout,
        reviewOptions
      );

      if (!simplifierResult.success) {
        const exitCode = simplifierResult.exitCode;
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
      }

      if (wasInterrupted()) {
        return finish(
          determineCycleResult(true, iteration, config.maxIterations, true, sessionPath)
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
        await appendLog(sessionPath, entry);
        return finish(
          determineCycleResult(
            hasRemainingIssues,
            iteration - 1,
            config.maxIterations,
            true,
            sessionPath
          )
        );
      }

      await updateLockfile(
        undefined,
        projectPath,
        {
          currentAgent: "reviewer",
          iteration,
          reviewSummary: undefined,
          codexReviewText: undefined,
        },
        {
          expectedSessionId: sessionId,
        }
      ).catch(() => {});
      printHeader("Running reviewer...", "\x1b[36m");

      const reviewerPrompt = createReviewerPrompt({
        repoPath: projectPath,
        baseBranch: reviewOptions?.baseBranch,
        commitSha: reviewOptions?.commitSha,
        customInstructions: reviewOptions?.customInstructions,
      });

      // Run reviewer with retry
      const reviewResult = await runAgentWithRetry(
        "reviewer",
        config,
        reviewerPrompt,
        config.iterationTimeout,
        reviewOptions
      );

      if (onIteration) {
        onIteration(iteration, "reviewer", reviewResult);
      }

      if (!reviewResult.success) {
        return finish(
          await handleAgentFailure(
            "reviewer",
            reviewResult.exitCode,
            retryConfig,
            iteration,
            iterationStartTime,
            sessionPath
          )
        );
      }

      if (wasInterrupted()) {
        const entry = createIterationEntry(iteration, iterationStartTime, {
          error: { phase: "reviewer", message: "Review cycle interrupted before fixer" },
        });
        await appendLog(sessionPath, entry);
        return finish(
          determineCycleResult(true, iteration, config.maxIterations, true, sessionPath)
        );
      }

      await updateLockfile(
        undefined,
        projectPath,
        { currentAgent: "fixer" },
        {
          expectedSessionId: sessionId,
        }
      ).catch(() => {});
      printHeader("Running fixer to verify and apply fixes...", "\x1b[35m");

      let reviewSummary: ReviewSummary | null = null;
      let codexReviewSummary: CodexReviewSummary | null = null;

      const agentModule = AGENTS[config.reviewer.agent];
      const extractedText = agentModule.extractResult(reviewResult.output);
      const reviewTextForFixer = extractedText ?? reviewResult.output;

      let reviewJson: string | null = null;

      if (config.reviewer.agent === "codex") {
        codexReviewSummary = { text: reviewTextForFixer };
        await updateLockfile(
          undefined,
          projectPath,
          { codexReviewText: reviewTextForFixer },
          {
            expectedSessionId: sessionId,
          }
        ).catch(() => {});
      } else {
        reviewJson = extractedText ? (extractJsonBlock(extractedText) ?? extractedText) : null;

        if (reviewJson) {
          reviewSummary = parseReviewSummary(reviewJson);
        }

        if (reviewSummary) {
          await updateLockfile(
            undefined,
            projectPath,
            { reviewSummary },
            {
              expectedSessionId: sessionId,
            }
          ).catch(() => {});
        }

        if (!reviewSummary && reviewResult.success) {
          console.log("  ⚠️  Could not parse review summary JSON from reviewer output");
        }
      }

      const fixerPrompt = createFixerPrompt(reviewJson ?? reviewTextForFixer);
      const fixerAgentModule = AGENTS[config.fixer.agent];
      let checkpoint: GitCheckpoint | null = null;
      try {
        checkpoint = createCheckpoint(
          projectPath,
          `${sessionId ?? "session"}-iter-${iteration}-${Date.now()}`
        );
      } catch (error) {
        const entry = createIterationEntry(iteration, iterationStartTime, {
          error: {
            phase: "fixer",
            message: `Failed to create pre-fixer checkpoint: ${error}`,
          },
          review: reviewSummary ?? undefined,
          codexReview: codexReviewSummary ?? undefined,
        });
        await appendLog(sessionPath, entry);
        return finish({
          success: false,
          finalStatus: "failed",
          iterations: iteration,
          reason: `Failed to create pre-fixer checkpoint: ${error}`,
          sessionPath,
        });
      }

      const discardCheckpointSafe = () => {
        if (!checkpoint) {
          return;
        }
        try {
          discardCheckpoint(projectPath, checkpoint);
        } catch (error) {
          console.log(`  ⚠️  Failed to discard checkpoint: ${error}`);
        }
        checkpoint = null;
      };

      let fixResult = await runAgentWithRetry("fixer", config, fixerPrompt);
      let resultText = fixerAgentModule.extractResult(fixResult.output);
      let fixSummary = extractFixSummaryFromOutput(resultText, fixResult.output);

      if (fixResult.success && !fixSummary) {
        for (
          let attempt = 1;
          attempt <= FIXER_SUMMARY_RETRY_COUNT && fixResult.success && !fixSummary;
          attempt++
        ) {
          console.log(
            "  ⚠️  Fixer output missing parsable JSON summary. Retrying fixer with strict JSON reminder..."
          );
          const summaryRetryPrompt = `${fixerPrompt}

IMPORTANT: Your previous response was incomplete or missing the REQUIRED final JSON block.
Do not make additional file edits in this retry.
Return ONLY one valid \`\`\`json ... \`\`\` block matching the required schema as your final output.`;
          fixResult = await runAgentWithRetry("fixer", config, summaryRetryPrompt);
          resultText = fixerAgentModule.extractResult(fixResult.output);
          fixSummary = extractFixSummaryFromOutput(resultText, fixResult.output);
        }
      }

      if (!fixSummary && fixResult.success) {
        console.log("  ❌ Fixer returned incomplete output (missing fix summary JSON).");
        const rollback = checkpoint ? applyRollback(projectPath, checkpoint) : undefined;
        const entry = createIterationEntry(iteration, iterationStartTime, {
          error: { phase: "fixer", message: "Fixer output incomplete: missing fix summary JSON" },
          review: reviewSummary ?? undefined,
          codexReview: codexReviewSummary ?? undefined,
          rollback,
        });
        await appendLog(sessionPath, entry);
        return finish({
          success: false,
          finalStatus: "failed",
          iterations: iteration,
          reason: `Fixer output incomplete (missing fix summary JSON).${rollbackReasonSuffix(rollback)}`,
          sessionPath,
        });
      }

      if (onIteration) {
        onIteration(iteration, "fixer", fixResult);
      }

      if (!fixResult.success) {
        const rollback = checkpoint ? applyRollback(projectPath, checkpoint) : undefined;
        return finish(
          await handleAgentFailure(
            "fixer",
            fixResult.exitCode,
            retryConfig,
            iteration,
            iterationStartTime,
            sessionPath,
            {
              review: reviewSummary ?? undefined,
              codexReview: codexReviewSummary ?? undefined,
              rollback,
            }
          )
        );
      }

      const iterationEntry = createIterationEntry(iteration, iterationStartTime, {
        review: reviewSummary ?? undefined,
        codexReview: codexReviewSummary ?? undefined,
        fixes: fixSummary ?? undefined,
      });
      await appendLog(sessionPath, iterationEntry);

      if (fixSummary?.stop_iteration === true) {
        hasRemainingIssues = false;
        console.log("✅ No issues to fix - code is clean!");
        if (!reviewOptions?.forceMaxIterations) {
          discardCheckpointSafe();
          return finish(
            determineCycleResult(false, iteration, config.maxIterations, false, sessionPath)
          );
        }
        console.log("ℹ️  stop_iteration true; continuing due to --force");
      } else if (fixSummary?.stop_iteration === false) {
        hasRemainingIssues = true;
      } else if (!fixSummary) {
        // Could not parse fix summary - be conservative and assume issues may remain
        hasRemainingIssues = true;
      }

      // Detect NEED_INFO loop: fixer requested more info but made no fixes
      // This prevents token waste from repeating iterations with same result
      if (fixSummary?.decision === "NEED_INFO" && fixSummary.fixes.length === 0) {
        discardCheckpointSafe();
        console.log("⚠️  Fixer needs more information to proceed but made no changes.");
        console.log("   Review may contain unverifiable claims. Stopping to avoid token waste.");
        return finish({
          success: false,
          finalStatus: "failed",
          iterations: iteration,
          reason:
            "Fixer requested more information and made no changes - stopping without rollback",
          sessionPath,
        });
      }

      discardCheckpointSafe();

      printHeader("Fixes applied. Re-running reviewer...", "\x1b[36m");
    }

    if (reviewOptions?.forceMaxIterations && !hasRemainingIssues) {
      console.log(`ℹ️  Max iterations (${config.maxIterations}) reached after clean pass`);
    } else {
      console.log(`⚠️  Max iterations (${config.maxIterations}) reached`);
    }

    return finish(
      determineCycleResult(
        hasRemainingIssues,
        iteration,
        config.maxIterations,
        wasInterrupted(),
        sessionPath
      )
    );
  } catch (error) {
    unhandledError = error;
    throw error;
  } finally {
    const sessionEndEntry = createSessionEndEntry(
      finalResult,
      unhandledError,
      wasInterrupted(),
      iteration
    );
    await appendLog(sessionPath, sessionEndEntry).catch(() => {});
  }
}
