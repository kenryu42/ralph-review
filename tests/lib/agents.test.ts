import { describe, expect, test } from "bun:test";
import { AGENTS } from "@/lib/agents";
import { registerCodexReasoningOptions } from "@/lib/agents/models";
import type { AgentConfig } from "@/lib/types";

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
    const reviewerPrompt = "GENERATED_REVIEW_PROMPT";

    test("builds reviewer args correctly", () => {
      const args = AGENTS.codex.config.buildArgs("reviewer", reviewerPrompt, undefined);
      expect(args[0]).toBe("exec");
      expect(args).toContain("review");
      expect(args).toContain("--json");
      expect(args).toContain(reviewerPrompt);
      expect(args).not.toContain("--uncommitted");
      expect(args).not.toContain("--commit");
      expect(args).not.toContain("--base");
    });

    test("builds fixer args correctly", () => {
      const args = AGENTS.codex.config.buildArgs("fixer", "fix the bug", undefined);
      expect(args[0]).toBe("exec");
      expect(args.some((a: string) => a.includes("fix the bug"))).toBe(true);
    });

    test("rejects reviewer args when prompt is empty", () => {
      expect(() => AGENTS.codex.config.buildArgs("reviewer", "", undefined)).toThrow(
        "Codex reviewer requires a generated review prompt"
      );
    });

    test("never translates reviewOptions into codex scope flags", () => {
      const args = AGENTS.codex.config.buildArgs("reviewer", reviewerPrompt, undefined, {
        commitSha: "abc123",
        baseBranch: "main",
        customInstructions: "check security",
      });

      expect(args).toContain("exec");
      expect(args).toContain("review");
      expect(args).toContain("--json");
      expect(args).toContain(reviewerPrompt);
      expect(args).not.toContain("--uncommitted");
      expect(args).not.toContain("--commit");
      expect(args).not.toContain("--base");
    });

    test("uses review mode when reviewer instructions are provided", () => {
      const args = AGENTS.codex.config.buildArgs("reviewer", "check security", undefined, {
        customInstructions: "check security",
      });
      expect(args).toContain("exec");
      expect(args).toContain("review");
      expect(args).toContain("--json");
      expect(args).toContain("check security");
      expect(args).not.toContain("--uncommitted");
      expect(args).not.toContain("--commit");
      expect(args).not.toContain("--base");
    });

    test("uses review mode when reviewer prompt has no repo review target", () => {
      const args = AGENTS.codex.config.buildArgs("reviewer", "TARGETED_AUDIT_PROMPT", undefined);
      expect(args).toContain("exec");
      expect(args).toContain("review");
      expect(args).toContain("TARGETED_AUDIT_PROMPT");
      expect(args).not.toContain("--uncommitted");
    });

    test("uses review mode when prompt is combined with commitSha", () => {
      const args = AGENTS.codex.config.buildArgs("reviewer", "ignored", undefined, {
        commitSha: "abc123",
        customInstructions: "check security",
      });
      expect(args).toContain("exec");
      expect(args).toContain("review");
      expect(args).toContain("--json");
      expect(args).toContain("ignored");
      expect(args).not.toContain("--commit");
      expect(args).not.toContain("--base");
      expect(args).not.toContain("--uncommitted");
    });

    test("uses review mode when prompt is combined with baseBranch", () => {
      const args = AGENTS.codex.config.buildArgs("reviewer", "ignored", undefined, {
        baseBranch: "main",
        customInstructions: "check security",
      });
      expect(args).toContain("exec");
      expect(args).toContain("review");
      expect(args).toContain("--json");
      expect(args).toContain("ignored");
      expect(args).not.toContain("--commit");
      expect(args).not.toContain("--base");
      expect(args).not.toContain("--uncommitted");
    });

    test("uses configured reasoning level when valid", () => {
      registerCodexReasoningOptions({
        "gpt-5.4": ["low", "medium", "high", "xhigh"],
      });

      const args = AGENTS.codex.config.buildArgs(
        "reviewer",
        reviewerPrompt,
        "gpt-5.4",
        undefined,
        undefined,
        "xhigh"
      );
      expect(args).toContain("--config");
      expect(args).toContain("model_reasoning_effort=xhigh");
    });

    test("falls back to high thinking when config value is unsupported for discovered model", () => {
      registerCodexReasoningOptions({
        "gpt-5.4-mini": ["low", "medium"],
      });

      const args = AGENTS.codex.config.buildArgs(
        "reviewer",
        reviewerPrompt,
        "gpt-5.4-mini",
        undefined,
        undefined,
        "xhigh"
      );
      expect(args).toContain("--config");
      expect(args).toContain("model_reasoning_effort=high");
    });

    test("passes through valid reasoning level when model metadata is unavailable", () => {
      const args = AGENTS.codex.config.buildArgs(
        "reviewer",
        reviewerPrompt,
        "unknown-codex-model",
        undefined,
        undefined,
        "max"
      );
      expect(args).toContain("--config");
      expect(args).toContain("model_reasoning_effort=max");
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
