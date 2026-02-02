/**
 * Iteration engine for ralph-review
 * Orchestrates the review -> fix cycle
 */

import { createFixerPrompt, createReviewerPrompt, FIXER_NO_ISSUES_MARKER } from "@/lib/prompts";
import { AGENTS, runAgent } from "./agents";
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
  SystemEntry,
} from "./types";
import { DEFAULT_RETRY_CONFIG, isFixSummary, isReviewSummary } from "./types";

/**
 * Calculate retry delay with jitter exponential backoff
 * Formula: min(maxDelayMs, baseDelayMs * 2^attempt + random(0, baseDelayMs * 2^attempt / 2))
 */
export function calculateRetryDelay(attempt: number, config: RetryConfig): number {
  const exponentialDelay = config.baseDelayMs * 2 ** attempt;
  const jitter = Math.random() * (exponentialDelay / 2);
  const delay = exponentialDelay + jitter;
  return Math.min(delay, config.maxDelayMs);
}

/**
 * Format a highly visible warning for agent failure
 * Creates a box-style warning that stands out in terminal output
 */
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

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Factory for creating iteration log entries
 * Reduces repetition in the main cycle function
 */
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

/**
 * Handle agent failure with logging and formatted warning
 * Returns a CycleResult indicating failure
 */
async function handleAgentFailure(
  role: AgentRole,
  exitCode: number,
  retryConfig: RetryConfig,
  iteration: number,
  startTime: number,
  sessionPath: string
): Promise<CycleResult> {
  const warning = formatAgentFailureWarning(role, exitCode, retryConfig.maxRetries);
  console.log(warning);

  const entry = createIterationEntry(iteration, startTime, {
    error: {
      phase: role,
      message: `${role.charAt(0).toUpperCase() + role.slice(1)} failed after ${retryConfig.maxRetries} retries`,
      exitCode,
    },
  });
  await appendLog(sessionPath, entry);

  const brokenWarning = role === "fixer" ? " Code may be in a broken state!" : "";
  return {
    success: false,
    iterations: iteration,
    reason: `${role.charAt(0).toUpperCase() + role.slice(1)} failed with exit code ${exitCode} after ${retryConfig.maxRetries} retries.${brokenWarning}`,
    sessionPath,
  };
}

/**
 * Print a distinctly formatted header with a box
 */
function printHeader(text: string, colorCode: string = "\x1b[36m") {
  const border = "─".repeat(58);
  const reset = "\x1b[0m";
  const bold = "\x1b[1m";

  console.log("");
  console.log(`  ${bold}${colorCode}╭${border}╮${reset}`);
  console.log(`  ${bold}${colorCode}│${" ".repeat(58)}│${reset}`);
  console.log(`  ${bold}${colorCode}│  ${text.padEnd(56)}│${reset}`);
  console.log(`  ${bold}${colorCode}│${" ".repeat(58)}│${reset}`);
  console.log(`  ${bold}${colorCode}╰${border}╯${reset}`);
  console.log("");
}

/**
 * Run an agent with retry logic
 * Returns the result after retries are exhausted or success
 */
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

/**
 * Result of a complete review cycle
 */
export interface CycleResult {
  success: boolean;
  iterations: number;
  reason: string;
  sessionPath: string;
}

/**
 * Callback for iteration progress
 */
export type OnIterationCallback = (
  iteration: number,
  role: "reviewer" | "fixer",
  result: IterationResult
) => void;

/**
 * Check if the fixer's output indicates there were no issues to fix
 * This signals that the review cycle should stop
 */
export function fixerFoundNoIssues(fixerOutput: string): boolean {
  return fixerOutput.includes(FIXER_NO_ISSUES_MARKER);
}

/**
 * Extract JSON block from agent output
 * Looks for ```json\n...\n``` block and returns the JSON string
 */
export function extractJsonBlock(output: string): string | null {
  // Extract JSON from markdown code blocks (agents wrap JSON in ```json)
  const match = output.match(/```json\s*\n([\s\S]*?)\n```/);
  if (!match?.[1]) {
    return null;
  }
  return match[1].trim();
}

/**
 * Parse a JSON string into a FixSummary
 * Returns null if parsing fails or structure is invalid
 */
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

/**
 * Parse a JSON string into a ReviewSummary
 * Returns null if parsing fails or structure is invalid
 */
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

/**
 * Determine the final cycle result
 */
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
      iterations,
      reason: "Review cycle was interrupted",
      sessionPath,
    };
  }

  if (!hasIssues) {
    return {
      success: true,
      iterations,
      reason: "No issues found - code is clean",
      sessionPath,
    };
  }

  if (iterations >= maxIterations) {
    return {
      success: false,
      iterations,
      reason: `Max iterations (${maxIterations}) reached - some issues may remain`,
      sessionPath,
    };
  }

  return {
    success: false,
    iterations,
    reason: "Review cycle ended unexpectedly",
    sessionPath,
  };
}

let interrupted = false;

/**
 * Set up SIGINT handler for graceful shutdown
 */
function setupSignalHandler(): void {
  process.on("SIGINT", () => {
    console.log("\n⚠️  Interrupt received. Completing current iteration...");
    interrupted = true;
  });
}

/**
 * Check if the cycle was interrupted
 */
function wasInterrupted(): boolean {
  return interrupted;
}

/**
 * Reset the interrupt flag
 */
function resetInterrupt(): void {
  interrupted = false;
}

