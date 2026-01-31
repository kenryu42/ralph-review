import { describe, expect, test } from "bun:test";
import {
  calculateRetryDelay,
  determineCycleResult,
  extractJsonBlock,
  fixerFoundNoIssues,
  formatAgentFailureWarning,
  parseFixSummary,
  parseReviewSummary,
} from "@/lib/engine";
import { createFixerPrompt, FIXER_NO_ISSUES_MARKER } from "@/lib/prompts";
import type { Config, RetryConfig } from "@/lib/types";

// Mock config for testing
const _mockConfig: Config = {
  reviewer: { agent: "codex" },
  fixer: { agent: "claude" },
  maxIterations: 3,
  iterationTimeout: 60000,
  defaultReview: { type: "uncommitted" },
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

  describe("extractJsonBlock", () => {
    test("extracts JSON block from agent output", () => {
      const output = `DECISION: APPLY_SELECTIVELY
APPLY: #1

Some analysis here.

\`\`\`json
{"decision": "APPLY_SELECTIVELY", "fixes": [], "skipped": []}
\`\`\`

End of output.`;
      const result = extractJsonBlock(output);
      expect(result).toBe('{"decision": "APPLY_SELECTIVELY", "fixes": [], "skipped": []}');
    });

    test("returns null when no JSON block present", () => {
      const output = "DECISION: NO CHANGES NEEDED\nNo JSON here.";
      const result = extractJsonBlock(output);
      expect(result).toBeNull();
    });

    test("handles malformed delimiters gracefully", () => {
      const output = "```json\n{incomplete";
      const result = extractJsonBlock(output);
      expect(result).toBeNull();
    });

    test("extracts first JSON block when multiple present", () => {
      const output = `\`\`\`json
{"first": true}
\`\`\`

\`\`\`json
{"second": true}
\`\`\``;
      const result = extractJsonBlock(output);
      expect(result).toBe('{"first": true}');
    });

    test("handles JSON with newlines inside", () => {
      const output = `\`\`\`json
{
  "decision": "NO_CHANGES_NEEDED",
  "fixes": [],
  "skipped": []
}
\`\`\``;
      const result = extractJsonBlock(output);
      expect(result).toContain('"decision": "NO_CHANGES_NEEDED"');
      expect(result).not.toBeNull();
    });
  });

  describe("parseFixSummary", () => {
    test("parses valid JSON into FixSummary", () => {
      const json = JSON.stringify({
        decision: "APPLY_SELECTIVELY",
        fixes: [
          {
            id: 1,
            title: "Fix null check",
            priority: "P0",
            file: "auth.ts",
            claim: "Missing null check",
            evidence: "auth.ts:42",
            fix: "Added null check",
          },
        ],
        skipped: [
          {
            id: 2,
            title: "Minor style issue",
            reason: "Not worth changing",
          },
        ],
      });
      const result = parseFixSummary(json);
      expect(result).not.toBeNull();
      expect(result?.decision).toBe("APPLY_SELECTIVELY");
      expect(result?.fixes).toHaveLength(1);
      expect(result?.fixes[0]?.priority).toBe("P0");
      expect(result?.skipped).toHaveLength(1);
    });

    test("returns null for invalid JSON", () => {
      const result = parseFixSummary("{invalid json");
      expect(result).toBeNull();
    });

    test("returns null for wrong structure", () => {
      const json = JSON.stringify({ wrong: "structure" });
      const result = parseFixSummary(json);
      expect(result).toBeNull();
    });

    test("returns null when fixes is not an array", () => {
      const json = JSON.stringify({
        decision: "NO_CHANGES_NEEDED",
        fixes: "not an array",
        skipped: [],
      });
      const result = parseFixSummary(json);
      expect(result).toBeNull();
    });

    test("returns null for invalid decision value", () => {
      const json = JSON.stringify({
        decision: "INVALID_DECISION",
        fixes: [],
        skipped: [],
      });
      const result = parseFixSummary(json);
      expect(result).toBeNull();
    });

    test("returns null for invalid severity in fix entry", () => {
      const json = JSON.stringify({
        decision: "APPLY_SELECTIVELY",
        fixes: [
          {
            id: 1,
            title: "Fix",
            severity: "CRITICAL", // Invalid severity
            claim: "claim",
            evidence: "evidence",
            fix: "fix",
          },
        ],
        skipped: [],
      });
      const result = parseFixSummary(json);
      expect(result).toBeNull();
    });

    test("accepts fix entry with omitted file field (undefined)", () => {
      const json = JSON.stringify({
        decision: "APPLY_SELECTIVELY",
        fixes: [
          {
            id: 1,
            title: "Fix",
            priority: "P2",
            claim: "claim",
            evidence: "evidence",
            fix: "fix",
          },
        ],
        skipped: [],
      });
      const result = parseFixSummary(json);
      expect(result).not.toBeNull();
      expect(result?.fixes[0]?.file).toBeUndefined();
    });

    test("accepts fix entry with explicit file: null", () => {
      const json = JSON.stringify({
        decision: "APPLY_SELECTIVELY",
        fixes: [
          {
            id: 1,
            title: "Fix",
            priority: "P2",
            file: null,
            claim: "claim",
            evidence: "evidence",
            fix: "fix",
          },
        ],
        skipped: [],
      });
      const result = parseFixSummary(json);
      expect(result).not.toBeNull();
      expect(result?.fixes[0]?.file).toBeNull();
    });
  });

  describe("parseReviewSummary", () => {
    test("parses valid JSON into ReviewSummary", () => {
      const json = JSON.stringify({
        findings: [
          {
            title: "Missing null check",
            body: "The function does not check for null input",
            confidence_score: 0.85,
            priority: 1,
            code_location: {
              absolute_file_path: "/src/auth.ts",
              line_range: { start: 42, end: 45 },
            },
          },
        ],
        overall_correctness: "patch is correct",
        overall_explanation: "The patch correctly addresses the issue",
        overall_confidence_score: 0.9,
      });
      const result = parseReviewSummary(json);
      expect(result).not.toBeNull();
      expect(result?.findings).toHaveLength(1);
      expect(result?.findings[0]?.title).toBe("Missing null check");
      expect(result?.overall_correctness).toBe("patch is correct");
      expect(result?.overall_confidence_score).toBe(0.9);
    });

    test("returns null for invalid JSON", () => {
      const result = parseReviewSummary("{invalid json");
      expect(result).toBeNull();
    });

    test("returns null for wrong structure", () => {
      const json = JSON.stringify({ wrong: "structure" });
      const result = parseReviewSummary(json);
      expect(result).toBeNull();
    });

    test("returns null when findings is not an array", () => {
      const json = JSON.stringify({
        findings: "not an array",
        overall_correctness: "patch is correct",
        overall_explanation: "explanation",
        overall_confidence_score: 0.8,
      });
      const result = parseReviewSummary(json);
      expect(result).toBeNull();
    });

    test("returns null for invalid overall_correctness value", () => {
      const json = JSON.stringify({
        findings: [],
        overall_correctness: "maybe correct",
        overall_explanation: "explanation",
        overall_confidence_score: 0.8,
      });
      const result = parseReviewSummary(json);
      expect(result).toBeNull();
    });

    test("returns null for confidence_score out of range", () => {
      const json = JSON.stringify({
        findings: [],
        overall_correctness: "patch is correct",
        overall_explanation: "explanation",
        overall_confidence_score: 1.5,
      });
      const result = parseReviewSummary(json);
      expect(result).toBeNull();
    });

    test("accepts findings with optional priority", () => {
      const json = JSON.stringify({
        findings: [
          {
            title: "Issue",
            body: "Description",
            confidence_score: 0.7,
            code_location: {
              absolute_file_path: "/src/index.ts",
              line_range: { start: 1, end: 10 },
            },
          },
        ],
        overall_correctness: "patch is incorrect",
        overall_explanation: "explanation",
        overall_confidence_score: 0.6,
      });
      const result = parseReviewSummary(json);
      expect(result).not.toBeNull();
      expect(result?.findings[0]?.priority).toBeUndefined();
    });
  });
});
