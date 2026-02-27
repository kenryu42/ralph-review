import { describe, expect, test } from "bun:test";
import {
  droidModelOptions,
  getDroidReasoningOptions,
  getReasoningOptions,
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
    test("includes xhigh for models that support it", () => {
      const levels = getDroidReasoningOptions("gpt-5.1-codex-max");
      expect(levels).toContain("xhigh");
    });

    test("returns empty array for unsupported droid models", () => {
      expect(getDroidReasoningOptions("kimi-k2.5")).toEqual([]);
    });
  });

  describe("droid model catalog", () => {
    test("matches the expected static droid model list", () => {
      expect(droidModelOptions).toEqual([
        { value: "claude-opus-4-5-20251101", label: "Claude Opus 4.5" },
        { value: "claude-opus-4-6", label: "Claude Opus 4.6 (default)" },
        { value: "claude-opus-4-6-fast", label: "Claude Opus 4.6 Fast Mode" },
        { value: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
        { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
        { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
        { value: "gpt-5.1", label: "GPT-5.1" },
        { value: "gpt-5.1-codex", label: "GPT-5.1-Codex" },
        { value: "gpt-5.1-codex-max", label: "GPT-5.1-Codex-Max" },
        { value: "gpt-5.2", label: "GPT-5.2" },
        { value: "gpt-5.2-codex", label: "GPT-5.2-Codex" },
        { value: "gpt-5.3-codex", label: "GPT-5.3-Codex" },
        { value: "gemini-3-pro-preview", label: "Gemini 3 Pro" },
        { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
        { value: "gemini-3-flash-preview", label: "Gemini 3 Flash" },
        { value: "glm-4.7", label: "Droid Core (GLM-4.7)" },
        { value: "glm-5", label: "Droid Core (GLM-5)" },
        { value: "kimi-k2.5", label: "Droid Core (Kimi K2.5)" },
        { value: "minimax-m2.5", label: "Droid Core (MiniMax M2.5)" },
      ]);
    });
  });
});
