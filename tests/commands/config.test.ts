import { describe, expect, test } from "bun:test";
import {
  getConfigValue,
  parseConfigKey,
  parseConfigSubcommand,
  parseConfigValue,
  setConfigValue,
  validateConfigInvariants,
} from "@/commands/config";
import { parseConfig } from "@/lib/config";
import { CONFIG_SCHEMA_URI, CONFIG_VERSION, type Config } from "@/lib/types";

const baseConfig: Config = {
  $schema: CONFIG_SCHEMA_URI,
  version: CONFIG_VERSION,
  reviewer: { agent: "codex", model: "gpt-5.3-codex", reasoning: "high" },
  fixer: { agent: "claude", model: "claude-opus-4-6", reasoning: "medium" },
  "code-simplifier": { agent: "droid", model: "gpt-5.2-codex", reasoning: "low" },
  maxIterations: 5,
  iterationTimeout: 1800000,
  defaultReview: { type: "uncommitted" },
};

describe("config command helpers", () => {
  describe("parseConfigSubcommand", () => {
    test("accepts supported subcommands", () => {
      expect(parseConfigSubcommand("show")).toBe("show");
      expect(parseConfigSubcommand("get")).toBe("get");
      expect(parseConfigSubcommand("set")).toBe("set");
      expect(parseConfigSubcommand("edit")).toBe("edit");
    });

    test("rejects unknown subcommand", () => {
      expect(() => parseConfigSubcommand("wizard")).toThrow("Unknown config subcommand");
    });
  });

  describe("parseConfigKey", () => {
    test("accepts a supported key", () => {
      expect(parseConfigKey("reviewer.agent")).toBe("reviewer.agent");
    });

    test("rejects unknown key", () => {
      expect(() => parseConfigKey("reviewer.unknown")).toThrow("Unknown config key");
    });
  });

  describe("parseConfigValue", () => {
    test("parses positive integers", () => {
      expect(parseConfigValue("maxIterations", "8")).toBe(8);
    });

    test("rejects negative iteration timeout", () => {
      expect(() => parseConfigValue("iterationTimeout", "-1")).toThrow("greater than 0");
    });

    test("parses nullable model values", () => {
      expect(parseConfigValue("fixer.model", "null")).toBeNull();
    });

    test("rejects invalid reasoning values", () => {
      expect(() => parseConfigValue("reviewer.reasoning", "ultra")).toThrow("must be one of");
    });
  });

  describe("getConfigValue", () => {
    test("returns scalar values", () => {
      expect(getConfigValue(baseConfig, "reviewer.agent")).toBe("codex");
    });

    test("returns undefined for unset values", () => {
      expect(getConfigValue(baseConfig, "retry.baseDelayMs")).toBeUndefined();
    });
  });

  describe("setConfigValue", () => {
    test("sets maxIterations", () => {
      const updated = setConfigValue(baseConfig, "maxIterations", 8);
      expect(updated.maxIterations).toBe(8);
    });

    test("sets reasoning value", () => {
      const updated = setConfigValue(baseConfig, "reviewer.reasoning", "high");
      expect(updated.reviewer.reasoning).toBe("high");
    });

    test("rejects non-pi to pi agent transition", () => {
      expect(() => setConfigValue(baseConfig, "reviewer.agent", "pi")).toThrow("single-key update");
    });

    test("removes provider when changing from pi to non-pi", () => {
      const piConfig: Config = {
        ...baseConfig,
        reviewer: {
          agent: "pi",
          provider: "anthropic",
          model: "claude-sonnet-4-5",
          reasoning: "high",
        },
      };

      const updated = setConfigValue(piConfig, "reviewer.agent", "codex");
      expect(updated.reviewer.agent).toBe("codex");
      expect("provider" in updated.reviewer).toBe(false);
    });

    test("rejects setting provider for non-pi role", () => {
      expect(() => setConfigValue(baseConfig, "reviewer.provider", "anthropic")).toThrow(
        "only valid"
      );
    });

    test("unsets fixer model when null is provided", () => {
      const updated = setConfigValue(baseConfig, "fixer.model", null);
      expect(updated.fixer.model).toBeUndefined();
    });

    test("updates retry config even when retry is initially missing", () => {
      const updated = setConfigValue(baseConfig, "retry.baseDelayMs", 1000);
      expect(updated.retry?.baseDelayMs).toBe(1000);
      expect(updated.retry?.maxRetries).toBeDefined();
      expect(updated.retry?.maxDelayMs).toBeDefined();
    });
  });

  describe("validateConfigInvariants", () => {
    test("rejects base review without branch", () => {
      const candidate: Config = {
        ...baseConfig,
        defaultReview: { type: "base", branch: "" },
      };

      const errors = validateConfigInvariants(candidate);
      expect(errors.some((error) => error.includes("defaultReview.branch"))).toBe(true);
    });

    test("passes valid base review after branch then type update", () => {
      const withBranch = setConfigValue(baseConfig, "defaultReview.branch", "main");
      const withType = setConfigValue(withBranch, "defaultReview.type", "base");
      const errors = validateConfigInvariants(withType);
      expect(errors).toEqual([]);

      const parsed = parseConfig(withType);
      expect(parsed).not.toBeNull();
      expect(parsed?.defaultReview).toEqual({ type: "base", branch: "main" });
    });
  });
});
