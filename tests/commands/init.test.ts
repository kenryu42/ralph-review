import { describe, expect, test } from "bun:test";
import {
  buildAutoInitInput,
  buildConfig,
  checkAgentInstalled,
  checkAllAgents,
  checkTmuxInstalled,
  discoverAutoModelCandidates,
  getRoleAgentPriorityRank,
  getRoleModelPriorityRank,
  parsePiListModelsOutput,
  pickAutoRoleCandidate,
  selectAutoReasoning,
  validateAgentSelection,
} from "@/commands/init";
import type { AgentType } from "@/lib/types";

describe("init command", () => {
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
      expect(typeof result.gemini).toBe("boolean");
      expect(typeof result.pi).toBe("boolean");
    });
  });

  describe("buildConfig", () => {
    test("creates valid config from user input with explicit simplifier", () => {
      const config = buildConfig({
        reviewerAgent: "codex",
        reviewerModel: "gpt-4",
        fixerAgent: "claude",
        fixerModel: "",
        simplifierAgent: "droid",
        simplifierModel: "gpt-5.2-codex",
        maxIterations: 5,
        iterationTimeoutMinutes: 30,
        defaultReviewType: "uncommitted",
      });

      expect(config.reviewer.agent).toBe("codex");
      expect(config.reviewer.model).toBe("gpt-4");
      expect(config.fixer.agent).toBe("claude");
      expect(config.fixer.model).toBeUndefined();
      expect(config["code-simplifier"]).toEqual({
        agent: "droid",
        model: "gpt-5.2-codex",
        reasoning: undefined,
      });
      expect(config.maxIterations).toBe(5);
      expect(config.iterationTimeout).toBe(1800000);
      expect(config.defaultReview).toEqual({ type: "uncommitted" });
    });

    test("stores provider and model for pi", () => {
      const config = buildConfig({
        reviewerAgent: "pi",
        reviewerModel: "gemini_cli/gemini-3-flash-preview",
        reviewerProvider: "llm-proxy",
        reviewerReasoning: "high",
        fixerAgent: "pi",
        fixerModel: "claude-sonnet-4-5",
        fixerProvider: "anthropic",
        fixerReasoning: "medium",
        simplifierAgent: "pi",
        simplifierModel: "claude-sonnet-4-5",
        simplifierProvider: "anthropic",
        simplifierReasoning: "medium",
        maxIterations: 3,
        iterationTimeoutMinutes: 10,
        defaultReviewType: "uncommitted",
      });

      expect(config.reviewer.agent).toBe("pi");
      if (config.reviewer.agent === "pi") {
        expect(config.reviewer.provider).toBe("llm-proxy");
        expect(config.reviewer.model).toBe("gemini_cli/gemini-3-flash-preview");
      }

      expect(config["code-simplifier"]).toEqual({
        agent: "pi",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        reasoning: "medium",
      });
    });

    test("creates config with base branch default review", () => {
      const config = buildConfig({
        reviewerAgent: "codex",
        reviewerModel: "",
        fixerAgent: "claude",
        fixerModel: "",
        simplifierAgent: "claude",
        simplifierModel: "claude-opus-4-6",
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
        simplifierAgent: "claude",
        simplifierModel: "claude-opus-4-6",
        maxIterations: 5,
        iterationTimeoutMinutes: 30,
        defaultReviewType: "base",
      });

      expect(config.defaultReview).toEqual({ type: "uncommitted" });
    });
  });

  describe("auto selection helpers", () => {
    test("agent-rank helper returns lower rank for higher-priority reviewer agent", () => {
      expect(getRoleAgentPriorityRank("reviewer", "codex")).toBeLessThan(
        getRoleAgentPriorityRank("reviewer", "claude")
      );
    });

    test("reviewer model priority ranks GPT 5.3 codex > GPT 5.2 > GPT 5.2 codex", () => {
      const rank53 = getRoleModelPriorityRank("reviewer", "gpt-5.3-codex");
      const rank52 = getRoleModelPriorityRank("reviewer", "gpt-5.2");
      const rank52Codex = getRoleModelPriorityRank("reviewer", "gpt-5.2-codex");

      expect(rank53).toBeLessThan(rank52);
      expect(rank52).toBeLessThan(rank52Codex);
    });

    test("uses model-first when model and agent priorities conflict", () => {
      const selected = pickAutoRoleCandidate("fixer", [
        {
          agent: "claude",
          model: "sonnet",
          modelOrder: 0,
          probeOrder: 0,
        },
        {
          agent: "codex",
          model: "gpt-5.3-codex",
          modelOrder: 0,
          probeOrder: 0,
        },
      ]);

      expect(selected).not.toBeNull();
      expect(selected?.agent).toBe("codex");
      expect(selected?.model).toBe("gpt-5.3-codex");
    });

    test("breaks model-rank ties using role agent priority", () => {
      const selected = pickAutoRoleCandidate("reviewer", [
        {
          agent: "claude",
          model: "claude-opus-4-6",
          modelOrder: 0,
          probeOrder: 0,
        },
        {
          agent: "droid",
          model: "claude-opus-4-6",
          modelOrder: 1,
          probeOrder: 0,
        },
      ]);

      expect(selected).not.toBeNull();
      expect(selected?.agent).toBe("droid");
    });

    test("uses first successful probe order for others tie", () => {
      const selected = pickAutoRoleCandidate("reviewer", [
        {
          agent: "pi",
          model: "custom-model-a",
          provider: "anthropic",
          modelOrder: 0,
          probeOrder: 2,
        },
        {
          agent: "opencode",
          model: "custom-model-b",
          modelOrder: 0,
          probeOrder: 1,
        },
      ]);

      expect(selected).not.toBeNull();
      expect(selected?.agent).toBe("opencode");
    });

    test("falls back to first available model for selected agent when no priority model exists", () => {
      const selected = pickAutoRoleCandidate("reviewer", [
        {
          agent: "codex",
          model: "unknown-model-a",
          modelOrder: 0,
          probeOrder: 0,
        },
        {
          agent: "codex",
          model: "unknown-model-b",
          modelOrder: 1,
          probeOrder: 0,
        },
        {
          agent: "claude",
          model: "another-unknown",
          modelOrder: 0,
          probeOrder: 0,
        },
      ]);

      expect(selected).not.toBeNull();
      expect(selected?.agent).toBe("codex");
      expect(selected?.model).toBe("unknown-model-a");
    });

    test("defaults reasoning to high when supported", () => {
      expect(selectAutoReasoning("codex", "gpt-5.3-codex")).toBe("high");
    });

    test("returns undefined reasoning when unsupported", () => {
      expect(selectAutoReasoning("gemini", "gemini-3-pro-preview")).toBeUndefined();
    });
  });

  describe("auto model discovery", () => {
    test("skips dynamic agent when model discovery fails", async () => {
      const availability = {
        codex: false,
        claude: false,
        droid: false,
        gemini: false,
        opencode: true,
        pi: true,
      } satisfies Record<AgentType, boolean>;

      const result = await discoverAutoModelCandidates(availability, {
        fetchOpencodeModels: async () => {
          throw new Error("failed");
        },
        fetchPiModels: async () => [{ provider: "anthropic", model: "claude-opus-4-6" }],
      });

      expect(result.skippedAgents).toContain("opencode");
      expect(result.candidates.some((entry) => entry.agent === "pi")).toBe(true);
    });

    test("builds auto init input with defaults and explicit simplifier", async () => {
      const availability = {
        codex: true,
        claude: false,
        droid: false,
        gemini: false,
        opencode: false,
        pi: false,
      } satisfies Record<AgentType, boolean>;

      const result = await buildAutoInitInput(availability);

      expect(result.input.reviewerAgent).toBe("codex");
      expect(result.input.fixerAgent).toBe("codex");
      expect(result.input.simplifierAgent).toBe("codex");
      expect(result.input.defaultReviewType).toBe("uncommitted");
      expect(result.input.maxIterations).toBeGreaterThan(0);
      expect(result.input.iterationTimeoutMinutes).toBeGreaterThan(0);
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
