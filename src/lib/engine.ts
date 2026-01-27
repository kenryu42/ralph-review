/**
 * Iteration engine for ralph-review
 * Orchestrates the review -> fix cycle
 */

import { createFixerPrompt, FIXER_NO_ISSUES_MARKER } from "@/lib/prompts";
import { extractClaudeResult, formatClaudeReviewForFixer, runAgent } from "./agents";
import { appendLog, createLogSession, getGitBranch } from "./logger";
import type {
  AgentRole,
  Config,
  FixSummary,
  IterationEntry,
  IterationResult,
  RetryConfig,
  SystemEntry,
} from "./types";
import { DEFAULT_RETRY_CONFIG, isFixSummary } from "./types";

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
║  Retries exhausted: ${retriesExhausted}/${retriesExhausted}
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
  timeout: number = config.iterationTimeout
): Promise<IterationResult> {
  const retryConfig = config.retry ?? DEFAULT_RETRY_CONFIG;

  // First attempt (always runs)
  let result = await runAgent(role, config, prompt, timeout);

  if (result.success) {
    return result;
  }

  console.log(`  ❌ ${role} failed (exit code ${result.exitCode})`);

  // Retry loop
  for (let attempt = 1; attempt <= retryConfig.maxRetries; attempt++) {
    const delay = calculateRetryDelay(attempt - 1, retryConfig);
    console.log(
      `  ⏳ Retry ${attempt}/${retryConfig.maxRetries} in ${Math.round(delay / 1000)}s...`
    );
    await sleep(delay);

    result = await runAgent(role, config, prompt, timeout);

    if (result.success) {
      return result;
    }

    console.log(`  ❌ ${role} failed (exit code ${result.exitCode})`);
  }

  // All retries exhausted, return the last result
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
 * Extract JSON block from fixer output
 * Looks for ```json\n...\n``` block and returns the JSON string
 */
export function extractFixSummaryJson(output: string): string | null {
  // Match ```json followed by content until closing ```
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

// Flag to track SIGINT
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
 */
export async function runReviewCycle(
  config: Config,
  onIteration?: OnIterationCallback
): Promise<CycleResult> {
  resetInterrupt();
  setupSignalHandler();

  // Get project info for log session
  const projectPath = process.cwd();
  const gitBranch = await getGitBranch(projectPath);

  // Create log session with project-based naming
  const sessionPath = await createLogSession(undefined, projectPath, gitBranch);

  // Log cycle start with system entry
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
  let lastReviewResult: IterationResult | null = null;

  while (iteration < config.maxIterations) {
    iteration++;
    const iterationStartTime = Date.now();

    // Check for interrupt before starting
    if (wasInterrupted()) {
      const entry: IterationEntry = {
        type: "iteration",
        timestamp: Date.now(),
        iteration,
        duration: Date.now() - iterationStartTime,
        error: {
          phase: "reviewer",
          message: "Review cycle interrupted before iteration start",
        },
      };
      await appendLog(sessionPath, entry);
      return determineCycleResult(
        lastReviewResult?.hasIssues ?? true,
        iteration - 1,
        config.maxIterations,
        true,
        sessionPath
      );
    }

    console.log(`\n📋 Iteration ${iteration}/${config.maxIterations}`);
    printHeader("Running reviewer...", "\x1b[36m"); // Cyan

    // Run reviewer with retry
    const retryConfig = config.retry ?? DEFAULT_RETRY_CONFIG;
    const reviewResult = await runAgentWithRetry("reviewer", config);
    lastReviewResult = reviewResult;

    if (onIteration) {
      onIteration(iteration, "reviewer", reviewResult);
    }

    // Handle reviewer failure (fatal after retries exhausted)
    if (!reviewResult.success) {
      const warning = formatAgentFailureWarning(
        "reviewer",
        reviewResult.exitCode,
        retryConfig.maxRetries
      );
      console.log(warning);
      const entry: IterationEntry = {
        type: "iteration",
        timestamp: Date.now(),
        iteration,
        duration: Date.now() - iterationStartTime,
        error: {
          phase: "reviewer",
          message: `Reviewer failed after ${retryConfig.maxRetries} retries`,
          exitCode: reviewResult.exitCode,
        },
      };
      await appendLog(sessionPath, entry);
      return {
        success: false,
        iterations: iteration,
        reason: `Reviewer failed with exit code ${reviewResult.exitCode} after ${retryConfig.maxRetries} retries`,
        sessionPath,
      };
    }

    // Check for interrupt before fixer
    if (wasInterrupted()) {
      const entry: IterationEntry = {
        type: "iteration",
        timestamp: Date.now(),
        iteration,
        duration: Date.now() - iterationStartTime,
        error: {
          phase: "reviewer",
          message: "Review cycle interrupted before fixer",
        },
      };
      await appendLog(sessionPath, entry);
      return determineCycleResult(true, iteration, config.maxIterations, true, sessionPath);
    }

    // Always run fixer after reviewer to verify findings and apply fixes
    printHeader("Running fixer to verify and apply fixes...", "\x1b[35m"); // Magenta

    // Create fixer prompt from review output
    // For Claude reviewer, format the JSONL output into readable text
    let reviewText = reviewResult.output;
    if (config.reviewer.agent === "claude") {
      const formatted = formatClaudeReviewForFixer(reviewResult.output);
      if (formatted) {
        reviewText = formatted;
      }
    }
    const fixerPrompt = createFixerPrompt(reviewText);

    // Run fixer with retry
    const fixResult = await runAgentWithRetry("fixer", config, fixerPrompt);

    // Try to extract and parse fix summary from fixer output
    // For Claude, first extract the result text from JSONL, then look for JSON block
    let jsonString: string | null;
    if (config.fixer.agent === "claude") {
      const resultText = extractClaudeResult(fixResult.output);
      jsonString = resultText ? extractFixSummaryJson(resultText) : null;
    } else {
      jsonString = extractFixSummaryJson(fixResult.output);
    }
    const fixSummary = jsonString ? parseFixSummary(jsonString) : null;

    // Log if JSON extraction failed (but continue gracefully)
    if (!fixSummary && fixResult.success) {
      console.log("  ⚠️  Could not parse fix summary JSON from fixer output");
    }

    if (onIteration) {
      onIteration(iteration, "fixer", fixResult);
    }

    // Handle fixer failure (fatal after retries exhausted)
    if (!fixResult.success) {
      const warning = formatAgentFailureWarning(
        "fixer",
        fixResult.exitCode,
        retryConfig.maxRetries
      );
      console.log(warning);
      const entry: IterationEntry = {
        type: "iteration",
        timestamp: Date.now(),
        iteration,
        duration: Date.now() - iterationStartTime,
        error: {
          phase: "fixer",
          message: `Fixer failed after ${retryConfig.maxRetries} retries`,
          exitCode: fixResult.exitCode,
        },
      };
      await appendLog(sessionPath, entry);
      return {
        success: false,
        iterations: iteration,
        reason: `Fixer failed with exit code ${fixResult.exitCode} after ${retryConfig.maxRetries} retries. Code may be in a broken state!`,
        sessionPath,
      };
    }

    // Log iteration result with fix summary (only on success)
    const iterationEntry: IterationEntry = {
      type: "iteration",
      timestamp: Date.now(),
      iteration,
      duration: Date.now() - iterationStartTime,
      fixes: fixSummary ?? undefined,
    };
    await appendLog(sessionPath, iterationEntry);

    // Check if fixer found no issues to fix (stop condition)
    if (fixerFoundNoIssues(fixResult.output)) {
      console.log("✅ No issues to fix - code is clean!");
      return determineCycleResult(false, iteration, config.maxIterations, false, sessionPath);
    }

    printHeader("Fixes applied. Re-running reviewer...", "\x1b[36m"); // Cyan
  }

  // Max iterations reached after completing the last full iteration
  console.log(`⚠️  Max iterations (${config.maxIterations}) reached`);
  return determineCycleResult(
    lastReviewResult?.hasIssues ?? true,
    iteration,
    config.maxIterations,
    wasInterrupted(),
    sessionPath
  );
}
