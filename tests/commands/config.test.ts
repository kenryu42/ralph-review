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
  run: { simplifier: false },
  maxIterations: 5,
  iterationTimeout: 1800000,
  defaultReview: { type: "uncommitted" },
  notifications: { sound: { enabled: false } },
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
      expect(parseConfigKey("run.simplifier")).toBe("run.simplifier");
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

    test("parses boolean notification values", () => {
      expect(parseConfigValue("notifications.sound.enabled", "true")).toBe(true);
      expect(parseConfigValue("notifications.sound.enabled", "false")).toBe(false);
    });

    test("parses boolean run simplifier values", () => {
      expect(parseConfigValue("run.simplifier", "true")).toBe(true);
      expect(parseConfigValue("run.simplifier", "false")).toBe(false);
    });

    test("rejects invalid notification boolean values", () => {
      expect(() => parseConfigValue("notifications.sound.enabled", "yes")).toThrow(
        'must be "true" or "false"'
      );
    });

    test("rejects invalid run simplifier values", () => {
      expect(() => parseConfigValue("run.simplifier", "yes")).toThrow('must be "true" or "false"');
    });
  });

  describe("getConfigValue", () => {
    test("returns scalar values", () => {
      expect(getConfigValue(baseConfig, "reviewer.agent")).toBe("codex");
    });

    test("returns undefined for unset values", () => {
      expect(getConfigValue(baseConfig, "retry.baseDelayMs")).toBeUndefined();
    });

    test("returns notification sound enabled value", () => {
      expect(getConfigValue(baseConfig, "notifications.sound.enabled")).toBe(false);
    });

    test("returns run simplifier value", () => {
      expect(getConfigValue(baseConfig, "run.simplifier")).toBe(false);
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

    test("sets notification sound enabled", () => {
      const updated = setConfigValue(baseConfig, "notifications.sound.enabled", true);
      expect(updated.notifications.sound.enabled).toBe(true);
    });

    test("sets run simplifier enabled", () => {
      const updated = setConfigValue(baseConfig, "run.simplifier", true);
      expect(updated.run?.simplifier).toBe(true);
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

    test("rejects invalid run settings", () => {
      const candidate = {
        ...baseConfig,
        run: { simplifier: "yes" },
      } as unknown as Config;
      const errors = validateConfigInvariants(candidate);
      expect(errors.some((error) => error.includes("run.simplifier"))).toBe(true);
    });
  });
});
