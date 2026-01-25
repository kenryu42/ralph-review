import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildConfig,
  checkAgentInstalled,
  checkTmuxInstalled,
  validateAgentSelection,
} from "@/commands/init";

// We'll test the core logic functions, not the interactive prompts
// Interactive prompts will be tested manually

describe("init command", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ralph-review-init-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("validateAgentSelection", () => {
    test("returns true for valid agent", () => {
      expect(validateAgentSelection("codex")).toBe(true);
      expect(validateAgentSelection("claude")).toBe(true);
      expect(validateAgentSelection("opencode")).toBe(true);
    });

    test("returns false for invalid agent", () => {
      expect(validateAgentSelection("invalid")).toBe(false);
      expect(validateAgentSelection("")).toBe(false);
    });
  });

  describe("checkAgentInstalled", () => {
    test("returns true for installed commands", () => {
      // 'ls' should be installed on all systems
      expect(checkAgentInstalled("ls")).toBe(true);
    });

    test("returns false for non-existent commands", () => {
      expect(checkAgentInstalled("nonexistent-command-xyz")).toBe(false);
    });
  });

  describe("checkTmuxInstalled", () => {
    test("returns boolean for tmux check", () => {
      const result = checkTmuxInstalled();
      expect(typeof result).toBe("boolean");
    });
  });

  describe("buildConfig", () => {
    test("creates valid config from user input", () => {
      const config = buildConfig({
        reviewerAgent: "codex",
        reviewerModel: "gpt-4",
        implementorAgent: "claude",
        implementorModel: "",
        maxIterations: 5,
        iterationTimeoutMinutes: 30,
      });

      expect(config.reviewer.agent).toBe("codex");
      expect(config.reviewer.model).toBe("gpt-4");
      expect(config.fixer.agent).toBe("claude");
      expect(config.fixer.model).toBeUndefined();
      expect(config.maxIterations).toBe(5);
      expect(config.iterationTimeout).toBe(1800000);
    });

    test("handles empty model as undefined", () => {
      const config = buildConfig({
        reviewerAgent: "opencode",
        reviewerModel: "",
        implementorAgent: "opencode",
        implementorModel: "",
        maxIterations: 10,
        iterationTimeoutMinutes: 15,
      });

      expect(config.reviewer.model).toBeUndefined();
      expect(config.fixer.model).toBeUndefined();
    });

    test("converts timeout minutes to milliseconds", () => {
      const config = buildConfig({
        reviewerAgent: "codex",
        reviewerModel: "",
        implementorAgent: "codex",
        implementorModel: "",
        maxIterations: 3,
        iterationTimeoutMinutes: 10,
      });

      expect(config.maxIterations).toBe(3);
      expect(config.iterationTimeout).toBe(600000); // 10 min * 60 * 1000
    });
  });
});
