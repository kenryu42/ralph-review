import { describe, expect, test } from "bun:test";
import { createImplementorPrompt, determineCycleResult, shouldRunImplementor } from "@/lib/engine";
import type { Config, IterationResult } from "@/lib/types";

// Mock config for testing
const _mockConfig: Config = {
  reviewer: { agent: "codex" },
  fixer: { agent: "claude" },
  maxIterations: 3,
  iterationTimeout: 60000,
};

describe("engine", () => {
  describe("createImplementorPrompt", () => {
    test("includes review output in prompt", () => {
      const reviewOutput = "Found bug in line 42";
      const prompt = createImplementorPrompt(reviewOutput);
      expect(prompt).toContain(reviewOutput);
      expect(prompt.length).toBeGreaterThan(reviewOutput.length);
    });
  });

  describe("shouldRunImplementor", () => {
    test("returns false when no issues found", () => {
      const result: IterationResult = {
        success: true,
        hasIssues: false,
        output: "No issues found",
        exitCode: 0,
        duration: 1000,
      };
      expect(shouldRunImplementor(result)).toBe(false);
    });

    test("returns true when issues found", () => {
      const result: IterationResult = {
        success: true,
        hasIssues: true,
        output: "Issues found",
        exitCode: 0,
        duration: 1000,
      };
      expect(shouldRunImplementor(result)).toBe(true);
    });

    test("returns false when reviewer failed", () => {
      const result: IterationResult = {
        success: false,
        hasIssues: true,
        output: "Error",
        exitCode: 1,
        duration: 1000,
      };
      expect(shouldRunImplementor(result)).toBe(false);
    });
  });

  describe("CycleResult", () => {
    test("returns success when no issues", () => {
      const result = determineCycleResult(false, 3, 10, false);
      expect(result.success).toBe(true);
      expect(result.reason).toContain("No issues");
    });

    test("returns failure when max iterations", () => {
      const result = determineCycleResult(true, 10, 10, false);
      expect(result.success).toBe(false);
      expect(result.reason).toContain("Max iterations");
    });

    test("returns failure when interrupted", () => {
      const result = determineCycleResult(true, 5, 10, true);
      expect(result.success).toBe(false);
      expect(result.reason).toContain("interrupted");
    });
  });
});
