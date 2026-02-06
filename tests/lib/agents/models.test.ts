import { describe, expect, test } from "bun:test";
import { getDroidThinkingOptions, getThinkingOptions, supportsThinking } from "@/lib/agents/models";

describe("agent model metadata", () => {
  describe("getThinkingOptions", () => {
    test("returns shared options for codex, opencode, and pi", () => {
      expect(getThinkingOptions("codex", "gpt-5.2-codex")).toEqual([
        "low",
        "medium",
        "high",
        "xhigh",
      ]);
      expect(getThinkingOptions("opencode", "any-model")).toEqual([
        "low",
        "medium",
        "high",
        "xhigh",
      ]);
      expect(getThinkingOptions("pi", "any-model")).toEqual(["low", "medium", "high", "xhigh"]);
    });

    test("returns model-specific options for droid", () => {
      expect(getThinkingOptions("droid", "gpt-5.1")).toEqual(["low", "medium", "high"]);
      expect(getThinkingOptions("droid", "gpt-5.1-codex-max")).toEqual([
        "low",
        "medium",
        "high",
        "xhigh",
      ]);
      expect(getThinkingOptions("droid", "glm-4.7")).toEqual([]);
      expect(getThinkingOptions("droid", "unknown-model")).toEqual([]);
    });

    test("returns no options for claude and gemini", () => {
      expect(getThinkingOptions("claude", "sonnet")).toEqual([]);
      expect(getThinkingOptions("gemini", "gemini-3-pro-preview")).toEqual([]);
    });

    test("never includes banned levels", () => {
      const droidLevels = getThinkingOptions("droid", "gemini-3-flash-preview");
      expect(droidLevels).not.toContain("off");
      expect(droidLevels).not.toContain("none");
      expect(droidLevels).not.toContain("minimal");
    });
  });

  describe("supportsThinking", () => {
    test("returns true when options exist", () => {
      expect(supportsThinking("codex", "gpt-5.2-codex")).toBe(true);
      expect(supportsThinking("droid", "gpt-5.2-codex")).toBe(true);
      expect(supportsThinking("pi", "model")).toBe(true);
    });

    test("returns false for unsupported selections", () => {
      expect(supportsThinking("droid", "glm-4.7")).toBe(false);
      expect(supportsThinking("claude", "opus")).toBe(false);
      expect(supportsThinking("gemini", "gemini-3-pro-preview")).toBe(false);
    });
  });

  describe("getDroidThinkingOptions", () => {
    test("includes xhigh for models that support it", () => {
      const levels = getDroidThinkingOptions("gpt-5.1-codex-max");
      expect(levels).toContain("xhigh");
    });

    test("returns empty array for unsupported droid models", () => {
      expect(getDroidThinkingOptions("kimi-k2.5")).toEqual([]);
    });
  });
});
