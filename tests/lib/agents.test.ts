import { describe, expect, test } from "bun:test";
import { AGENTS } from "@/lib/agents";
import type { AgentConfig, ReviewOptions } from "@/lib/types";

describe("agents", () => {
  describe("AGENTS registry", () => {
    test("has all six agent types", () => {
      expect(AGENTS.codex).toBeDefined();
      expect(AGENTS.claude).toBeDefined();
      expect(AGENTS.opencode).toBeDefined();
      expect(AGENTS.droid).toBeDefined();
      expect(AGENTS.gemini).toBeDefined();
      expect(AGENTS.pi).toBeDefined();
    });

    test("each agent has required config properties", () => {
      for (const [_name, agentModule] of Object.entries(AGENTS)) {
        const agentConfig = agentModule.config as AgentConfig;
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
      const args = AGENTS.codex.config.buildArgs("reviewer", "", undefined);
      expect(args).toContain("review");
      expect(args).toContain("--uncommitted");
    });

    test("builds fixer args correctly", () => {
      const args = AGENTS.codex.config.buildArgs("fixer", "fix the bug", undefined);
      expect(args[0]).toBe("exec");
      expect(args.some((a: string) => a.includes("fix the bug"))).toBe(true);
    });

    test("uses --uncommitted when no reviewOptions provided", () => {
      const args = AGENTS.codex.config.buildArgs("reviewer", "", undefined, undefined);
      expect(args).toContain("review");
      expect(args).toContain("--uncommitted");
      expect(args).not.toContain("--commit");
      expect(args).not.toContain("--base");
    });

    test("uses --commit when commitSha provided", () => {
      const reviewOptions: ReviewOptions = { commitSha: "abc123" };
      const args = AGENTS.codex.config.buildArgs("reviewer", "", undefined, reviewOptions);
      expect(args).toContain("review");
      expect(args).toContain("--commit");
      expect(args).toContain("abc123");
      expect(args).not.toContain("--uncommitted");
    });

    test("uses --base when baseBranch provided", () => {
      const reviewOptions: ReviewOptions = { baseBranch: "main" };
      const args = AGENTS.codex.config.buildArgs("reviewer", "", undefined, reviewOptions);
      expect(args).toContain("review");
      expect(args).toContain("--base");
      expect(args).toContain("main");
      expect(args).not.toContain("--uncommitted");
    });

    test("uses exec mode for customInstructions", () => {
      const reviewOptions: ReviewOptions = { customInstructions: "check security" };
      const args = AGENTS.codex.config.buildArgs(
        "reviewer",
        "check security",
        undefined,
        reviewOptions
      );
      expect(args).toContain("exec");
      expect(args).toContain("--full-auto");
      expect(args).not.toContain("--uncommitted");
      expect(args).not.toContain("--commit");
      expect(args).not.toContain("--base");
      // Should contain the review prompt
      expect(args.some((a: string) => a.includes("review"))).toBe(true);
    });

    test("commitSha takes precedence over customInstructions", () => {
      const reviewOptions: ReviewOptions = {
        commitSha: "abc123",
        customInstructions: "check security",
      };
      const args = AGENTS.codex.config.buildArgs("reviewer", "ignored", undefined, reviewOptions);
      expect(args).toContain("review");
      expect(args).toContain("--commit");
      expect(args).toContain("abc123");
      expect(args).not.toContain("--full-auto");
      expect(args).not.toContain("--base");
      expect(args).not.toContain("--uncommitted");
    });

    test("baseBranch takes precedence over customInstructions", () => {
      const reviewOptions: ReviewOptions = {
        baseBranch: "main",
        customInstructions: "check security",
      };
      const args = AGENTS.codex.config.buildArgs("reviewer", "ignored", undefined, reviewOptions);
      expect(args).toContain("review");
      expect(args).toContain("--base");
      expect(args).toContain("main");
      expect(args).not.toContain("--full-auto");
      expect(args).not.toContain("--commit");
      expect(args).not.toContain("--uncommitted");
    });

    test("commitSha takes precedence over baseBranch", () => {
      const reviewOptions: ReviewOptions = { commitSha: "abc123", baseBranch: "main" };
      const args = AGENTS.codex.config.buildArgs("reviewer", "", undefined, reviewOptions);
      expect(args).toContain("--commit");
      expect(args).toContain("abc123");
      expect(args).not.toContain("--base");
    });

    test("uses configured reasoning level when valid", () => {
      const args = AGENTS.codex.config.buildArgs(
        "reviewer",
        "",
        undefined,
        undefined,
        undefined,
        "xhigh"
      );
      expect(args).toContain("--config");
      expect(args).toContain("model_reasoning_effort=xhigh");
    });

    test("falls back to high thinking when config value is invalid", () => {
      const args = AGENTS.codex.config.buildArgs(
        "reviewer",
        "",
        undefined,
        undefined,
        undefined,
        "max"
      );
      expect(args).toContain("--config");
      expect(args).toContain("model_reasoning_effort=high");
    });
  });

  describe("claude buildArgs", () => {
    test("builds args with prompt correctly", () => {
      const args = AGENTS.claude.config.buildArgs("reviewer", "review the code", undefined);
      expect(args).toContain("-p");
      expect(args.some((a: string) => a.toLowerCase().includes("review"))).toBe(true);
    });

    test("builds fixer args correctly", () => {
      const args = AGENTS.claude.config.buildArgs("fixer", "fix the fix", undefined);
      expect(args).toContain("-p");
      expect(args.some((a: string) => a.includes("fix the fix"))).toBe(true);
    });

    test("includes model flags when a model is provided", () => {
      const args = AGENTS.claude.config.buildArgs("reviewer", "review the code", "claude-opus-4-6");
      expect(args).toContain("--model");
      expect(args).toContain("claude-opus-4-6");
    });
  });

  describe("opencode buildArgs", () => {
    test("builds args with prompt correctly", () => {
      const args = AGENTS.opencode.config.buildArgs("reviewer", "review the code", undefined);
      expect(args[0]).toBe("run");
      expect(args.some((a: string) => a.includes("review"))).toBe(true);
    });

    test("builds fixer args correctly", () => {
      const args = AGENTS.opencode.config.buildArgs("fixer", "apply changes", undefined);
      expect(args[0]).toBe("run");
      expect(args.some((a: string) => a.includes("apply changes"))).toBe(true);
    });

    test("adds variant when reasoning level is valid", () => {
      const args = AGENTS.opencode.config.buildArgs(
        "reviewer",
        "review the code",
        "gpt-5.2-codex",
        undefined,
        undefined,
        "xhigh"
      );
      expect(args).toContain("--variant");
      expect(args).toContain("xhigh");
    });

    test("omits variant when reasoning level is invalid", () => {
      const args = AGENTS.opencode.config.buildArgs(
        "reviewer",
        "review the code",
        "gpt-5.2-codex",
        undefined,
        undefined,
        "max"
      );
      expect(args).not.toContain("--variant");
    });
  });

  describe("droid buildArgs", () => {
    test("builds args with prompt correctly", () => {
      const args = AGENTS.droid.config.buildArgs("reviewer", "/review current changes", undefined);
      expect(args[0]).toBe("exec");
      expect(args).toContain("--model");
      expect(args).toContain("gpt-5.2-codex");
      expect(args).toContain("--reasoning-effort");
      expect(args).toContain("/review current changes");
    });

    test("builds fixer args correctly", () => {
      const args = AGENTS.droid.config.buildArgs("fixer", "fix the issue", undefined);
      expect(args[0]).toBe("exec");
      expect(args).toContain("--auto");
      expect(args).toContain("medium");
      expect(args.some((a: string) => a.includes("fix the issue"))).toBe(true);
    });

    test("uses custom model when provided", () => {
      const args = AGENTS.droid.config.buildArgs("reviewer", "", "custom-model");
      expect(args).toContain("custom-model");
      expect(args).not.toContain("gpt-5.2-codex");
    });

    test("uses configured reasoning level for supported model", () => {
      const args = AGENTS.droid.config.buildArgs(
        "reviewer",
        "review",
        "gpt-5.2-codex",
        undefined,
        undefined,
        "xhigh"
      );
      expect(args).toContain("--reasoning-effort");
      expect(args).toContain("xhigh");
    });

    test("omits reasoning effort for unsupported model", () => {
      const args = AGENTS.droid.config.buildArgs("reviewer", "review", "glm-4.7");
      expect(args).not.toContain("--reasoning-effort");
    });
  });

  describe("gemini buildArgs", () => {
    test("builds args with prompt correctly", () => {
      const args = AGENTS.gemini.config.buildArgs(
        "reviewer",
        "review the uncommitted changes",
        undefined
      );
      expect(args[0]).toBe("--yolo");
      expect(args).toContain("--output-format");
      expect(args).toContain("stream-json");
      expect(args).toContain("review the uncommitted changes");
    });

    test("builds fixer args correctly", () => {
      const args = AGENTS.gemini.config.buildArgs("fixer", "fix the issue", undefined);
      expect(args[0]).toBe("--yolo");
      expect(args).toContain("--output-format");
      expect(args).toContain("stream-json");
      expect(args.some((a: string) => a.includes("fix the issue"))).toBe(true);
    });

    test("includes model when provided", () => {
      const args = AGENTS.gemini.config.buildArgs(
        "reviewer",
        "review the uncommitted changes",
        "gemini-3-flash"
      );
      expect(args).toContain("--model");
      expect(args).toContain("gemini-3-flash");
    });
  });

  describe("pi buildArgs", () => {
    test("builds args with provider and model", () => {
      const args = AGENTS.pi.config.buildArgs(
        "reviewer",
        "review current changes",
        "gemini_cli/gemini-3-flash-preview",
        undefined,
        "llm-proxy"
      );

      expect(args).toEqual([
        "--provider",
        "llm-proxy",
        "--model",
        "gemini_cli/gemini-3-flash-preview",
        "--mode",
        "json",
        "-p",
        "review current changes",
      ]);
    });

    test("adds thinking when level is valid", () => {
      const args = AGENTS.pi.config.buildArgs(
        "reviewer",
        "review current changes",
        "gemini_cli/gemini-3-flash-preview",
        undefined,
        "llm-proxy",
        "xhigh"
      );

      expect(args).toContain("--thinking");
      expect(args).toContain("xhigh");
    });

    test("omits thinking when level is invalid", () => {
      const args = AGENTS.pi.config.buildArgs(
        "reviewer",
        "review current changes",
        "gemini_cli/gemini-3-flash-preview",
        undefined,
        "llm-proxy",
        "max"
      );

      expect(args).not.toContain("--thinking");
    });

    test("throws when provider or model is missing", () => {
      expect(() => AGENTS.pi.config.buildArgs("reviewer", "review current changes")).toThrow(
        "Pi agent requires both provider and model"
      );
      expect(() =>
        AGENTS.pi.config.buildArgs(
          "reviewer",
          "review current changes",
          "gemini_cli/gemini-3-flash-preview"
        )
      ).toThrow("Pi agent requires both provider and model");
    });
  });

  describe("buildEnv", () => {
    test("returns environment object", () => {
      const env = AGENTS.codex.config.buildEnv();
      expect(typeof env).toBe("object");
    });
  });

  describe("claude buildEnv", () => {
    test("sets CLAUDE_CODE_EFFORT_LEVEL when reasoning is provided", () => {
      const env = AGENTS.claude.config.buildEnv("high");
      expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBe("high");
    });

    test("sets CLAUDE_CODE_EFFORT_LEVEL for each valid level", () => {
      for (const level of ["low", "medium", "high"]) {
        const env = AGENTS.claude.config.buildEnv(level);
        expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBe(level);
      }
    });

    test("does not override CLAUDE_CODE_EFFORT_LEVEL when reasoning is undefined", () => {
      const env = AGENTS.claude.config.buildEnv();
      // Should inherit from process.env (if set) rather than explicitly setting a value
      expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBe(process.env.CLAUDE_CODE_EFFORT_LEVEL);
    });

    test("spreads process.env into the result", () => {
      const env = AGENTS.claude.config.buildEnv();
      expect(env.PATH).toBe(process.env.PATH);
    });

    test("ignores unsupported reasoning levels", () => {
      for (const level of ["xhigh", "max", "invalid"]) {
        const env = AGENTS.claude.config.buildEnv(level);
        expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBe(process.env.CLAUDE_CODE_EFFORT_LEVEL);
      }
    });
  });
});
