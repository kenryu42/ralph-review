/**
 * Iteration engine for ralph-review
 * Orchestrates the review -> implement cycle
 */

import type { Config, IterationResult } from "./types";
import { runAgent } from "./agents";

/**
 * Result of a complete review cycle
 */
export interface CycleResult {
  success: boolean;
  iterations: number;
  reason: string;
}

/**
 * Callback for iteration progress
 */
export type OnIterationCallback = (
  iteration: number,
  role: "reviewer" | "implementor",
  result: IterationResult
) => void;

/**
 * Create the implementor prompt from review output
 * Based on check-review.md pattern
 */
export function createImplementorPrompt(reviewOutput: string): string {
  return `You are a code review verification and implementation agent.

A reviewer has analyzed the codebase and provided the following findings:

---
${reviewOutput}
---

Your task:
1. Analyze each finding from the review
2. Determine which findings are valid and actionable
3. Implement fixes for valid findings
4. Skip findings that are false positives or not actionable

Focus on:
- Bug fixes
- Security issues  
- Code quality improvements

Do NOT:
- Make unnecessary changes
- Add new features not related to the findings
- Break existing functionality

After implementing fixes, run any relevant tests to verify your changes.`;
}

/**
 * Determine if the loop should continue
 */
export function shouldContinueLoop(
  reviewResult: IterationResult,
  currentIteration: number,
  maxIterations: number
): boolean {
  // Stop if reviewer failed
  if (!reviewResult.success) {
    return false;
  }
  
  // Stop if no issues found
  if (!reviewResult.hasIssues) {
    return false;
  }
  
  // Stop if max iterations reached
  if (currentIteration >= maxIterations) {
    return false;
  }
  
  return true;
}

/**
 * Determine the final cycle result
 */
export function determineCycleResult(
  hasIssues: boolean,
  iterations: number,
  maxIterations: number,
  wasInterrupted: boolean
): CycleResult {
  if (wasInterrupted) {
    return {
      success: false,
      iterations,
      reason: "Review cycle was interrupted",
    };
  }
  
  if (!hasIssues) {
    return {
      success: true,
      iterations,
      reason: "No issues found - code is clean",
    };
  }
  
  if (iterations >= maxIterations) {
    return {
      success: false,
      iterations,
      reason: `Max iterations (${maxIterations}) reached - some issues may remain`,
    };
  }
  
  return {
    success: false,
    iterations,
    reason: "Review cycle ended unexpectedly",
  };
}

// Flag to track SIGINT
let interrupted = false;

/**
 * Set up SIGINT handler for graceful shutdown
 */
export function setupSignalHandler(): void {
  process.on("SIGINT", () => {
    console.log("\n⚠️  Interrupt received. Completing current iteration...");
    interrupted = true;
  });
}

/**
 * Check if the cycle was interrupted
 */
export function wasInterrupted(): boolean {
  return interrupted;
}

/**
 * Reset the interrupt flag
 */
export function resetInterrupt(): void {
  interrupted = false;
}

/**
 * Run the complete review cycle
 * 
 * Loop: reviewer -> check for issues -> if issues, implementor -> repeat
 * Stop when: no issues found OR max iterations reached
 */
export async function runReviewCycle(
  config: Config,
  onIteration?: OnIterationCallback
): Promise<CycleResult> {
  resetInterrupt();
  setupSignalHandler();
  
  let iteration = 0;
  let lastReviewResult: IterationResult | null = null;
  
  while (iteration < config.maxIterations) {
    iteration++;
    
    // Check for interrupt before starting
    if (wasInterrupted()) {
      return determineCycleResult(
        lastReviewResult?.hasIssues ?? true,
        iteration - 1,
        config.maxIterations,
        true
      );
    }
    
    console.log(`\n📋 Iteration ${iteration}/${config.maxIterations}`);
    console.log("Running reviewer...");
    
    // Run reviewer
    const reviewResult = await runAgent("reviewer", config);
    lastReviewResult = reviewResult;
    
    if (onIteration) {
      onIteration(iteration, "reviewer", reviewResult);
    }
    
    // Check if we should continue
    if (!shouldContinueLoop(reviewResult, iteration, config.maxIterations)) {
      if (!reviewResult.success) {
        console.log("❌ Reviewer failed");
        return {
          success: false,
          iterations: iteration,
          reason: `Reviewer failed with exit code ${reviewResult.exitCode}`,
        };
      }
      
      if (!reviewResult.hasIssues) {
        console.log("✅ No issues found!");
        return determineCycleResult(false, iteration, config.maxIterations, false);
      }
      
      // Max iterations reached
      console.log(`⚠️  Max iterations reached`);
      return determineCycleResult(true, iteration, config.maxIterations, false);
    }
    
    // Check for interrupt before implementor
    if (wasInterrupted()) {
      return determineCycleResult(true, iteration, config.maxIterations, true);
    }
    
    console.log("Issues found. Running implementor...");
    
    // Create implementor prompt from review output
    const implementorPrompt = createImplementorPrompt(reviewResult.output);
    
    // Run implementor
    const implementResult = await runAgent("implementor", config, implementorPrompt);
    
    if (onIteration) {
      onIteration(iteration, "implementor", implementResult);
    }
    
    if (!implementResult.success) {
      console.log("⚠️  Implementor returned non-zero exit code, continuing...");
    }
    
    console.log("Implementation complete. Re-running reviewer...");
  }
  
  return determineCycleResult(
    lastReviewResult?.hasIssues ?? true,
    iteration,
    config.maxIterations,
    wasInterrupted()
  );
}
