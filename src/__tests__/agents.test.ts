import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";

describe("agents", () => {
  describe("AGENTS registry", () => {
    const { AGENTS } = require("../lib/agents");

    test("has all three agent types", () => {
      expect(AGENTS.codex).toBeDefined();
      expect(AGENTS.claude).toBeDefined();
      expect(AGENTS.opencode).toBeDefined();
    });

    test("each agent has required properties", () => {
      for (const [name, config] of Object.entries(AGENTS)) {
        expect(config).toHaveProperty("command");
        expect(config).toHaveProperty("buildArgs");
        expect(config).toHaveProperty("buildEnv");
        expect(config).toHaveProperty("parseOutput");
        expect(typeof (config as any).command).toBe("string");
        expect(typeof (config as any).buildArgs).toBe("function");
        expect(typeof (config as any).buildEnv).toBe("function");
        expect(typeof (config as any).parseOutput).toBe("function");
      }
    });
  });

  describe("codex buildArgs", () => {
    const { AGENTS } = require("../lib/agents");

    test("builds reviewer args correctly", () => {
      const args = AGENTS.codex.buildArgs("reviewer", "", undefined);
      expect(args).toContain("review");
      expect(args).toContain("--uncommitted");
    });

    test("builds implementor args correctly", () => {
      const args = AGENTS.codex.buildArgs("implementor", "fix the bug", undefined);
      expect(args[0]).toBe("exec");
      expect(args.some((a: string) => a.includes("fix the bug"))).toBe(true);
    });
  });

  describe("claude buildArgs", () => {
    const { AGENTS } = require("../lib/agents");

    test("builds reviewer args correctly", () => {
      const args = AGENTS.claude.buildArgs("reviewer", "", undefined);
      expect(args).toContain("-p");
      expect(args.some((a: string) => a.toLowerCase().includes("review"))).toBe(true);
    });

    test("builds implementor args correctly", () => {
      const args = AGENTS.claude.buildArgs("implementor", "implement the fix", undefined);
      expect(args).toContain("-p");
      expect(args.some((a: string) => a.includes("implement the fix"))).toBe(true);
    });
  });

  describe("opencode buildArgs", () => {
    const { AGENTS } = require("../lib/agents");

    test("builds reviewer args correctly", () => {
      const args = AGENTS.opencode.buildArgs("reviewer", "", undefined);
      expect(args[0]).toBe("run");
      expect(args.some((a: string) => a.includes("codex-review"))).toBe(true);
    });

    test("builds implementor args correctly", () => {
      const args = AGENTS.opencode.buildArgs("implementor", "apply changes", undefined);
      expect(args[0]).toBe("run");
      expect(args.some((a: string) => a.includes("apply changes"))).toBe(true);
    });
  });

  describe("parseOutput", () => {
    const { AGENTS } = require("../lib/agents");

    test("codex parseOutput detects issues", () => {
      // By default, assume issues unless explicitly clean
      const result = AGENTS.codex.parseOutput("Some output line");
      // Null means no determination yet
      expect(result).toBeNull();
    });

    test("codex parseOutput detects clean output", () => {
      const result = AGENTS.codex.parseOutput("No issues found");
      expect(result).toEqual({ hasIssues: false });
    });
  });

  describe("buildEnv", () => {
    const { AGENTS } = require("../lib/agents");

    test("returns environment object", () => {
      const env = AGENTS.codex.buildEnv();
      expect(typeof env).toBe("object");
    });
  });
});
