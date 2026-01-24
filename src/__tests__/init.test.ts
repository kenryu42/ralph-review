import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";

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
    // Import after we've set up the module
    const { validateAgentSelection } = require("../commands/init");

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
    const { checkAgentInstalled } = require("../commands/init");

    test("returns true for installed commands", () => {
      // 'ls' should be installed on all systems
      expect(checkAgentInstalled("ls")).toBe(true);
    });

    test("returns false for non-existent commands", () => {
      expect(checkAgentInstalled("nonexistent-command-xyz")).toBe(false);
    });
  });

  describe("checkTmuxInstalled", () => {
    const { checkTmuxInstalled } = require("../commands/init");

    test("returns boolean for tmux check", () => {
      const result = checkTmuxInstalled();
      expect(typeof result).toBe("boolean");
    });
  });

  describe("buildConfig", () => {
    const { buildConfig } = require("../commands/init");

    test("creates valid config from user input", () => {
      const config = buildConfig({
        reviewerAgent: "codex",
        reviewerModel: "gpt-4",
        implementorAgent: "claude",
        implementorModel: "",
      });

      expect(config.reviewer.agent).toBe("codex");
      expect(config.reviewer.model).toBe("gpt-4");
      expect(config.implementor.agent).toBe("claude");
      expect(config.implementor.model).toBeUndefined();
      expect(config.maxIterations).toBe(10);
      expect(config.iterationTimeout).toBe(600000);
    });

    test("handles empty model as undefined", () => {
      const config = buildConfig({
        reviewerAgent: "opencode",
        reviewerModel: "",
        implementorAgent: "opencode",
        implementorModel: "",
      });

      expect(config.reviewer.model).toBeUndefined();
      expect(config.implementor.model).toBeUndefined();
    });
  });
});
