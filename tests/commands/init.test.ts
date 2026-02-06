import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildConfig,
  checkAgentInstalled,
  checkAllAgents,
  checkTmuxInstalled,
  parsePiListModelsOutput,
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
      expect(validateAgentSelection("pi")).toBe(true);
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

  describe("checkAllAgents", () => {
    test("returns availability object for all agent types", () => {
      const result = checkAllAgents();

      expect(typeof result.codex).toBe("boolean");
      expect(typeof result.opencode).toBe("boolean");
      expect(typeof result.claude).toBe("boolean");
      expect(typeof result.droid).toBe("boolean");
      expect(typeof result.pi).toBe("boolean");
    });

    test("returns object with all six agent types", () => {
      const result = checkAllAgents();
      const keys = Object.keys(result);

      expect(keys).toContain("codex");
      expect(keys).toContain("opencode");
      expect(keys).toContain("claude");
      expect(keys).toContain("droid");
      expect(keys).toContain("gemini");
      expect(keys).toContain("pi");
      expect(keys.length).toBe(6);
    });
  });

  describe("buildConfig", () => {
    test("creates valid config from user input", () => {
      const config = buildConfig({
        reviewerAgent: "codex",
        reviewerModel: "gpt-4",
        fixerAgent: "claude",
        fixerModel: "",
        maxIterations: 5,
        iterationTimeoutMinutes: 30,
        defaultReviewType: "uncommitted",
      });

      expect(config.reviewer.agent).toBe("codex");
      expect(config.reviewer.model).toBe("gpt-4");
      expect(config.fixer.agent).toBe("claude");
      expect(config.fixer.model).toBeUndefined();
      expect(config.maxIterations).toBe(5);
      expect(config.iterationTimeout).toBe(1800000);
      expect(config.defaultReview).toEqual({ type: "uncommitted" });
    });

    test("handles empty model as undefined", () => {
      const config = buildConfig({
        reviewerAgent: "opencode",
        reviewerModel: "",
        fixerAgent: "opencode",
        fixerModel: "",
        maxIterations: 10,
        iterationTimeoutMinutes: 15,
        defaultReviewType: "uncommitted",
      });

      expect(config.reviewer.model).toBeUndefined();
      expect(config.fixer.model).toBeUndefined();
    });

    test("converts timeout minutes to milliseconds", () => {
      const config = buildConfig({
        reviewerAgent: "codex",
        reviewerModel: "",
        fixerAgent: "codex",
        fixerModel: "",
        maxIterations: 3,
        iterationTimeoutMinutes: 10,
        defaultReviewType: "uncommitted",
      });

      expect(config.maxIterations).toBe(3);
      expect(config.iterationTimeout).toBe(600000); // 10 min * 60 * 1000
    });

    test("stores provider and model for pi", () => {
      const config = buildConfig({
        reviewerAgent: "pi",
        reviewerModel: "gemini_cli/gemini-3-flash-preview",
        reviewerProvider: "llm-proxy",
        fixerAgent: "pi",
        fixerModel: "claude-sonnet-4-5",
        fixerProvider: "anthropic",
        maxIterations: 3,
        iterationTimeoutMinutes: 10,
        defaultReviewType: "uncommitted",
      });

      expect(config.reviewer.agent).toBe("pi");
      if (config.reviewer.agent === "pi") {
        expect(config.reviewer.provider).toBe("llm-proxy");
        expect(config.reviewer.model).toBe("gemini_cli/gemini-3-flash-preview");
      }

      expect(config.fixer.agent).toBe("pi");
      if (config.fixer.agent === "pi") {
        expect(config.fixer.provider).toBe("anthropic");
        expect(config.fixer.model).toBe("claude-sonnet-4-5");
      }
    });

    test("creates config with base branch default review", () => {
      const config = buildConfig({
        reviewerAgent: "codex",
        reviewerModel: "",
        fixerAgent: "claude",
        fixerModel: "",
        maxIterations: 5,
        iterationTimeoutMinutes: 30,
        defaultReviewType: "base",
        defaultReviewBranch: "main",
      });

      expect(config.defaultReview).toEqual({ type: "base", branch: "main" });
    });

    test("defaults to uncommitted when base type without branch", () => {
      const config = buildConfig({
        reviewerAgent: "codex",
        reviewerModel: "",
        fixerAgent: "claude",
        fixerModel: "",
        maxIterations: 5,
        iterationTimeoutMinutes: 30,
        defaultReviewType: "base",
        // defaultReviewBranch is undefined
      });

      // Should fall back to uncommitted when branch is not provided for base type
      expect(config.defaultReview).toEqual({ type: "uncommitted" });
    });
  });

  describe("parsePiListModelsOutput", () => {
    test("parses provider and model columns", () => {
      const output = [
        "provider   model                              context  max-out",
        "anthropic  claude-sonnet-4-5                 200K     64K",
        "llm-proxy  gemini_cli/gemini-3-flash-preview 1M       64K",
      ].join("\n");

      const models = parsePiListModelsOutput(output);

      expect(models).toEqual([
        { provider: "anthropic", model: "claude-sonnet-4-5" },
        { provider: "llm-proxy", model: "gemini_cli/gemini-3-flash-preview" },
      ]);
    });

    test("deduplicates exact provider/model pairs and ignores malformed lines", () => {
      const output = [
        "provider   model                              context  max-out",
        "anthropic  claude-sonnet-4-5                 200K     64K",
        "anthropic  claude-sonnet-4-5                 200K     64K",
        "",
        "invalid-line",
        "llm-proxy  gemini_cli/gemini-3-pro-preview   1M       64K",
      ].join("\n");

      const models = parsePiListModelsOutput(output);

      expect(models).toEqual([
        { provider: "anthropic", model: "claude-sonnet-4-5" },
        { provider: "llm-proxy", model: "gemini_cli/gemini-3-pro-preview" },
      ]);
    });
  });
});
