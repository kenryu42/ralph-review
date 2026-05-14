import { afterEach, describe, expect, test } from "bun:test";
import {
  getCodexReasoningOptions,
  getDroidReasoningOptions,
  getReasoningOptions,
  registerCodexReasoningOptions,
  registerDroidReasoningOptions,
  resetRegisteredReasoningOptions,
  supportsReasoning,
} from "@/lib/agents/models";

afterEach(() => {
  resetRegisteredReasoningOptions();
});

describe("agent model metadata", () => {
  describe("getReasoningOptions", () => {
    test("returns registered codex options and shared options for opencode and pi", () => {
      registerCodexReasoningOptions({
        "gpt-5.4": ["low", "medium", "high", "xhigh"],
      });

      expect(getReasoningOptions("codex", "gpt-5.4")).toEqual(["low", "medium", "high", "xhigh"]);
      expect(getReasoningOptions("codex", "unknown-model")).toEqual([]);
      expect(getReasoningOptions("opencode", "any-model")).toEqual([
        "low",
        "medium",
        "high",
        "xhigh",
      ]);
      expect(getReasoningOptions("pi", "any-model")).toEqual(["low", "medium", "high", "xhigh"]);
    });

    test("returns registered options for droid", () => {
      registerDroidReasoningOptions({
        "gpt-5.4": ["low", "medium", "high", "xhigh"],
      });

      expect(getReasoningOptions("droid", "gpt-5.4")).toEqual(["low", "medium", "high", "xhigh"]);
      expect(getReasoningOptions("droid", "gpt-5.1")).toEqual([]);
      expect(getReasoningOptions("droid", "glm-4.7")).toEqual([]);
      expect(getReasoningOptions("droid", "unknown-model")).toEqual([]);
    });

    test("returns effort levels for claude", () => {
      expect(getReasoningOptions("claude", "claude-sonnet-4-6")).toEqual(["low", "medium", "high"]);
    });

    test("returns no options for gemini", () => {
      expect(getReasoningOptions("gemini", "gemini-3.1-pro-preview")).toEqual([]);
    });

    test("never includes banned levels", () => {
      registerDroidReasoningOptions({
        "gemini-3-flash-preview": ["low", "medium", "high"],
      });

      const droidLevels = getReasoningOptions("droid", "gemini-3-flash-preview");
      expect(droidLevels).not.toContain("off");
      expect(droidLevels).not.toContain("none");
      expect(droidLevels).not.toContain("minimal");
    });
  });

  describe("supportsReasoning", () => {
    test("returns true when options exist", () => {
      registerCodexReasoningOptions({
        "gpt-5.4-mini": ["medium"],
      });

      expect(supportsReasoning("codex", "gpt-5.4-mini")).toBe(true);
      expect(supportsReasoning("droid", "gpt-5.1")).toBe(false);
      expect(supportsReasoning("pi", "model")).toBe(true);
      expect(supportsReasoning("claude", "claude-sonnet-4-6")).toBe(true);
    });

    test("returns false for unsupported selections", () => {
      expect(supportsReasoning("droid", "glm-4.7")).toBe(false);
      expect(supportsReasoning("gemini", "gemini-3.1-pro-preview")).toBe(false);
      expect(supportsReasoning("codex", "unknown-model")).toBe(false);
    });
  });

  describe("getCodexReasoningOptions", () => {
    test("uses reasoning levels parsed from codex debug models", () => {
      registerCodexReasoningOptions({
        "new-codex-model": ["low", "high"],
      });

      expect(getCodexReasoningOptions("new-codex-model")).toEqual(["low", "high"]);
    });

    test("returns empty array for unknown codex models", () => {
      expect(getCodexReasoningOptions("missing-codex-model")).toEqual([]);
    });
  });

  describe("getDroidReasoningOptions", () => {
    test("uses reasoning levels parsed from droid help", () => {
      registerDroidReasoningOptions({
        "new-droid-model": ["low", "medium", "high"],
      });

      expect(getDroidReasoningOptions("new-droid-model")).toEqual(["low", "medium", "high"]);
    });

    test("does not use hardcoded fallback levels", () => {
      const levels = getDroidReasoningOptions("gpt-5.1");
      expect(levels).toEqual([]);
    });

    test("returns empty array for unsupported droid models", () => {
      expect(getDroidReasoningOptions("kimi-k2.5")).toEqual([]);
    });
  });
});
