import { describe, expect, test } from "bun:test";
import {
  calculateRetryDelay,
  createFixerPrompt,
  determineCycleResult,
  FIXER_NO_ISSUES_MARKER,
  fixerFoundNoIssues,
  formatAgentFailureWarning,
} from "@/lib/engine";
import type { Config, RetryConfig } from "@/lib/types";

// Mock config for testing
const _mockConfig: Config = {
  reviewer: { agent: "codex" },
  fixer: { agent: "claude" },
  maxIterations: 3,
  iterationTimeout: 60000,
};

describe("engine", () => {
  describe("createFixerPrompt", () => {
    test("includes review output in prompt", () => {
      const reviewOutput = "Found bug in line 42";
      const prompt = createFixerPrompt(reviewOutput);
      expect(prompt).toContain(reviewOutput);
      expect(prompt.length).toBeGreaterThan(reviewOutput.length);
    });

    test("includes the no-issues marker instruction", () => {
      const prompt = createFixerPrompt("Some review");
      expect(prompt).toContain(FIXER_NO_ISSUES_MARKER);
    });
  });

  describe("fixerFoundNoIssues", () => {
    test("returns true when output contains the no-issues marker", () => {
      const output = `DECISION: NO CHANGES NEEDED
APPLY: none
SKIP: #1 #2

${FIXER_NO_ISSUES_MARKER}`;
      expect(fixerFoundNoIssues(output)).toBe(true);
    });

    test("returns false when output does not contain the marker", () => {
      const output = `DECISION: APPLY SELECTIVELY
APPLY: #1 #3
SKIP: #2

FIX PACKAGE
- Fixed issue #1 in auth.ts`;
      expect(fixerFoundNoIssues(output)).toBe(false);
    });

    test("returns true when marker is embedded in other text", () => {
      const output = `After reviewing all claims, I found nothing actionable.
${FIXER_NO_ISSUES_MARKER}
End of review.`;
      expect(fixerFoundNoIssues(output)).toBe(true);
    });

    test("returns false for empty output", () => {
      expect(fixerFoundNoIssues("")).toBe(false);
    });

    test("returns false for partial marker", () => {
      expect(fixerFoundNoIssues("<review>No Issues")).toBe(false);
      expect(fixerFoundNoIssues("No Issues Found</review>")).toBe(false);
    });
  });

  describe("CycleResult", () => {
    const testSessionPath = "/tmp/test-session";

    test("returns success when no issues", () => {
      const result = determineCycleResult(false, 3, 10, false, testSessionPath);
      expect(result.success).toBe(true);
      expect(result.reason).toContain("No issues");
      expect(result.sessionPath).toBe(testSessionPath);
    });

    test("returns failure when max iterations", () => {
      const result = determineCycleResult(true, 10, 10, false, testSessionPath);
      expect(result.success).toBe(false);
      expect(result.reason).toContain("Max iterations");
      expect(result.sessionPath).toBe(testSessionPath);
    });

    test("returns failure when interrupted", () => {
      const result = determineCycleResult(true, 5, 10, true, testSessionPath);
      expect(result.success).toBe(false);
      expect(result.reason).toContain("interrupted");
      expect(result.sessionPath).toBe(testSessionPath);
    });
  });

  describe("calculateRetryDelay", () => {
    const retryConfig: RetryConfig = {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
    };

    test("returns exponential backoff delay for first attempt", () => {
      const delay = calculateRetryDelay(0, retryConfig);
      // First attempt: baseDelay * 2^0 = 1000ms + jitter (0-500)
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(1500);
    });

    test("returns exponential backoff delay for second attempt", () => {
      const delay = calculateRetryDelay(1, retryConfig);
      // Second attempt: baseDelay * 2^1 = 2000ms + jitter (0-1000)
      expect(delay).toBeGreaterThanOrEqual(2000);
      expect(delay).toBeLessThanOrEqual(3000);
    });

    test("returns exponential backoff delay for third attempt", () => {
      const delay = calculateRetryDelay(2, retryConfig);
      // Third attempt: baseDelay * 2^2 = 4000ms + jitter (0-2000)
      expect(delay).toBeGreaterThanOrEqual(4000);
      expect(delay).toBeLessThanOrEqual(6000);
    });

    test("caps delay at maxDelayMs", () => {
      const shortMaxConfig: RetryConfig = {
        maxRetries: 3,
        baseDelayMs: 1000,
        maxDelayMs: 2000,
      };
      const delay = calculateRetryDelay(5, shortMaxConfig);
      // Would be 32000ms but capped at 2000
      expect(delay).toBeLessThanOrEqual(2000);
    });
  });

  describe("formatAgentFailureWarning", () => {
    test("formats reviewer failure warning", () => {
      const warning = formatAgentFailureWarning("reviewer", 1, 3);
      expect(warning).toContain("REVIEWER");
      expect(warning).toContain("FAILED");
      expect(warning).toContain("1");
      expect(warning).toContain("3");
    });

    test("formats fixer failure warning", () => {
      const warning = formatAgentFailureWarning("fixer", 2, 3);
      expect(warning).toContain("FIXER");
      expect(warning).toContain("FAILED");
      expect(warning).toContain("2");
      expect(warning).toContain("3");
    });

    test("includes code check reminder in warning", () => {
      const warning = formatAgentFailureWarning("fixer", 1, 3);
      expect(warning.toLowerCase()).toMatch(/check|verify|code|broken/i);
    });
  });
});
