import { describe, expect, test } from "bun:test";
import {
  type ConfigCommandDeps,
  createRunConfig,
  getConfigValue,
  parseConfigKey,
  parseConfigSubcommand,
  parseConfigValue,
  setConfigValue,
  validateConfigInvariants,
} from "@/commands/config";
import { parseConfig } from "@/lib/config";
import { CONFIG_SCHEMA_URI, CONFIG_VERSION, type Config, DEFAULT_RETRY_CONFIG } from "@/lib/types";

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

function createBaseConfig(): Config {
  return structuredClone(baseConfig) as Config;
}

type CommandHarness = {
  deps: ConfigCommandDeps;
  printed: string[];
  successes: string[];
  warnings: string[];
  errors: string[];
  exits: number[];
  saved: Config[];
  spawnCalls: Array<{
    command: string[];
    options: Parameters<ConfigCommandDeps["spawn"]>[1];
  }>;
};

function createCommandHarness(overrides?: Partial<ConfigCommandDeps>): CommandHarness {
  const printed: string[] = [];
  const successes: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const exits: number[] = [];
  const saved: Config[] = [];
  const spawnCalls: Array<{
    command: string[];
    options: Parameters<ConfigCommandDeps["spawn"]>[1];
  }> = [];

  const defaults: ConfigCommandDeps = {
    configPath: "/tmp/ralph-test-config.json",
    configExists: async () => true,
    ensureConfigDir: async () => {},
    loadConfig: async () => createBaseConfig(),
    parseConfig: (value) => parseConfig(value),
    saveConfig: async (config) => {
      saved.push(config);
    },
    spawn: ((command, options) => {
      spawnCalls.push({ command, options });
      return { exited: Promise.resolve(0) };
    }) as ConfigCommandDeps["spawn"],
    env: {
      EDITOR: "vim",
      SHELL: "/bin/zsh",
    },
    print: (value) => {
      printed.push(value);
    },
    log: {
      success: (message) => {
        successes.push(message);
      },
      warn: (message) => {
        warnings.push(message);
      },
      error: (message) => {
        errors.push(message);
      },
    },
    exit: (code) => {
      exits.push(code);
    },
  };

  const deps: ConfigCommandDeps = {
    ...defaults,
    ...overrides,
    env: {
      ...defaults.env,
      ...overrides?.env,
    },
    log: {
      ...defaults.log,
      ...overrides?.log,
    },
  };

  return {
    deps,
    printed,
    successes,
    warnings,
    errors,
    exits,
    saved,
    spawnCalls,
  };
}

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
    test("accepts supported keys", () => {
      expect(parseConfigKey("reviewer.agent")).toBe("reviewer.agent");
      expect(parseConfigKey("run.simplifier")).toBe("run.simplifier");
      expect(parseConfigKey("notifications.sound.enabled")).toBe("notifications.sound.enabled");
    });

    test("rejects unknown key", () => {
      expect(() => parseConfigKey("reviewer.unknown")).toThrow("Unknown config key");
    });
  });

  describe("parseConfigValue", () => {
    test("parses role-level raw strings by default", () => {
      expect(parseConfigValue("reviewer.model", "gpt-5.2-codex")).toBe("gpt-5.2-codex");
    });

    test("rejects null for non-nullable keys", () => {
      expect(() => parseConfigValue("maxIterations", "null")).toThrow(
        'Value "null" is not allowed'
      );
    });

    test("parses positive integers", () => {
      expect(parseConfigValue("maxIterations", "8")).toBe(8);
      expect(parseConfigValue("iterationTimeout", "3600000")).toBe(3600000);
    });

    test("rejects non-integer values", () => {
      expect(() => parseConfigValue("maxIterations", "abc")).toThrow("must be an integer");
    });

    test("rejects numeric values outside allowed range", () => {
      expect(() => parseConfigValue("iterationTimeout", "-1")).toThrow("greater than 0");
      expect(() => parseConfigValue("retry.maxRetries", "-1")).toThrow(
        "greater than or equal to 0"
      );
      expect(() => parseConfigValue("retry.baseDelayMs", "0")).toThrow("greater than 0");
      expect(() => parseConfigValue("retry.maxDelayMs", "0")).toThrow("greater than 0");
    });

    test("parses nullable values", () => {
      expect(parseConfigValue("fixer.model", "null")).toBeNull();
      expect(parseConfigValue("defaultReview.branch", "null")).toBeNull();
    });

    test("rejects invalid agent values", () => {
      expect(() => parseConfigValue("reviewer.agent", "wizard")).toThrow("must be a valid agent");
    });

    test("rejects invalid reasoning values", () => {
      expect(() => parseConfigValue("reviewer.reasoning", "ultra")).toThrow("must be one of");
    });

    test("parses and validates default review type", () => {
      expect(parseConfigValue("defaultReview.type", "base")).toBe("base");
      expect(parseConfigValue("defaultReview.type", "uncommitted")).toBe("uncommitted");
      expect(() => parseConfigValue("defaultReview.type", "head")).toThrow(
        'must be "uncommitted" or "base"'
      );
    });

    test("validates default review branch", () => {
      expect(parseConfigValue("defaultReview.branch", "main")).toBe("main");
      expect(() => parseConfigValue("defaultReview.branch", "   ")).toThrow("non-empty branch");
    });

    test("parses boolean notification and simplifier values", () => {
      expect(parseConfigValue("notifications.sound.enabled", "true")).toBe(true);
      expect(parseConfigValue("notifications.sound.enabled", "false")).toBe(false);
      expect(parseConfigValue("run.simplifier", "true")).toBe(true);
      expect(parseConfigValue("run.simplifier", "false")).toBe(false);
    });

    test("rejects invalid boolean strings", () => {
      expect(() => parseConfigValue("notifications.sound.enabled", "yes")).toThrow(
        'must be "true" or "false"'
      );
      expect(() => parseConfigValue("run.simplifier", "yes")).toThrow('must be "true" or "false"');
    });
  });

  describe("getConfigValue", () => {
    test("returns scalar values", () => {
      expect(getConfigValue(createBaseConfig(), "reviewer.agent")).toBe("codex");
      expect(getConfigValue(createBaseConfig(), "fixer.model")).toBe("claude-opus-4-6");
      expect(getConfigValue(createBaseConfig(), "maxIterations")).toBe(5);
      expect(getConfigValue(createBaseConfig(), "iterationTimeout")).toBe(1800000);
      expect(getConfigValue(createBaseConfig(), "defaultReview.type")).toBe("uncommitted");
      expect(getConfigValue(createBaseConfig(), "run.simplifier")).toBe(false);
      expect(getConfigValue(createBaseConfig(), "notifications.sound.enabled")).toBe(false);
    });

    test("returns undefined for unset values", () => {
      expect(getConfigValue(createBaseConfig(), "retry.baseDelayMs")).toBeUndefined();
      expect(getConfigValue(createBaseConfig(), "defaultReview.branch")).toBeUndefined();
      expect(getConfigValue(createBaseConfig(), "reviewer.provider")).toBeUndefined();
    });

    test("returns pi-only provider values for pi roles", () => {
      const config = createBaseConfig();
      config.reviewer = {
        agent: "pi",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
      };
      config.fixer = {
        agent: "pi",
        provider: "llm-proxy",
        model: "gemini_cli/gemini-3-flash-preview",
      };
      config["code-simplifier"] = {
        agent: "pi",
        provider: "anthropic",
        model: "claude-opus-4-6",
      };
      config.defaultReview = { type: "base", branch: "main" };
      config.retry = { ...DEFAULT_RETRY_CONFIG, maxRetries: 9 };

      expect(getConfigValue(config, "reviewer.provider")).toBe("anthropic");
      expect(getConfigValue(config, "fixer.provider")).toBe("llm-proxy");
      expect(getConfigValue(config, "code-simplifier.provider")).toBe("anthropic");
      expect(getConfigValue(config, "defaultReview.branch")).toBe("main");
      expect(getConfigValue(config, "retry.maxRetries")).toBe(9);
      expect(getConfigValue(config, "retry.baseDelayMs")).toBe(DEFAULT_RETRY_CONFIG.baseDelayMs);
      expect(getConfigValue(config, "retry.maxDelayMs")).toBe(DEFAULT_RETRY_CONFIG.maxDelayMs);
    });
  });

  describe("setConfigValue", () => {
    test("sets maxIterations", () => {
      const updated = setConfigValue(createBaseConfig(), "maxIterations", 8);
      expect(updated.maxIterations).toBe(8);
    });

    test("rejects invalid agent value types", () => {
      expect(() => setConfigValue(createBaseConfig(), "reviewer.agent", true)).toThrow(
        "must be a valid agent"
      );
    });

    test("rejects non-pi to pi agent transition", () => {
      expect(() => setConfigValue(createBaseConfig(), "reviewer.agent", "pi")).toThrow(
        "single-key update"
      );
    });

    test("keeps pi agent settings when updating pi to pi", () => {
      const config = createBaseConfig();
      config.reviewer = {
        agent: "pi",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        reasoning: "high",
      };

      const updated = setConfigValue(config, "reviewer.agent", "pi");
      expect(updated.reviewer).toEqual({
        agent: "pi",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        reasoning: "high",
      });
    });

    test("removes provider when changing from pi to non-pi", () => {
      const config = createBaseConfig();
      config.reviewer = {
        agent: "pi",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        reasoning: "high",
      };

      const updated = setConfigValue(config, "reviewer.agent", "codex");
      expect(updated.reviewer.agent).toBe("codex");
      expect(updated.reviewer.model).toBe("claude-sonnet-4-5");
      expect(updated.reviewer.reasoning).toBe("high");
      expect("provider" in updated.reviewer).toBe(false);
    });

    test("creates code-simplifier when setting simplifier agent", () => {
      const config = createBaseConfig();
      delete config["code-simplifier"];

      const updated = setConfigValue(config, "code-simplifier.agent", "claude");
      expect(updated["code-simplifier"]).toEqual({ agent: "claude" });
    });

    test("rejects setting non-agent field when code-simplifier is not configured", () => {
      const config = createBaseConfig();
      delete config["code-simplifier"];

      expect(() => setConfigValue(config, "code-simplifier.model", "gpt-5.2-codex")).toThrow(
        'Role "code-simplifier" is not configured'
      );
    });

    test("rejects setting simplifier agent to pi when simplifier is absent", () => {
      const config = createBaseConfig();
      delete config["code-simplifier"];

      expect(() => setConfigValue(config, "code-simplifier.agent", "pi")).toThrow(
        "single-key update"
      );
    });

    test("handles provider updates for pi and non-pi roles", () => {
      const nonPi = setConfigValue(createBaseConfig(), "reviewer.provider", null);
      expect("provider" in nonPi.reviewer).toBe(false);

      const config = createBaseConfig();
      config.reviewer = {
        agent: "pi",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
      };
      const updated = setConfigValue(config, "reviewer.provider", "llm-proxy");
      expect(updated.reviewer.agent).toBe("pi");
      if (updated.reviewer.agent === "pi") {
        expect(updated.reviewer.provider).toBe("llm-proxy");
      }
    });

    test("validates provider transitions", () => {
      expect(() => setConfigValue(createBaseConfig(), "reviewer.provider", "anthropic")).toThrow(
        "only valid"
      );
      expect(() => setConfigValue(createBaseConfig(), "reviewer.provider", true)).toThrow(
        "string or null"
      );

      const config = createBaseConfig();
      config.reviewer = {
        agent: "pi",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
      };
      expect(() => setConfigValue(config, "reviewer.provider", null)).toThrow("Cannot unset");
    });

    test("handles model updates for pi and non-pi roles", () => {
      const nonPiDeleted = setConfigValue(createBaseConfig(), "fixer.model", null);
      expect(nonPiDeleted.fixer.model).toBeUndefined();

      const nonPiUpdated = setConfigValue(createBaseConfig(), "fixer.model", "claude-opus-4-6");
      expect(nonPiUpdated.fixer.model).toBe("claude-opus-4-6");

      const piConfig = createBaseConfig();
      piConfig.fixer = {
        agent: "pi",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
      };

      const piUpdated = setConfigValue(piConfig, "fixer.model", "claude-opus-4-6");
      expect(piUpdated.fixer.agent).toBe("pi");
      if (piUpdated.fixer.agent === "pi") {
        expect(piUpdated.fixer.model).toBe("claude-opus-4-6");
      }
    });

    test("validates model updates", () => {
      expect(() => setConfigValue(createBaseConfig(), "fixer.model", true)).toThrow(
        "string or null"
      );

      const piConfig = createBaseConfig();
      piConfig.fixer = {
        agent: "pi",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
      };
      expect(() => setConfigValue(piConfig, "fixer.model", null)).toThrow("Cannot unset");
      expect(() => setConfigValue(piConfig, "fixer.model", true)).toThrow("Cannot unset");
    });

    test("handles reasoning updates for pi and non-pi roles", () => {
      const nonPiDeleted = setConfigValue(createBaseConfig(), "reviewer.reasoning", null);
      expect(nonPiDeleted.reviewer.reasoning).toBeUndefined();

      const nonPiUpdated = setConfigValue(createBaseConfig(), "reviewer.reasoning", "max");
      expect(nonPiUpdated.reviewer.reasoning).toBe("max");

      const piConfig = createBaseConfig();
      piConfig.reviewer = {
        agent: "pi",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        reasoning: "high",
      };

      const piDeleted = setConfigValue(piConfig, "reviewer.reasoning", null);
      expect(piDeleted.reviewer.agent).toBe("pi");
      if (piDeleted.reviewer.agent === "pi") {
        expect(piDeleted.reviewer.reasoning).toBeUndefined();
      }

      const piUpdated = setConfigValue(piConfig, "reviewer.reasoning", "medium");
      expect(piUpdated.reviewer.agent).toBe("pi");
      if (piUpdated.reviewer.agent === "pi") {
        expect(piUpdated.reviewer.reasoning).toBe("medium");
      }
    });

    test("validates reasoning updates", () => {
      expect(() => setConfigValue(createBaseConfig(), "reviewer.reasoning", "ultra")).toThrow(
        "must be one of"
      );
      expect(() => setConfigValue(createBaseConfig(), "reviewer.reasoning", true)).toThrow(
        "must be one of"
      );
    });

    test("handles default review type and branch transitions", () => {
      const withBranch = setConfigValue(createBaseConfig(), "defaultReview.branch", "main");
      expect(withBranch.defaultReview).toEqual({ type: "base", branch: "main" });

      const toBase = setConfigValue(createBaseConfig(), "defaultReview.type", "base");
      expect(toBase.defaultReview).toEqual({ type: "base", branch: "" });

      const toUncommitted = setConfigValue(withBranch, "defaultReview.type", "uncommitted");
      expect(toUncommitted.defaultReview).toEqual({ type: "uncommitted" });

      const clearedBranch = setConfigValue(withBranch, "defaultReview.branch", null);
      expect(clearedBranch.defaultReview).toEqual({ type: "base", branch: "" });
    });

    test("validates default review values", () => {
      expect(() => setConfigValue(createBaseConfig(), "defaultReview.type", "head")).toThrow(
        'must be "uncommitted" or "base"'
      );
      expect(() => setConfigValue(createBaseConfig(), "defaultReview.branch", true)).toThrow(
        "non-empty branch"
      );
    });

    test("validates numeric and boolean scalar updates", () => {
      expect(() => setConfigValue(createBaseConfig(), "maxIterations", "8")).toThrow(
        "integer greater than 0"
      );
      expect(() => setConfigValue(createBaseConfig(), "iterationTimeout", "1000")).toThrow(
        "integer greater than 0"
      );
      expect(() => setConfigValue(createBaseConfig(), "run.simplifier", "true")).toThrow(
        'must be "true" or "false"'
      );
      expect(() =>
        setConfigValue(createBaseConfig(), "notifications.sound.enabled", "true")
      ).toThrow('must be "true" or "false"');
    });

    test("updates retry fields and validates retry value types", () => {
      const updated = setConfigValue(createBaseConfig(), "retry.baseDelayMs", 1000);
      expect(updated.retry?.baseDelayMs).toBe(1000);
      expect(updated.retry?.maxRetries).toBeDefined();
      expect(updated.retry?.maxDelayMs).toBeDefined();

      expect(() => setConfigValue(createBaseConfig(), "retry.maxRetries", "3")).toThrow(
        "greater than or equal to 0"
      );
      expect(() => setConfigValue(createBaseConfig(), "retry.baseDelayMs", "1000")).toThrow(
        "greater than 0"
      );
      expect(() => setConfigValue(createBaseConfig(), "retry.maxDelayMs", "2000")).toThrow(
        "greater than 0"
      );
    });
  });

  describe("validateConfigInvariants", () => {
    test("rejects invalid base review", () => {
      const candidate = createBaseConfig();
      candidate.defaultReview = { type: "base", branch: "" };

      const errors = validateConfigInvariants(candidate);
      expect(errors.some((error) => error.includes("defaultReview.branch"))).toBe(true);
    });

    test("rejects invalid scalar, retry, and notification settings", () => {
      const candidate = {
        ...createBaseConfig(),
        maxIterations: 0,
        iterationTimeout: 0,
        retry: {
          maxRetries: -1,
          baseDelayMs: 0,
          maxDelayMs: 0,
        },
        run: { simplifier: "yes" },
        notifications: { sound: { enabled: "yes" } },
      } as unknown as Config;

      const errors = validateConfigInvariants(candidate);
      expect(errors.some((error) => error.includes("maxIterations"))).toBe(true);
      expect(errors.some((error) => error.includes("iterationTimeout"))).toBe(true);
      expect(errors.some((error) => error.includes("retry.maxRetries"))).toBe(true);
      expect(errors.some((error) => error.includes("retry.baseDelayMs"))).toBe(true);
      expect(errors.some((error) => error.includes("retry.maxDelayMs"))).toBe(true);
      expect(errors.some((error) => error.includes("run.simplifier"))).toBe(true);
      expect(errors.some((error) => error.includes("notifications.sound.enabled"))).toBe(true);
    });

    test("rejects pi roles missing provider/model", () => {
      const candidate = createBaseConfig();
      candidate.reviewer = { agent: "pi", provider: "", model: "" };
      candidate.fixer = { agent: "pi", provider: "", model: "" };
      candidate["code-simplifier"] = { agent: "pi", provider: "", model: "" };

      const errors = validateConfigInvariants(candidate);
      expect(errors.some((error) => error.includes("reviewer.provider"))).toBe(true);
      expect(errors.some((error) => error.includes("reviewer.model"))).toBe(true);
      expect(errors.some((error) => error.includes("fixer.provider"))).toBe(true);
      expect(errors.some((error) => error.includes("fixer.model"))).toBe(true);
      expect(errors.some((error) => error.includes("code-simplifier.provider"))).toBe(true);
      expect(errors.some((error) => error.includes("code-simplifier.model"))).toBe(true);
    });

    test("rejects non-pi provider fields", () => {
      const candidate = createBaseConfig();
      candidate.reviewer = {
        agent: "codex",
        model: "gpt-5.3-codex",
        provider: "anthropic",
      } as unknown as Config["reviewer"];

      const errors = validateConfigInvariants(candidate);
      expect(errors.some((error) => error.includes("reviewer.provider must be absent"))).toBe(true);
    });

    test("passes valid base review after branch then type update", () => {
      const withBranch = setConfigValue(createBaseConfig(), "defaultReview.branch", "main");
      const withType = setConfigValue(withBranch, "defaultReview.type", "base");
      const errors = validateConfigInvariants(withType);
      expect(errors).toEqual([]);

      const parsed = parseConfig(withType);
      expect(parsed).not.toBeNull();
      expect(parsed?.defaultReview).toEqual({ type: "base", branch: "main" });
    });
  });
});

