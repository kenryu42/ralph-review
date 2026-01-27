import { describe, expect, test } from "bun:test";
import { AGENTS } from "@/lib/agents";
import type { AgentConfig } from "@/lib/types";

describe("agents", () => {
  describe("AGENTS registry", () => {
    test("has all four agent types", () => {
      expect(AGENTS.codex).toBeDefined();
      expect(AGENTS.claude).toBeDefined();
      expect(AGENTS.opencode).toBeDefined();
      expect(AGENTS.droid).toBeDefined();
    });

    test("each agent has required properties", () => {
      for (const [_name, config] of Object.entries(AGENTS)) {
        const agentConfig = config as AgentConfig;
        expect(agentConfig).toHaveProperty("command");
        expect(agentConfig).toHaveProperty("buildArgs");
        expect(agentConfig).toHaveProperty("buildEnv");
        expect(typeof agentConfig.command).toBe("string");
        expect(typeof agentConfig.buildArgs).toBe("function");
        expect(typeof agentConfig.buildEnv).toBe("function");
      }
    });
  });

  describe("codex buildArgs", () => {
    test("builds reviewer args correctly", () => {
      const args = AGENTS.codex.buildArgs("reviewer", "", undefined);
      expect(args).toContain("review");
      expect(args).toContain("--uncommitted");
    });

    test("builds fixer args correctly", () => {
      const args = AGENTS.codex.buildArgs("fixer", "fix the bug", undefined);
      expect(args[0]).toBe("exec");
      expect(args.some((a: string) => a.includes("fix the bug"))).toBe(true);
    });
  });

  describe("claude buildArgs", () => {
    test("builds reviewer args correctly", () => {
      const args = AGENTS.claude.buildArgs("reviewer", "", undefined);
      expect(args).toContain("-p");
      expect(args.some((a: string) => a.toLowerCase().includes("review"))).toBe(true);
    });

    test("builds fixer args correctly", () => {
      const args = AGENTS.claude.buildArgs("fixer", "fix the fix", undefined);
      expect(args).toContain("-p");
      expect(args.some((a: string) => a.includes("fix the fix"))).toBe(true);
    });
  });

  describe("opencode buildArgs", () => {
    test("builds reviewer args correctly", () => {
      const args = AGENTS.opencode.buildArgs("reviewer", "", undefined);
      expect(args[0]).toBe("run");
      expect(args.some((a: string) => a.includes("review"))).toBe(true);
    });

    test("builds fixer args correctly", () => {
      const args = AGENTS.opencode.buildArgs("fixer", "apply changes", undefined);
      expect(args[0]).toBe("run");
      expect(args.some((a: string) => a.includes("apply changes"))).toBe(true);
    });
  });

  describe("droid buildArgs", () => {
    test("builds reviewer args correctly", () => {
      const args = AGENTS.droid.buildArgs("reviewer", "", undefined);
      expect(args[0]).toBe("exec");
      expect(args).toContain("--model");
      expect(args).toContain("gpt-5.2-codex");
      expect(args).toContain("--reasoning-effort");
      expect(args).toContain("/review current changes");
    });

    test("builds fixer args correctly", () => {
      const args = AGENTS.droid.buildArgs("fixer", "fix the issue", undefined);
      expect(args[0]).toBe("exec");
      expect(args).toContain("--auto");
      expect(args).toContain("medium");
      expect(args.some((a: string) => a.includes("fix the issue"))).toBe(true);
    });

    test("uses custom model when provided", () => {
      const args = AGENTS.droid.buildArgs("reviewer", "", "custom-model");
      expect(args).toContain("custom-model");
      expect(args).not.toContain("gpt-5.2-codex");
    });
  });

  describe("buildEnv", () => {
    test("returns environment object", () => {
      const env = AGENTS.codex.buildEnv();
      expect(typeof env).toBe("object");
    });
  });
});
