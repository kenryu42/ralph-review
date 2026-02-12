import { describe, expect, test } from "bun:test";
import {
  CONFIG_SCHEMA_URI,
  CONFIG_VERSION,
  type Config,
  type IterationResult,
  isAgentRole,
  isAgentType,
  type RunState,
} from "@/lib/types";

describe("type guards", () => {
  describe("isAgentType", () => {
    test("returns true for valid agent types", () => {
      expect(isAgentType("codex")).toBe(true);
      expect(isAgentType("claude")).toBe(true);
      expect(isAgentType("opencode")).toBe(true);
      expect(isAgentType("droid")).toBe(true);
      expect(isAgentType("pi")).toBe(true);
    });

    test("returns false for invalid agent types", () => {
      expect(isAgentType("invalid")).toBe(false);
      expect(isAgentType("")).toBe(false);
      expect(isAgentType(null)).toBe(false);
      expect(isAgentType(undefined)).toBe(false);
      expect(isAgentType(123)).toBe(false);
      expect(isAgentType({})).toBe(false);
    });
  });

  describe("isAgentRole", () => {
    test("returns true for valid agent roles", () => {
      expect(isAgentRole("reviewer")).toBe(true);
      expect(isAgentRole("fixer")).toBe(true);
      expect(isAgentRole("code-simplifier")).toBe(true);
    });

    test("returns false for invalid agent roles", () => {
      expect(isAgentRole("invalid")).toBe(false);
      expect(isAgentRole("")).toBe(false);
      expect(isAgentRole(null)).toBe(false);
      expect(isAgentRole(undefined)).toBe(false);
      expect(isAgentRole(123)).toBe(false);
    });
  });
});

describe("type definitions", () => {
  test("Config type structure is correct", () => {
    const config: Config = {
      $schema: CONFIG_SCHEMA_URI,
      version: CONFIG_VERSION,
      reviewer: { agent: "codex", model: "gpt-4" },
      fixer: { agent: "claude" },
      maxIterations: 10,
      iterationTimeout: 600000,
      defaultReview: { type: "uncommitted" },
      notifications: { sound: { enabled: false } },
    };
    expect(config.reviewer.agent).toBe("codex");
    expect(config.fixer.agent).toBe("claude");
    expect(config.maxIterations).toBe(10);
  });

  test("RunState type structure is correct", () => {
    const state: RunState = {
      sessionName: "rr-12345",
      startTime: Date.now(),
      iteration: 1,
      status: "running",
      lastOutput: "some output",
    };
    expect(state.sessionName).toBe("rr-12345");
    expect(state.status).toBe("running");
  });

  test("IterationResult type structure is correct", () => {
    const result: IterationResult = {
      success: true,
      output: "No issues found",
      exitCode: 0,
      duration: 5000,
    };
    expect(result.success).toBe(true);
    expect(result.output).toBe("No issues found");
  });
});
