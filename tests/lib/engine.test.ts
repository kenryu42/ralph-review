import { describe, expect, test } from "bun:test";
import {
  calculateRetryDelay,
  determineCycleResult,
  extractFixSummaryFromOutput,
  formatAgentFailureWarning,
} from "@/lib/engine";
import { createFixerPrompt, FIX_SUMMARY_END_TOKEN, FIX_SUMMARY_START_TOKEN } from "@/lib/prompts";
import { CONFIG_SCHEMA_URI, CONFIG_VERSION, type Config, type RetryConfig } from "@/lib/types";

// Mock config for testing
const _mockConfig: Config = {
  $schema: CONFIG_SCHEMA_URI,
  version: CONFIG_VERSION,
  reviewer: { agent: "codex" },
  fixer: { agent: "claude" },
  maxIterations: 3,
  iterationTimeout: 60000,
  defaultReview: { type: "uncommitted" },
  notifications: { sound: { enabled: false } },
};

describe("engine", () => {
  describe("createFixerPrompt", () => {
    test("includes review output in prompt", () => {
      const reviewOutput = "Found bug in line 42";
      const prompt = createFixerPrompt(reviewOutput);
      expect(prompt).toContain(reviewOutput);
      expect(prompt.length).toBeGreaterThan(reviewOutput.length);
    });
  });

  describe("CycleResult", () => {
    const testSessionPath = "/tmp/test-session";

    test("returns success when no issues", () => {
      const result = determineCycleResult(false, 3, 10, false, testSessionPath);
      expect(result.success).toBe(true);
      expect(result.finalStatus).toBe("completed");
      expect(result.reason).toContain("No issues");
      expect(result.sessionPath).toBe(testSessionPath);
    });

    test("returns completed terminal status when max iterations", () => {
      const result = determineCycleResult(true, 10, 10, false, testSessionPath);
      expect(result.success).toBe(false);
      expect(result.finalStatus).toBe("completed");
      expect(result.reason).toContain("Max iterations");
      expect(result.sessionPath).toBe(testSessionPath);
    });

    test("returns failure when interrupted", () => {
      const result = determineCycleResult(true, 5, 10, true, testSessionPath);
      expect(result.success).toBe(false);
      expect(result.finalStatus).toBe("interrupted");
      expect(result.reason).toContain("interrupted");
      expect(result.sessionPath).toBe(testSessionPath);
    });

    test("returns unexpected failure when issues remain before max iterations", () => {
      const result = determineCycleResult(true, 2, 10, false, testSessionPath);
      expect(result.success).toBe(false);
      expect(result.finalStatus).toBe("failed");
      expect(result.reason).toContain("ended unexpectedly");
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

  describe("extractFixSummaryFromOutput", () => {
    test("parses framed fix summary output", () => {
      const framedSummary = {
        decision: "NO_CHANGES_NEEDED",
        fixes: [],
        skipped: [],
      };
      const raw = `${FIX_SUMMARY_START_TOKEN}
${JSON.stringify(framedSummary)}
${FIX_SUMMARY_END_TOKEN}`;

      const result = extractFixSummaryFromOutput(raw, raw);
      expect(result).not.toBeNull();
      expect(result?.decision).toBe("NO_CHANGES_NEEDED");
    });

    test("repairs framed trailing commas in fix summary", () => {
      const raw = `${FIX_SUMMARY_START_TOKEN}
{"decision":"APPLY_SELECTIVELY","fixes":[],"skipped":[],}
${FIX_SUMMARY_END_TOKEN}`;

      const result = extractFixSummaryFromOutput(raw, raw);
      expect(result).not.toBeNull();
      expect(result?.decision).toBe("APPLY_SELECTIVELY");
    });
  });
});
