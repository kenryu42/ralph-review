import { describe, expect, test } from "bun:test";
import {
  codexModelOptions,
  getDroidReasoningOptions,
  getReasoningOptions,
  registerDroidReasoningOptions,
  supportsReasoning,
} from "@/lib/agents/models";

describe("agent model metadata", () => {
  describe("getReasoningOptions", () => {
    test("returns shared options for codex, opencode, and pi", () => {
      expect(getReasoningOptions("codex", "gpt-5.2-codex")).toEqual([
        "low",
        "medium",
        "high",
        "xhigh",
      ]);
      expect(getReasoningOptions("opencode", "any-model")).toEqual([
        "low",
        "medium",
        "high",
        "xhigh",
      ]);
      expect(getReasoningOptions("pi", "any-model")).toEqual(["low", "medium", "high", "xhigh"]);
    });

    test("returns model-specific options for droid", () => {
      expect(getReasoningOptions("droid", "gpt-5.1")).toEqual(["low", "medium", "high"]);
      expect(getReasoningOptions("droid", "gpt-5.1-codex-max")).toEqual([
        "low",
        "medium",
        "high",
        "xhigh",
      ]);
      expect(getReasoningOptions("droid", "glm-4.7")).toEqual([]);
      expect(getReasoningOptions("droid", "unknown-model")).toEqual([]);
    });

    test("returns effort levels for claude", () => {
      expect(getReasoningOptions("claude", "sonnet")).toEqual(["low", "medium", "high"]);
    });

    test("returns no options for gemini", () => {
      expect(getReasoningOptions("gemini", "gemini-3-pro-preview")).toEqual([]);
    });

    test("never includes banned levels", () => {
      const droidLevels = getReasoningOptions("droid", "gemini-3-flash-preview");
      expect(droidLevels).not.toContain("off");
      expect(droidLevels).not.toContain("none");
      expect(droidLevels).not.toContain("minimal");
    });
  });

  describe("supportsReasoning", () => {
    test("returns true when options exist", () => {
      expect(supportsReasoning("codex", "gpt-5.2-codex")).toBe(true);
      expect(supportsReasoning("droid", "gpt-5.2-codex")).toBe(true);
      expect(supportsReasoning("pi", "model")).toBe(true);
      expect(supportsReasoning("claude", "sonnet")).toBe(true);
    });

    test("returns false for unsupported selections", () => {
      expect(supportsReasoning("droid", "glm-4.7")).toBe(false);
      expect(supportsReasoning("gemini", "gemini-3-pro-preview")).toBe(false);
    });
  });

  describe("getDroidReasoningOptions", () => {
    test("uses reasoning levels parsed from droid help", () => {
      registerDroidReasoningOptions({
        "new-droid-model": ["low", "medium", "high"],
      });

      expect(getDroidReasoningOptions("new-droid-model")).toEqual(["low", "medium", "high"]);
    });

    test("includes xhigh for models that support it", () => {
      const levels = getDroidReasoningOptions("gpt-5.1-codex-max");
      expect(levels).toContain("xhigh");
    });

    test("returns empty array for unsupported droid models", () => {
      expect(getDroidReasoningOptions("kimi-k2.5")).toEqual([]);
    });
  });

  describe("codex model catalog", () => {
    test("includes gpt-5.4 in the static codex model list", () => {
      expect(codexModelOptions).toContainEqual({ value: "gpt-5.4", label: "GPT-5.4" });
    });
  });
});
