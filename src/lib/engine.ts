/**
 * Iteration engine for ralph-review
 * Orchestrates the review -> fix cycle
 */

import { runAgent } from "./agents";
import { appendLog, createLogSession } from "./logger";
import type { AgentRole, Config, IterationResult, LogEntry, RetryConfig } from "./types";
import { DEFAULT_RETRY_CONFIG } from "./types";

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
 * Stop marker for when fixer determines there's nothing to fix
 * The fixer outputs this when review findings are not valid or already addressed
 */
export const FIXER_NO_ISSUES_MARKER = "<review>No Issues Found</review>";

/**
 * Check if the fixer's output indicates there were no issues to fix
 * This signals that the review cycle should stop
 */
export function fixerFoundNoIssues(fixerOutput: string): boolean {
  return fixerOutput.includes(FIXER_NO_ISSUES_MARKER);
}

/**
 * Create the fixer prompt from review output
 * Uses exact prompt from check-review.md
 */
export function createFixerPrompt(reviewOutput: string): string {
  return `You are a **second-opinion verification reviewer + fixer**.

Goal:
1) Verify the review's claims against the actual code/diff.
2) If there is anything to APPLY, **immediately fix the fixes** (or output a unified diff) in the same response.
3) If there is nothing to APPLY, output the stop marker and end.

## Inputs
- Review to verify:
${reviewOutput}

## Rules
- Be skeptical: try to **falsify** each claim before accepting it.
- No guessing: if code/diff is missing or insufficient, mark items **NEED INFO** and state exactly what is missing.
- Prioritize: correctness/security/reliability/API breaks > performance > maintainability > style.
- Prefer minimal safe changes. Avoid refactors unless they clearly reduce risk or complexity.
- Terminal readability: no wide tables; short lines; consistent indentation.

## Task
A) Extract the review into numbered, atomic claims.
B) For each claim decide:
   - Verdict: CORRECT / INCORRECT / PARTIAL / UNVERIFIABLE
   - Severity: HIGH / MED / LOW / NIT
   - Action: APPLY / SKIP / NEED INFO
   - Evidence: concrete pointers (file:line / symbol / behavior).
C) Summarize decision:
   - NO CHANGES NEEDED / APPLY SELECTIVELY / APPLY MOST
D) **AUTO-APPLY BEHAVIOR (IMPORTANT)**
   - First, verify all claims and categorize them into APPLY/SKIP/NEEDINFO.
   - Then, based on the APPLY list determined during verification:
     - If APPLY is non-empty (valid issues exist):
       - Immediately produce a **Fix Package** and fix it:
         - If you have access to the codebase/workspace: **edit files now**.
         - Otherwise: output a **unified diff** patch that can be applied.
       - Do NOT ask the user "should I fix it?" - proceed.
       - Do NOT output the stop marker - let the review cycle continue.
     - If APPLY is empty (all claims are invalid, unverifiable, or already addressed):
       - Do NOT propose patches.
       - Output the stop marker exactly as shown: ${FIXER_NO_ISSUES_MARKER}
       - This signals that verification found nothing valid to fix.

## CRITICAL: Stop Marker Decision Timing
The stop marker decision is made DURING VERIFICATION, BEFORE any fixes are applied.
- If you determine ANY valid issues exist → apply them, NO marker (cycle continues)
- If you determine NO valid issues exist → output marker immediately (cycle stops)
- NEVER output the marker after applying fixes. Applying fixes = no marker.

## Output format (terminal friendly; follow exactly)

DECISION: <NO CHANGES NEEDED | APPLY SELECTIVELY | APPLY MOST>
APPLY:    <# list like #1 #4, or "none">
SKIP:     <# list or "none">
NEEDINFO: <# list or "none">  (brief missing info per item)

APPLY NOW (only if APPLY is non-empty)
  [#N][SEV] <one-line title>
    Claim: <what the review suggested>
    Evidence: <file:line-range and/or concrete behavior>
    Fix: <minimal change; include snippet if small>
    Tests: <specific tests to add/update>
    Risks: <what could break + how to verify>

SKIP (only if SKIP is non-empty)
  [#N][SEV] <one-line title>
    Claim: ...
    Reason: ...

NEED MORE INFO (only if NEEDINFO is non-empty)
  [#N] <one-line title>
    Claim: ...
    Missing: <exact files/diff/log/tests needed>

FIX PACKAGE (AUTO-RUN; only if APPLY is non-empty)
  Patch:
    - <step-by-step patch plan>
    - If possible, include a unified diff.

## CRITICAL: Stop Marker
Output the marker ONLY when verification determines APPLY is empty (no valid issues to fix).
NEVER output the marker if you applied any fixes - let the cycle continue for re-review.
${FIXER_NO_ISSUES_MARKER}`;
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

  // Create log session with timestamp-based name
  const sessionName = new Date().toISOString().replace(/[:.]/g, "-");
  const sessionPath = await createLogSession(undefined, sessionName);

  // Log cycle start
  const startEntry: LogEntry = {
    timestamp: Date.now(),
    type: "system",
    content: `Review cycle started. Max iterations: ${config.maxIterations}`,
    iteration: 0,
  };
  await appendLog(sessionPath, startEntry);

  let iteration = 0;
  let lastReviewResult: IterationResult | null = null;

  while (iteration < config.maxIterations) {
    iteration++;

    // Check for interrupt before starting
    if (wasInterrupted()) {
      await appendLog(sessionPath, {
        timestamp: Date.now(),
        type: "system",
        content: "Review cycle interrupted before iteration start",
        iteration,
      });
      return determineCycleResult(
        lastReviewResult?.hasIssues ?? true,
        iteration - 1,
        config.maxIterations,
        true,
        sessionPath
      );
    }

    console.log(`\n📋 Iteration ${iteration}/${config.maxIterations}`);
    console.log("Running reviewer...");

    // Run reviewer with retry
    const retryConfig = config.retry ?? DEFAULT_RETRY_CONFIG;
    const reviewResult = await runAgentWithRetry("reviewer", config);
    lastReviewResult = reviewResult;

    // Log reviewer output
    await appendLog(sessionPath, {
      timestamp: Date.now(),
      type: "review",
      content: reviewResult.output,
      iteration,
    });

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
      await appendLog(sessionPath, {
        timestamp: Date.now(),
        type: "error",
        content: `REVIEWER FAILED after ${retryConfig.maxRetries} retries. Exit code: ${reviewResult.exitCode}\n\n${warning}`,
        iteration,
      });
      return {
        success: false,
        iterations: iteration,
        reason: `Reviewer failed with exit code ${reviewResult.exitCode} after ${retryConfig.maxRetries} retries`,
        sessionPath,
      };
    }

    // Check for interrupt before fixer
    if (wasInterrupted()) {
      await appendLog(sessionPath, {
        timestamp: Date.now(),
        type: "system",
        content: "Review cycle interrupted before fixer",
        iteration,
      });
      return determineCycleResult(true, iteration, config.maxIterations, true, sessionPath);
    }

    // Always run fixer after reviewer to verify findings and apply fixes
    console.log("Running fixer to verify and apply fixes...");

    // Create fixer prompt from review output
    const fixerPrompt = createFixerPrompt(reviewResult.output);

    // Run fixer with retry
    const fixResult = await runAgentWithRetry("fixer", config, fixerPrompt);

    // Log fixer output
    await appendLog(sessionPath, {
      timestamp: Date.now(),
      type: "fix",
      content: fixResult.output,
      iteration,
    });

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
      await appendLog(sessionPath, {
        timestamp: Date.now(),
        type: "error",
        content: `FIXER FAILED after ${retryConfig.maxRetries} retries. Exit code: ${fixResult.exitCode}\n\n${warning}`,
        iteration,
      });
      return {
        success: false,
        iterations: iteration,
        reason: `Fixer failed with exit code ${fixResult.exitCode} after ${retryConfig.maxRetries} retries. Code may be in a broken state!`,
        sessionPath,
      };
    }

    // Check if fixer found no issues to fix (stop condition)
    if (fixerFoundNoIssues(fixResult.output)) {
      console.log("✅ No issues to fix - code is clean!");
      await appendLog(sessionPath, {
        timestamp: Date.now(),
        type: "system",
        content: "Fixer determined no issues to fix - cycle complete",
        iteration,
      });
      return determineCycleResult(false, iteration, config.maxIterations, false, sessionPath);
    }

    console.log("Fixes applied. Re-running reviewer...");
  }

  // Max iterations reached after completing the last full iteration
  console.log(`⚠️  Max iterations (${config.maxIterations}) reached`);
  await appendLog(sessionPath, {
    timestamp: Date.now(),
    type: "system",
    content: `Max iterations (${config.maxIterations}) reached`,
    iteration,
  });
  return determineCycleResult(
    lastReviewResult?.hasIssues ?? true,
    iteration,
    config.maxIterations,
    wasInterrupted(),
    sessionPath
  );
}
