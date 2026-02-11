import { describe, expect, test } from "bun:test";
import { resolveAgentSettings } from "@/lib/agents/runner";
import type { AgentSettings, Config } from "@/lib/types";

const baseConfig: Config = {
  reviewer: { agent: "codex", model: "gpt-5.2-codex", reasoning: "high" },
  fixer: { agent: "claude", model: "claude-sonnet-4-5", reasoning: "medium" },
  maxIterations: 5,
  iterationTimeout: 1800000,
  defaultReview: { type: "uncommitted" },
};

describe("resolveAgentSettings", () => {
  test("returns reviewer settings for reviewer role", () => {
    expect(resolveAgentSettings("reviewer", baseConfig)).toEqual(baseConfig.reviewer);
  });

  test("returns fixer settings for fixer role", () => {
    expect(resolveAgentSettings("fixer", baseConfig)).toEqual(baseConfig.fixer);
  });

  test("falls back to reviewer settings for simplifier when custom config is missing", () => {
    expect(resolveAgentSettings("code-simplifier", baseConfig)).toEqual(baseConfig.reviewer);
  });

  test("uses custom simplifier settings when configured", () => {
    const customSimplifier: AgentSettings = {
      agent: "droid",
      model: "gpt-5.2-codex",
      reasoning: "xhigh",
    };
    const configWithSimplifier: Config = {
      ...baseConfig,
      "code-simplifier": customSimplifier,
    };

    expect(resolveAgentSettings("code-simplifier", configWithSimplifier)).toEqual(customSimplifier);
  });
});