describe("config command execution", () => {
  test("reports unknown subcommand and exits", async () => {
    const harness = createCommandHarness();
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["wizard"]);

    expect(harness.errors[0]).toContain("Unknown config subcommand");
    expect(harness.exits).toEqual([1]);
  });

  test("show prints config when args are valid", async () => {
    const harness = createCommandHarness();
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["show"]);

    expect(harness.printed).toHaveLength(1);
    expect(harness.printed[0]).toContain('"reviewer"');
    expect(harness.exits).toEqual([]);
  });

  test("show enforces usage and existing config", async () => {
    const usageHarness = createCommandHarness();
    const runUsage = createRunConfig(usageHarness.deps);
    await runUsage(["show", "extra"]);
    expect(usageHarness.errors[0]).toContain("Usage: rr config show");
    expect(usageHarness.exits).toEqual([1]);

    const missingHarness = createCommandHarness({
      configExists: async () => false,
    });
    const runMissing = createRunConfig(missingHarness.deps);
    await runMissing(["show"]);
    expect(missingHarness.errors[0]).toContain('Configuration not found. Run "rr init" first.');
    expect(missingHarness.exits).toEqual([1]);
  });

  test("show reports invalid existing config", async () => {
    const harness = createCommandHarness({
      loadConfig: async () => null,
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["show"]);

    expect(harness.errors[0]).toContain("Configuration exists but is invalid");
    expect(harness.exits).toEqual([1]);
  });

  test("get enforces usage and unknown keys", async () => {
    const usageHarness = createCommandHarness();
    const runUsage = createRunConfig(usageHarness.deps);
    await runUsage(["get"]);
    expect(usageHarness.errors[0]).toContain("Usage: rr config get <key>");
    expect(usageHarness.exits).toEqual([1]);

    const unknownHarness = createCommandHarness();
    const runUnknown = createRunConfig(unknownHarness.deps);
    await runUnknown(["get", "reviewer.unknown"]);
    expect(unknownHarness.errors[0]).toContain("Unknown config key");
    expect(unknownHarness.exits).toEqual([1]);
  });

  test("get reports unset values", async () => {
    const harness = createCommandHarness();
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["get", "retry.maxRetries"]);

    expect(harness.errors[0]).toContain('Key "retry.maxRetries" is not set');
    expect(harness.exits).toEqual([1]);
  });

  test("get prints object values as JSON", async () => {
    const config = createBaseConfig();
    config.reviewer = {
      ...config.reviewer,
      model: { name: "custom" } as unknown as string,
    };

    const harness = createCommandHarness({
      loadConfig: async () => config,
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["get", "reviewer.model"]);

    expect(harness.printed).toHaveLength(1);
    expect(harness.printed[0]).toContain('"name": "custom"');
    expect(harness.exits).toEqual([]);
  });

  test("set enforces usage", async () => {
    const harness = createCommandHarness();
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["set", "maxIterations"]);

    expect(harness.errors[0]).toContain("Usage: rr config set <key> <value>");
    expect(harness.exits).toEqual([1]);
  });

  test("set reports invariant violations", async () => {
    const harness = createCommandHarness();
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["set", "defaultReview.type", "base"]);

    expect(harness.errors[0]).toContain("defaultReview.branch is required");
    expect(harness.saved).toHaveLength(0);
    expect(harness.exits).toEqual([1]);
  });

  test("set reports parseConfig normalization failures", async () => {
    const harness = createCommandHarness({
      parseConfig: () => null,
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["set", "maxIterations", "8"]);

    expect(harness.errors[0]).toContain("Updated configuration is invalid.");
    expect(harness.saved).toHaveLength(0);
    expect(harness.exits).toEqual([1]);
  });

  test("set saves and logs success on valid update", async () => {
    const harness = createCommandHarness();
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["set", "fixer.model", "null"]);

    expect(harness.saved).toHaveLength(1);
    expect(harness.saved[0]?.fixer.model).toBeUndefined();
    expect(harness.successes[0]).toContain('Updated "fixer.model" to null.');
    expect(harness.exits).toEqual([]);
  });

  test("edit enforces usage and requires EDITOR", async () => {
    const usageHarness = createCommandHarness();
    const runUsage = createRunConfig(usageHarness.deps);
    await runUsage(["edit", "extra"]);
    expect(usageHarness.errors[0]).toContain("Usage: rr config edit");
    expect(usageHarness.exits).toEqual([1]);

    const noEditorHarness = createCommandHarness({
      env: { SHELL: "/bin/zsh", EDITOR: undefined },
    });
    const runNoEditor = createRunConfig(noEditorHarness.deps);
    await runNoEditor(["edit"]);
    expect(noEditorHarness.errors[0]).toContain("EDITOR is not set");
    expect(noEditorHarness.exits).toEqual([1]);
  });

  test("edit uses shell fallback when SHELL is unset", async () => {
    const harness = createCommandHarness({
      env: { EDITOR: "vim", SHELL: undefined },
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["edit"]);

    expect(harness.spawnCalls).toHaveLength(1);
    expect(harness.spawnCalls[0]?.command[0]).toBe("sh");
    expect(harness.exits).toEqual([]);
  });

  test("edit shell-quotes config path and reports non-zero exit code", async () => {
    const harness = createCommandHarness({
      configPath: "/tmp/ralph's-config.json",
      spawn: ((command, options) => {
        harness.spawnCalls.push({ command, options });
        return { exited: Promise.resolve(2) };
      }) as ConfigCommandDeps["spawn"],
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["edit"]);

    expect(harness.spawnCalls).toHaveLength(1);
    expect(harness.spawnCalls[0]?.command).toEqual([
      "/bin/zsh",
      "-lc",
      `exec $EDITOR '/tmp/ralph'"'"'s-config.json'`,
    ]);
    expect(harness.errors[0]).toContain("Editor exited with code 2.");
    expect(harness.exits).toEqual([1]);
  });

  test("edit warns when config file is not saved", async () => {
    const harness = createCommandHarness({
      configExists: async () => false,
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["edit"]);

    expect(harness.warnings[0]).toContain("No config file was saved");
    expect(harness.saved).toHaveLength(0);
    expect(harness.exits).toEqual([]);
  });

  test("edit warns when saved config is invalid", async () => {
    const harness = createCommandHarness({
      loadConfig: async () => null,
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["edit"]);

    expect(harness.warnings[0]).toContain("Configuration exists but is invalid");
    expect(harness.saved).toHaveLength(0);
    expect(harness.exits).toEqual([]);
  });

  test("edit normalizes saved config after successful editor run", async () => {
    const harness = createCommandHarness();
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["edit"]);

    expect(harness.saved).toHaveLength(1);
    expect(harness.saved[0]?.$schema).toBe(CONFIG_SCHEMA_URI);
    expect(harness.exits).toEqual([]);
  });
});