/**
 * Run the complete review cycle
 *
 * Loop: reviewer -> check for issues -> if issues, fixer -> repeat
 * Stop when: no issues found OR max iterations reached
 *
 * @param config - The configuration for the review cycle
 * @param onIteration - Optional callback for iteration progress
 * @param reviewOptions - Optional review configuration (base branch, custom prompt)
 */
export async function runReviewCycle(
  config: Config,
  onIteration?: OnIterationCallback,
  reviewOptions?: ReviewOptions
): Promise<CycleResult> {
  resetInterrupt();
  setupSignalHandler();

  const projectPath = process.cwd();
  const gitBranch = await getGitBranch(projectPath);
  const sessionPath = await createLogSession(undefined, projectPath, gitBranch);
  const systemEntry: SystemEntry = {
    type: "system",
    timestamp: Date.now(),
    projectPath,
    gitBranch,
    reviewer: config.reviewer,
    fixer: config.fixer,
    maxIterations: config.maxIterations,
  };
  await appendLog(sessionPath, systemEntry);

  let iteration = 0;
  let hasRemainingIssues = true; // Tracks whether issues remain (set to false when fixer finds no issues)

  while (iteration < config.maxIterations) {
    iteration++;
    const iterationStartTime = Date.now();

    // Early exit if user pressed Ctrl+C during previous iteration
    if (wasInterrupted()) {
      const entry = createIterationEntry(iteration, iterationStartTime, {
        error: { phase: "reviewer", message: "Review cycle interrupted before iteration start" },
      });
      await appendLog(sessionPath, entry);
      return determineCycleResult(
        hasRemainingIssues,
        iteration - 1,
        config.maxIterations,
        true,
        sessionPath
      );
    }

    console.log(`\n📋 Iteration ${iteration}/${config.maxIterations}`);
    printHeader("Running reviewer...", "\x1b[36m"); // Cyan

    const reviewerPrompt = createReviewerPrompt({
      repoPath: projectPath,
      baseBranch: reviewOptions?.baseBranch,
      commitSha: reviewOptions?.commitSha,
      customInstructions: reviewOptions?.customInstructions,
    });

    // Run reviewer with retry
    const retryConfig = config.retry ?? DEFAULT_RETRY_CONFIG;
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
      return handleAgentFailure(
        "reviewer",
        reviewResult.exitCode,
        retryConfig,
        iteration,
        iterationStartTime,
        sessionPath
      );
    }

    if (wasInterrupted()) {
      const entry = createIterationEntry(iteration, iterationStartTime, {
        error: { phase: "reviewer", message: "Review cycle interrupted before fixer" },
      });
      await appendLog(sessionPath, entry);
      return determineCycleResult(true, iteration, config.maxIterations, true, sessionPath);
    }

    // Always run fixer after reviewer to verify findings and apply fixes
    printHeader("Running fixer to verify and apply fixes...", "\x1b[35m"); // Magenta

    // Parse review summary and extract text for fixer
    let reviewSummary: ReviewSummary | null = null;
    let codexReviewSummary: CodexReviewSummary | null = null;

    const agentModule = AGENTS[config.reviewer.agent];
    // Polymorphic extraction
    const extractedText = agentModule.extractResult(reviewResult.output);
    const reviewTextForFixer = extractedText ?? reviewResult.output;

    let reviewJson: string | null = null;

    if (config.reviewer.agent === "codex") {
      codexReviewSummary = { text: reviewTextForFixer };
    } else {
      reviewJson = extractedText ? (extractJsonBlock(extractedText) ?? extractedText) : null;

      if (reviewJson) {
        reviewSummary = parseReviewSummary(reviewJson);
      }

      // Log if parsing failed, but continue gracefully
      if (!reviewSummary && reviewResult.success) {
        console.log("  ⚠️  Could not parse review summary JSON from reviewer output");
      }
    }

    const fixerPrompt = createFixerPrompt(reviewJson ?? reviewTextForFixer);
    const fixResult = await runAgentWithRetry("fixer", config, fixerPrompt);

    const fixerAgentModule = AGENTS[config.fixer.agent];
    const resultText = fixerAgentModule.extractResult(fixResult.output);
    const jsonString = resultText
      ? extractJsonBlock(resultText)
      : extractJsonBlock(fixResult.output);
    const fixSummary = jsonString ? parseFixSummary(jsonString) : null;

    // Log if JSON extraction failed, but continue gracefully
    if (!fixSummary && fixResult.success) {
      console.log("  ⚠️  Could not parse fix summary JSON from fixer output");
    }

    if (onIteration) {
      onIteration(iteration, "fixer", fixResult);
    }

    if (!fixResult.success) {
      return handleAgentFailure(
        "fixer",
        fixResult.exitCode,
        retryConfig,
        iteration,
        iterationStartTime,
        sessionPath
      );
    }

    const iterationEntry = createIterationEntry(iteration, iterationStartTime, {
      review: reviewSummary ?? undefined,
      codexReview: codexReviewSummary ?? undefined,
      fixes: fixSummary ?? undefined,
    });
    await appendLog(sessionPath, iterationEntry);

    if (fixerFoundNoIssues(fixResult.output)) {
      hasRemainingIssues = false;
      console.log("✅ No issues to fix - code is clean!");
      return determineCycleResult(false, iteration, config.maxIterations, false, sessionPath);
    }

    printHeader("Fixes applied. Re-running reviewer...", "\x1b[36m"); // Cyan
  }

  console.log(`⚠️  Max iterations (${config.maxIterations}) reached`);
  return determineCycleResult(
    hasRemainingIssues,
    iteration,
    config.maxIterations,
    wasInterrupted(),
    sessionPath
  );
}
