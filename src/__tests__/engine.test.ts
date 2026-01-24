import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import type { Config, IterationResult } from "../lib/types";

// Mock config for testing
const mockConfig: Config = {
  reviewer: { agent: "codex" },
  implementor: { agent: "claude" },
  maxIterations: 3,
  iterationTimeout: 60000,
};

describe("engine", () => {
  describe("createImplementorPrompt", () => {
    const { createImplementorPrompt } = require("../lib/engine");

    test("includes review output in prompt", () => {
      const reviewOutput = "Found bug in line 42";
      const prompt = createImplementorPrompt(reviewOutput);
      expect(prompt).toContain(reviewOutput);
      expect(prompt.length).toBeGreaterThan(reviewOutput.length);
    });
  });

  describe("shouldContinueLoop", () => {
    const { shouldContinueLoop } = require("../lib/engine");

    test("returns false when no issues found", () => {
      const result: IterationResult = {
        success: true,
        hasIssues: false,
        output: "No issues found",
        exitCode: 0,
        duration: 1000,
      };
      expect(shouldContinueLoop(result, 1, 10)).toBe(false);
    });

    test("returns false when max iterations reached", () => {
      const result: IterationResult = {
        success: true,
        hasIssues: true,
        output: "Issues found",
        exitCode: 0,
        duration: 1000,
      };
      expect(shouldContinueLoop(result, 10, 10)).toBe(false);
    });

    test("returns true when issues found and not at max", () => {
      const result: IterationResult = {
        success: true,
        hasIssues: true,
        output: "Issues found",
        exitCode: 0,
        duration: 1000,
      };
      expect(shouldContinueLoop(result, 1, 10)).toBe(true);
    });

    test("returns false when reviewer failed", () => {
      const result: IterationResult = {
        success: false,
        hasIssues: true,
        output: "Error",
        exitCode: 1,
        duration: 1000,
      };
      expect(shouldContinueLoop(result, 1, 10)).toBe(false);
    });
  });

  describe("CycleResult", () => {
    const { determineCycleResult } = require("../lib/engine");

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
