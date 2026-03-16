import { describe, expect, test } from "bun:test";
import * as p from "@clack/prompts";
import {
  type ConfigCommandDeps,
  createRunConfig,
  getConfigValue,
  parseConfigKey,
  parseConfigSubcommand,
  parseConfigValue,
  runConfig,
  setConfigValue,
  validateConfigInvariants,
} from "@/commands/config";
import { parseConfig, parseConfigWithDiagnostics } from "@/lib/config";
import {
  CONFIG_SCHEMA_URI,
  CONFIG_VERSION,
  type Config,
  type ConfigOverride,
  DEFAULT_RETRY_CONFIG,
} from "@/lib/types";

const baseConfig: Config = {
  $schema: CONFIG_SCHEMA_URI,
  version: CONFIG_VERSION,
  reviewer: { agent: "codex", model: "gpt-5.3-codex", reasoning: "high" },
  fixer: { agent: "claude", model: "claude-opus-4-6", reasoning: "medium" },
  "code-simplifier": { agent: "droid", model: "gpt-5.2-codex", reasoning: "low" },
  run: { simplifier: false, interactive: false },
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
  savedOverrides: ConfigOverride[];
  savedOverridePaths: string[];
  spawnCalls: Array<{
    command: string[];
    options: Parameters<ConfigCommandDeps["spawn"]>[1];
  }>;
  effectiveLoadCalls: string[];
};

function createCommandHarness(overrides?: Partial<ConfigCommandDeps>): CommandHarness {
  const printed: string[] = [];
  const successes: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const exits: number[] = [];
  const saved: Config[] = [];
  const savedOverrides: ConfigOverride[] = [];
  const savedOverridePaths: string[] = [];
  const spawnCalls: Array<{
    command: string[];
    options: Parameters<ConfigCommandDeps["spawn"]>[1];
  }> = [];
  const effectiveLoadCalls: string[] = [];

  const defaults: ConfigCommandDeps = {
    configPath: "/tmp/ralph-test-config.json",
    configExists: async () => true,
    ensureConfigDir: async () => {},
    cwd: () => "/repo/project",
    resolveRepoConfigPath: async () => ({
      repoRoot: "/repo",
      path: "/repo/.ralph-review/config.json",
    }),
    loadConfig: async () => createBaseConfig(),
    loadConfigWithDiagnostics: async () => {
      const config = createBaseConfig();
      return { exists: true, config, errors: [] };
    },
    loadConfigOverrideWithDiagnostics: async () => ({
      exists: true,
      path: "/repo/.ralph-review/config.json",
      config: { run: { simplifier: true } },
      errors: [],
    }),
    loadEffectiveConfigWithDiagnostics: async (projectPath = "/repo/project") => {
      effectiveLoadCalls.push(projectPath);
      return {
        exists: true,
        config: createBaseConfig(),
        errors: [],
        source: "global",
        globalPath: "/tmp/ralph-test-config.json",
        localPath: "/repo/.ralph-review/config.json",
        repoRoot: "/repo",
        globalExists: true,
        localExists: false,
        globalErrors: [],
        localErrors: [],
      };
    },
    parseConfig: (value) => parseConfig(value),
    parseConfigWithDiagnostics: (value) => parseConfigWithDiagnostics(value),
    saveConfig: async (config) => {
      saved.push(config);
    },
    saveConfigOverride: async (config, path) => {
      savedOverrides.push(config);
      savedOverridePaths.push(path);
    },
    buildConfigOverride: (_baseConfig, config) => ({
      maxIterations: config.maxIterations,
    }),
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

  const loadConfigOverride = overrides?.loadConfig;
  const parseConfigOverride = overrides?.parseConfig;
  const deps: ConfigCommandDeps = {
    ...defaults,
    ...overrides,
    loadConfigWithDiagnostics:
      overrides?.loadConfigWithDiagnostics ??
      (loadConfigOverride
        ? async () => {
            const config = (await loadConfigOverride()) ?? null;
            return {
              exists: config !== null,
              config,
              errors: config ? [] : ["Configuration format is invalid."],
            };
          }
        : defaults.loadConfigWithDiagnostics),
    parseConfigWithDiagnostics:
      overrides?.parseConfigWithDiagnostics ??
      (parseConfigOverride
        ? (value) => {
            const config = parseConfigOverride(value) ?? null;
            return {
              config,
              errors: config ? [] : ["Configuration format is invalid."],
            };
          }
        : defaults.parseConfigWithDiagnostics),
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
    savedOverrides,
    savedOverridePaths,
    spawnCalls,
    effectiveLoadCalls,
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
      expect(parseConfigKey("run.interactive")).toBe("run.interactive");
      expect(parseConfigKey("notifications.sound.enabled")).toBe("notifications.sound.enabled");
    });

    test("rejects unknown key", () => {
      expect(() => parseConfigKey("reviewer.unknown")).toThrow("Unknown config key");
      expect(() => parseConfigKey("run.watch")).toThrow("Unknown config key");
    });
  });

  describe("parseConfigValue", () => {
    test("parses role-level raw strings by default", () => {
      expect(parseConfigValue("reviewer.model", "gpt-5.2-codex")).toBe("gpt-5.2-codex");
    });

    test("parses valid agent, reasoning, and retry values", () => {
      expect(parseConfigValue("reviewer.agent", "codex")).toBe("codex");
      expect(parseConfigValue("reviewer.reasoning", "high")).toBe("high");
      expect(parseConfigValue("retry.maxRetries", "3")).toBe(3);
      expect(parseConfigValue("retry.baseDelayMs", "1000")).toBe(1000);
      expect(parseConfigValue("retry.maxDelayMs", "2000")).toBe(2000);
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

    test("rejects invalid role-specific constraints", () => {
      expect(() => parseConfigValue("fixer.agent", "wizard")).toThrow("must be a valid agent");
      expect(() => parseConfigValue("fixer.reasoning", "ultra")).toThrow("must be one of");
      expect(() => parseConfigValue("maxIterations", "0")).toThrow("greater than 0");
      expect(() => parseConfigValue("retry.maxRetries", "-1")).toThrow(
        "greater than or equal to 0"
      );
      expect(() => parseConfigValue("retry.baseDelayMs", "0")).toThrow("greater than 0");
      expect(() => parseConfigValue("retry.maxDelayMs", "0")).toThrow("greater than 0");
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
      expect(parseConfigValue("run.interactive", "true")).toBe(true);
      expect(parseConfigValue("run.interactive", "false")).toBe(false);
    });

    test("rejects invalid boolean strings", () => {
      expect(() => parseConfigValue("notifications.sound.enabled", "yes")).toThrow(
        'must be "true" or "false"'
      );
      expect(() => parseConfigValue("run.simplifier", "yes")).toThrow('must be "true" or "false"');
      expect(() => parseConfigValue("run.interactive", "yes")).toThrow('must be "true" or "false"');
    });
  });

  describe("getConfigValue", () => {
    test("returns scalar values", () => {
      expect(getConfigValue(createBaseConfig(), "reviewer.agent")).toBe("codex");
      expect(getConfigValue(createBaseConfig(), "fixer.agent")).toBe("claude");
      expect(getConfigValue(createBaseConfig(), "fixer.model")).toBe("claude-opus-4-6");
      expect(getConfigValue(createBaseConfig(), "reviewer.reasoning")).toBe("high");
      expect(getConfigValue(createBaseConfig(), "fixer.reasoning")).toBe("medium");
      expect(getConfigValue(createBaseConfig(), "code-simplifier.agent")).toBe("droid");
      expect(getConfigValue(createBaseConfig(), "code-simplifier.model")).toBe("gpt-5.2-codex");
      expect(getConfigValue(createBaseConfig(), "code-simplifier.reasoning")).toBe("low");
      expect(getConfigValue(createBaseConfig(), "maxIterations")).toBe(5);
      expect(getConfigValue(createBaseConfig(), "iterationTimeout")).toBe(1800000);
      expect(getConfigValue(createBaseConfig(), "defaultReview.type")).toBe("uncommitted");
      expect(getConfigValue(createBaseConfig(), "run.simplifier")).toBe(false);
      expect(getConfigValue(createBaseConfig(), "run.interactive")).toBe(false);
      expect(getConfigValue(createBaseConfig(), "notifications.sound.enabled")).toBe(false);
    });

    test("returns undefined for unset values", () => {
      expect(getConfigValue(createBaseConfig(), "retry.baseDelayMs")).toBeUndefined();
      expect(getConfigValue(createBaseConfig(), "defaultReview.branch")).toBeUndefined();
      expect(getConfigValue(createBaseConfig(), "reviewer.provider")).toBeUndefined();
      expect(getConfigValue(createBaseConfig(), "fixer.provider")).toBeUndefined();
      expect(getConfigValue(createBaseConfig(), "code-simplifier.provider")).toBeUndefined();
    });

    test("returns undefined for optional simplifier when unset", () => {
      const config = createBaseConfig();
      delete config["code-simplifier"];

      expect(getConfigValue(config, "code-simplifier.agent")).toBeUndefined();
      expect(getConfigValue(config, "code-simplifier.model")).toBeUndefined();
      expect(getConfigValue(config, "code-simplifier.reasoning")).toBeUndefined();
      expect(getConfigValue(config, "code-simplifier.provider")).toBeUndefined();
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

    test("updates non-pi agent while preserving existing non-provider fields", () => {
      const updated = setConfigValue(createBaseConfig(), "reviewer.agent", "gemini");
      expect(updated.reviewer).toEqual({
        agent: "gemini",
        model: "gpt-5.3-codex",
        reasoning: "high",
      });
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

    test("defensively handles malformed key matcher results", () => {
      const missingGroupsKey = {
        match: () => ["reviewer.agent"],
      } as unknown as Parameters<typeof setConfigValue>[1];
      const invalidRoleKey = {
        match: () => ["reviewer.agent", "invalid-role", "agent"],
      } as unknown as Parameters<typeof setConfigValue>[1];
      const invalidFieldKey = {
        match: () => ["reviewer.agent", "reviewer", "invalid-field"],
      } as unknown as Parameters<typeof setConfigValue>[1];

      expect(setConfigValue(createBaseConfig(), missingGroupsKey, "value")).toEqual(
        createBaseConfig()
      );
      expect(setConfigValue(createBaseConfig(), invalidRoleKey, "value")).toEqual(
        createBaseConfig()
      );
      expect(setConfigValue(createBaseConfig(), invalidFieldKey, "value")).toEqual(
        createBaseConfig()
      );
    });

    test("rejects reviewer non-agent updates when reviewer settings are missing", () => {
      const invalid = {
        ...createBaseConfig(),
        reviewer: undefined,
      } as unknown as Config;

      expect(() => setConfigValue(invalid, "reviewer.model", "gpt-5.3-codex")).toThrow(
        'Role "reviewer" is not configured'
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

      const piConfig = createBaseConfig();
      piConfig.reviewer = {
        agent: "pi",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        reasoning: "high",
      };
      expect(() => setConfigValue(piConfig, "reviewer.reasoning", true)).toThrow("must be one of");
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
      expect(() => setConfigValue(createBaseConfig(), "run.interactive", "true")).toThrow(
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

    test("updates scalar and retry boolean fields", () => {
      const withTimeout = setConfigValue(createBaseConfig(), "iterationTimeout", 1200000);
      expect(withTimeout.iterationTimeout).toBe(1200000);

      const withRun = setConfigValue(createBaseConfig(), "run.simplifier", true);
      expect(withRun.run?.simplifier).toBe(true);
      expect(withRun.run?.interactive).toBe(false);

      const withInteractive = setConfigValue(createBaseConfig(), "run.interactive", true);
      expect(withInteractive.run?.interactive).toBe(true);
      expect(withInteractive.run?.simplifier).toBe(false);

      const withRetries = setConfigValue(createBaseConfig(), "retry.maxRetries", 7);
      expect(withRetries.retry?.maxRetries).toBe(7);

      const withMaxDelay = setConfigValue(createBaseConfig(), "retry.maxDelayMs", 45000);
      expect(withMaxDelay.retry?.maxDelayMs).toBe(45000);

      const withSound = setConfigValue(createBaseConfig(), "notifications.sound.enabled", true);
      expect(withSound.notifications.sound.enabled).toBe(true);
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
        run: { simplifier: "yes", interactive: "yes" },
        notifications: { sound: { enabled: "yes" } },
      } as unknown as Config;

      const errors = validateConfigInvariants(candidate);
      expect(errors.some((error) => error.includes("maxIterations"))).toBe(true);
      expect(errors.some((error) => error.includes("iterationTimeout"))).toBe(true);
      expect(errors.some((error) => error.includes("retry.maxRetries"))).toBe(true);
      expect(errors.some((error) => error.includes("retry.baseDelayMs"))).toBe(true);
      expect(errors.some((error) => error.includes("retry.maxDelayMs"))).toBe(true);
      expect(errors.some((error) => error.includes("run.simplifier"))).toBe(true);
      expect(errors.some((error) => error.includes("run.interactive"))).toBe(true);
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
    expect(harness.printed[0]).toContain("Effective config");
    expect(harness.printed[0]).toContain("Path: /tmp/ralph-test-config.json");
    expect(harness.printed[0]).toContain("Agents");
    expect(harness.printed[0]).toContain("Reviewer:");
    expect(harness.printed[0]).not.toContain('"reviewer"');
    expect(harness.effectiveLoadCalls).toEqual(["/repo/project"]);
    expect(harness.exits).toEqual([]);
  });

  test("show prints effective config and repo-local overrides when repo-local config exists", async () => {
    const harness = createCommandHarness({
      loadConfigWithDiagnostics: async () => ({
        exists: true,
        config: createBaseConfig(),
        errors: [],
      }),
      loadConfigOverrideWithDiagnostics: async () => ({
        exists: true,
        path: "/repo/.ralph-review/config.json",
        config: { run: { simplifier: true } },
        errors: [],
      }),
      loadEffectiveConfigWithDiagnostics: async (projectPath = "/repo/project") => {
        harness.effectiveLoadCalls.push(projectPath);
        return {
          exists: true,
          config: { ...createBaseConfig(), run: { simplifier: true, interactive: false } },
          errors: [],
          source: "merged",
          globalPath: "/tmp/ralph-test-config.json",
          localPath: "/repo/.ralph-review/config.json",
          repoRoot: "/repo",
          globalExists: true,
          localExists: true,
          globalErrors: [],
          localErrors: [],
        };
      },
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["show"]);

    expect(harness.printed).toHaveLength(1);
    const output = harness.printed[0] ?? "";
    expect(output).toContain("Effective config");
    expect(output).toContain("Source: global + repo-local");
    expect(output).toContain("Repo-local overrides");
    expect(output).toContain("Path: /repo/.ralph-review/config.json");
    expect(output).not.toContain("Global config");
    expect(output).not.toContain('"run"');
  });

  test("show --json prints machine-readable layered config JSON", async () => {
    const harness = createCommandHarness({
      loadConfigWithDiagnostics: async () => ({
        exists: true,
        config: createBaseConfig(),
        errors: [],
      }),
      loadConfigOverrideWithDiagnostics: async () => ({
        exists: true,
        path: "/repo/.ralph-review/config.json",
        config: { run: { simplifier: true } },
        errors: [],
      }),
      loadEffectiveConfigWithDiagnostics: async (projectPath = "/repo/project") => {
        harness.effectiveLoadCalls.push(projectPath);
        return {
          exists: true,
          config: { ...createBaseConfig(), run: { simplifier: true, interactive: false } },
          errors: [],
          source: "merged",
          globalPath: "/tmp/ralph-test-config.json",
          localPath: "/repo/.ralph-review/config.json",
          repoRoot: "/repo",
          globalExists: true,
          localExists: true,
          globalErrors: [],
          localErrors: [],
        };
      },
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["show", "--json"]);

    const output = JSON.parse(harness.printed[0] ?? "");
    expect(output).toEqual({
      effective: { ...createBaseConfig(), run: { simplifier: true, interactive: false } },
      global: createBaseConfig(),
      local: { run: { simplifier: true } },
    });
  });

  test("show --local prints the readable repo-local override file", async () => {
    const harness = createCommandHarness({
      loadConfigOverrideWithDiagnostics: async () => ({
        exists: true,
        path: "/repo/.ralph-review/config.json",
        config: { maxIterations: 9, run: { simplifier: true } },
        errors: [],
      }),
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["show", "--local"]);

    expect(harness.printed).toHaveLength(1);
    expect(harness.printed[0]).toContain("Repo-local overrides");
    expect(harness.printed[0]).toContain("Path: /repo/.ralph-review/config.json");
    expect(harness.printed[0]).toContain("Limits");
    expect(harness.printed[0]).toContain("Run");
    expect(harness.printed[0]).not.toContain('"maxIterations": 9');
    expect(harness.effectiveLoadCalls).toEqual([]);
    expect(harness.exits).toEqual([]);
  });

  test("show --local --json prints raw repo-local override JSON", async () => {
    const harness = createCommandHarness({
      loadConfigOverrideWithDiagnostics: async () => ({
        exists: true,
        path: "/repo/.ralph-review/config.json",
        config: { maxIterations: 9, run: { simplifier: true } },
        errors: [],
      }),
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["show", "--local", "--json"]);

    expect(harness.printed).toHaveLength(1);
    expect(JSON.parse(harness.printed[0] ?? "")).toEqual({
      maxIterations: 9,
      run: { simplifier: true },
    });
  });

  test("show --global prints the readable global config", async () => {
    const harness = createCommandHarness();
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["show", "--global"]);

    expect(harness.printed).toHaveLength(1);
    expect(harness.printed[0]).toContain("Global config");
    expect(harness.printed[0]).toContain("Agents");
    expect(harness.printed[0]).toContain("Reviewer:");
    expect(harness.printed[0]).not.toContain('"reviewer"');
  });

  test("show --global --json prints raw global config JSON", async () => {
    const harness = createCommandHarness();
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["show", "--global", "--json"]);

    expect(harness.printed).toHaveLength(1);
    expect(JSON.parse(harness.printed[0] ?? "")).toEqual(createBaseConfig());
  });

  test("show enforces usage and existing config", async () => {
    const usageHarness = createCommandHarness();
    const runUsage = createRunConfig(usageHarness.deps);
    await runUsage(["show", "extra"]);
    expect(usageHarness.errors[0]).toContain(
      "Usage: rr config show [--local|--global] [--json] [--verbose]"
    );
    expect(usageHarness.exits).toEqual([1]);

    const missingHarness = createCommandHarness({
      loadEffectiveConfigWithDiagnostics: async () => ({
        exists: false,
        config: null,
        errors: [],
        source: "none",
        globalPath: "/tmp/ralph-test-config.json",
        localPath: "/repo/.ralph-review/config.json",
        repoRoot: "/repo",
        globalExists: false,
        localExists: false,
        globalErrors: [],
        localErrors: [],
      }),
    });
    const runMissing = createRunConfig(missingHarness.deps);
    await runMissing(["show"]);
    expect(missingHarness.errors[0]).toContain('Configuration not found. Run "rr init" first.');
    expect(missingHarness.exits).toEqual([1]);
  });

  test("show reports invalid existing config", async () => {
    const harness = createCommandHarness({
      loadEffectiveConfigWithDiagnostics: async () => ({
        exists: true,
        config: null,
        errors: [
          "run.watch is not supported. Available settings: run.simplifier, run.interactive.",
          "fixer.reasoning must be one of: low, medium, high, xhigh, max.",
        ],
        source: "global",
        globalPath: "/tmp/ralph-test-config.json",
        localPath: "/repo/.ralph-review/config.json",
        repoRoot: "/repo",
        globalExists: true,
        localExists: false,
        globalErrors: [
          "run.watch is not supported. Available settings: run.simplifier, run.interactive.",
          "fixer.reasoning must be one of: low, medium, high, xhigh, max.",
        ],
        localErrors: [],
      }),
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["show"]);

    expect(harness.errors[0]).toContain("Invalid configuration: /tmp/ralph-test-config.json");
    expect(harness.errors[0]).toContain(
      "- run.watch is not supported. Available settings: run.simplifier, run.interactive."
    );
    expect(harness.errors[0]).toContain(
      "- fixer.reasoning must be one of: low, medium, high, xhigh, max."
    );
    expect(harness.errors[0]).toContain(
      'Run "rr init" to regenerate the file, or fix it manually.'
    );
    expect(harness.exits).toEqual([1]);
  });

  test("show prints the effective config when a valid repo-local config masks global parse errors", async () => {
    const localConfig = {
      ...createBaseConfig(),
      maxIterations: 8,
    };
    const harness = createCommandHarness({
      loadEffectiveConfigWithDiagnostics: async () => ({
        exists: true,
        config: localConfig,
        errors: [
          "Invalid global config at /tmp/ralph-test-config.json: Invalid JSON syntax: Unexpected token",
        ],
        source: "local",
        globalPath: "/tmp/ralph-test-config.json",
        localPath: "/repo/.ralph-review/config.json",
        repoRoot: "/repo",
        globalExists: true,
        localExists: true,
        globalErrors: ["Invalid JSON syntax: Unexpected token"],
        localErrors: [],
      }),
      loadConfigWithDiagnostics: async () => ({
        exists: true,
        config: null,
        errors: ["Invalid JSON syntax: Unexpected token"],
      }),
      loadConfigOverrideWithDiagnostics: async () => ({
        exists: true,
        path: "/repo/.ralph-review/config.json",
        config: localConfig,
        errors: [],
      }),
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["show"]);

    expect(harness.printed).toHaveLength(1);
    expect(harness.printed[0]).toContain("Effective config");
    expect(harness.printed[0]).toContain("Source: repo-local only");
    expect(harness.printed[0]).toContain("Max iterations: 8");
    expect(harness.errors).toEqual([]);
    expect(harness.exits).toEqual([]);
  });

  test("show --verbose includes metadata in readable output", async () => {
    const harness = createCommandHarness();
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["show", "--verbose"]);

    expect(harness.printed).toHaveLength(1);
    expect(harness.printed[0]).toContain("Metadata");
    expect(harness.printed[0]).toContain(CONFIG_SCHEMA_URI);
    expect(harness.printed[0]).toContain(`${CONFIG_VERSION}`);
  });

  test("get enforces usage and unknown keys", async () => {
    const usageHarness = createCommandHarness();
    const runUsage = createRunConfig(usageHarness.deps);
    await runUsage(["get"]);
    expect(usageHarness.errors[0]).toContain("Usage: rr config get [--local|--global] <key>");
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

  test("get reads the effective config when a valid repo-local config masks global parse errors", async () => {
    const localConfig = {
      ...createBaseConfig(),
      maxIterations: 8,
    };
    const harness = createCommandHarness({
      loadEffectiveConfigWithDiagnostics: async () => ({
        exists: true,
        config: localConfig,
        errors: [
          "Invalid global config at /tmp/ralph-test-config.json: Invalid JSON syntax: Unexpected token",
        ],
        source: "local",
        globalPath: "/tmp/ralph-test-config.json",
        localPath: "/repo/.ralph-review/config.json",
        repoRoot: "/repo",
        globalExists: true,
        localExists: true,
        globalErrors: ["Invalid JSON syntax: Unexpected token"],
        localErrors: [],
      }),
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["get", "maxIterations"]);

    expect(harness.printed).toEqual(["8"]);
    expect(harness.errors).toEqual([]);
    expect(harness.exits).toEqual([]);
  });

  test("get prints object values as JSON", async () => {
    const config = createBaseConfig();
    config.reviewer = {
      ...config.reviewer,
      model: { name: "custom" } as unknown as string,
    };

    const harness = createCommandHarness({
      loadEffectiveConfigWithDiagnostics: async () => ({
        exists: true,
        config,
        errors: [],
        source: "global",
        globalPath: "/tmp/ralph-test-config.json",
        localPath: "/repo/.ralph-review/config.json",
        repoRoot: "/repo",
        globalExists: true,
        localExists: false,
        globalErrors: [],
        localErrors: [],
      }),
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["get", "reviewer.model"]);

    expect(harness.printed).toHaveLength(1);
    expect(harness.printed[0]).toContain('"name": "custom"');
    expect(harness.exits).toEqual([]);
  });

  test("get prints scalar values as strings", async () => {
    const harness = createCommandHarness();
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["get", "reviewer.agent"]);

    expect(harness.printed).toEqual(["codex"]);
    expect(harness.exits).toEqual([]);
  });

  test("get --local reads from the raw repo-local override file", async () => {
    const harness = createCommandHarness({
      loadConfigOverrideWithDiagnostics: async () => ({
        exists: true,
        path: "/repo/.ralph-review/config.json",
        config: { run: { simplifier: true } },
        errors: [],
      }),
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["get", "--local", "run.simplifier"]);

    expect(harness.printed).toEqual(["true"]);
    expect(harness.effectiveLoadCalls).toEqual([]);
    expect(harness.exits).toEqual([]);
  });

  test("set enforces usage", async () => {
    const harness = createCommandHarness();
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["set", "maxIterations"]);

    expect(harness.errors[0]).toContain("Usage: rr config set [--local|--global] <key> <value>");
    expect(harness.exits).toEqual([1]);
  });

  test("set reports invariant violations", async () => {
    const harness = createCommandHarness();
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["set", "defaultReview.type", "base"]);

    expect(harness.errors[0]).toContain("Updated configuration is invalid.");
    expect(harness.errors[0]).toContain(
      'defaultReview.branch must be a non-empty string when defaultReview.type is "base".'
    );
    expect(harness.saved).toHaveLength(0);
    expect(harness.exits).toEqual([1]);
  });

  test("set reports parseConfig normalization failures", async () => {
    const harness = createCommandHarness({
      parseConfigWithDiagnostics: () => ({
        config: null,
        errors: [
          "run.watch is not supported. Available settings: run.simplifier, run.interactive.",
        ],
      }),
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["set", "maxIterations", "8"]);

    expect(harness.errors[0]).toContain("Updated configuration is invalid.");
    expect(harness.errors[0]).toContain(
      "- run.watch is not supported. Available settings: run.simplifier, run.interactive."
    );
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

  test("set logs non-null values with string formatting", async () => {
    const harness = createCommandHarness();
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["set", "maxIterations", "8"]);

    expect(harness.saved).toHaveLength(1);
    expect(harness.saved[0]?.maxIterations).toBe(8);
    expect(harness.successes[0]).toContain('Updated "maxIterations" to 8.');
    expect(harness.exits).toEqual([]);
  });

  test("set warns when global save breaks effective config in current repo", async () => {
    const harness = createCommandHarness({
      loadEffectiveConfigWithDiagnostics: async () => ({
        exists: true,
        config: null,
        errors: ["reviewer.provider is only valid when agent is pi"],
        source: "merged",
        globalPath: "/tmp/ralph-test-config.json",
        localPath: "/repo/.ralph-review/config.json",
        repoRoot: "/repo",
        globalExists: true,
        localExists: true,
        globalErrors: [],
        localErrors: ["reviewer.provider is only valid when agent is pi"],
      }),
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["set", "reviewer.agent", "claude"]);

    expect(harness.saved).toHaveLength(1);
    expect(harness.successes[0]).toContain('Updated "reviewer.agent"');
    expect(harness.warnings[0]).toContain("repo-local");
    expect(harness.warnings[0]).toContain("reviewer.provider is only valid when agent is pi");
  });

  test("set --local saves a repo-local diff instead of rewriting the global config", async () => {
    const harness = createCommandHarness({
      loadEffectiveConfigWithDiagnostics: async () => ({
        exists: true,
        config: {
          ...createBaseConfig(),
          run: { simplifier: true, interactive: false },
        },
        errors: [],
        source: "merged",
        globalPath: "/tmp/ralph-test-config.json",
        localPath: "/repo/.ralph-review/config.json",
        repoRoot: "/repo",
        globalExists: true,
        localExists: true,
        globalErrors: [],
        localErrors: [],
      }),
      buildConfigOverride: () => ({
        run: { simplifier: true },
        maxIterations: 8,
      }),
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["set", "--local", "maxIterations", "8"]);

    expect(harness.saved).toHaveLength(0);
    expect(harness.savedOverrides).toEqual([
      {
        run: { simplifier: true },
        maxIterations: 8,
      },
    ]);
    expect(harness.savedOverridePaths).toEqual(["/repo/.ralph-review/config.json"]);
    expect(harness.successes[0]).toContain('Updated "maxIterations" to 8.');
    expect(harness.exits).toEqual([]);
  });

  test("set --local updates a complete raw override when the global layer is broken", async () => {
    const localConfig = {
      ...createBaseConfig(),
      run: { simplifier: true, interactive: false },
    };
    const harness = createCommandHarness({
      loadEffectiveConfigWithDiagnostics: async () => ({
        exists: true,
        config: null,
        errors: [
          "Effective configuration is invalid.",
          "Global config /tmp/ralph-test-config.json: Invalid JSON syntax: Unexpected token",
        ],
        source: "merged",
        globalPath: "/tmp/ralph-test-config.json",
        localPath: "/repo/.ralph-review/config.json",
        repoRoot: "/repo",
        globalExists: true,
        localExists: true,
        globalErrors: ["Invalid JSON syntax: Unexpected token"],
        localErrors: [],
      }),
      loadConfigOverrideWithDiagnostics: async () => ({
        exists: true,
        path: "/repo/.ralph-review/config.json",
        config: localConfig,
        errors: [],
      }),
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["set", "--local", "maxIterations", "8"]);

    expect(harness.saved).toHaveLength(0);
    expect(harness.savedOverrides).toEqual([
      {
        ...localConfig,
        maxIterations: 8,
      },
    ]);
    expect(harness.savedOverridePaths).toEqual(["/repo/.ralph-review/config.json"]);
    expect(harness.successes[0]).toContain('Updated "maxIterations" to 8.');
    expect(harness.exits).toEqual([]);
  });

  test("set --local updates a diff-style raw override when the global layer is broken", async () => {
    const localOverride: ConfigOverride = {
      run: { simplifier: true },
    };
    const harness = createCommandHarness({
      loadEffectiveConfigWithDiagnostics: async () => ({
        exists: true,
        config: null,
        errors: [
          "Effective configuration is invalid.",
          "Global config /tmp/ralph-test-config.json: Invalid JSON syntax: Unexpected token",
        ],
        source: "merged",
        globalPath: "/tmp/ralph-test-config.json",
        localPath: "/repo/.ralph-review/config.json",
        repoRoot: "/repo",
        globalExists: true,
        localExists: true,
        globalErrors: ["Invalid JSON syntax: Unexpected token"],
        localErrors: [],
      }),
      loadConfigOverrideWithDiagnostics: async () => ({
        exists: true,
        path: "/repo/.ralph-review/config.json",
        config: localOverride,
        errors: [],
      }),
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["set", "--local", "maxIterations", "8"]);

    expect(harness.saved).toHaveLength(0);
    expect(harness.savedOverrides).toEqual([
      {
        run: { simplifier: true },
        maxIterations: 8,
      },
    ]);
    expect(harness.savedOverridePaths).toEqual(["/repo/.ralph-review/config.json"]);
    expect(harness.successes[0]).toContain('Updated "maxIterations" to 8.');
    expect(harness.exits).toEqual([]);
  });

  test("set --local still updates a valid raw override when the effective config is incomplete", async () => {
    const harness = createCommandHarness({
      loadEffectiveConfigWithDiagnostics: async () => ({
        exists: true,
        config: null,
        errors: ["Effective configuration is invalid.", "reviewer must be an object."],
        source: "local",
        globalPath: "/tmp/ralph-test-config.json",
        localPath: "/repo/.ralph-review/config.json",
        repoRoot: "/repo",
        globalExists: false,
        localExists: true,
        globalErrors: [],
        localErrors: [],
      }),
      loadConfigOverrideWithDiagnostics: async () => ({
        exists: true,
        path: "/repo/.ralph-review/config.json",
        config: { maxIterations: 4 },
        errors: [],
      }),
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["set", "--local", "iterationTimeout", "3600000"]);

    expect(harness.savedOverrides).toEqual([
      {
        maxIterations: 4,
        iterationTimeout: 3600000,
      },
    ]);
    expect(harness.successes[0]).toContain('Updated "iterationTimeout" to 3600000.');
    expect(harness.errors).toEqual([]);
    expect(harness.exits).toEqual([]);
  });

  test("set --local validates repo scope before loading the effective config", async () => {
    const harness = createCommandHarness({
      resolveRepoConfigPath: async () => null,
      loadEffectiveConfigWithDiagnostics: async () => {
        harness.effectiveLoadCalls.push("unexpected");
        return {
          exists: false,
          config: null,
          errors: ["Invalid global config."],
          source: "none",
          globalPath: "/tmp/ralph-test-config.json",
          localPath: null,
          repoRoot: null,
          globalExists: false,
          localExists: false,
          globalErrors: ["Invalid global config."],
          localErrors: [],
        };
      },
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["set", "--local", "maxIterations", "8"]);

    expect(harness.errors[0]).toContain("Cannot use --local outside a git repository");
    expect(harness.effectiveLoadCalls).toEqual([]);
    expect(harness.exits).toEqual([1]);
  });

  test("reports an error when --local is used outside a git repository", async () => {
    const harness = createCommandHarness({
      resolveRepoConfigPath: async () => null,
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["show", "--local"]);

    expect(harness.errors[0]).toContain("Cannot use --local outside a git repository");
    expect(harness.exits).toEqual([1]);
  });

  test("show rejects conflicting scope flags", async () => {
    const harness = createCommandHarness();
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["show", "--local", "--global"]);

    expect(harness.errors[0]).toContain("Cannot use --local and --global together.");
    expect(harness.exits).toEqual([1]);
  });

  test("get rejects conflicting scope flags", async () => {
    const harness = createCommandHarness();
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["get", "--global", "--local", "reviewer.agent"]);

    expect(harness.errors[0]).toContain("Cannot use --local and --global together.");
    expect(harness.exits).toEqual([1]);
  });

  test("set rejects conflicting scope flags", async () => {
    const harness = createCommandHarness();
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["set", "--local", "--global", "maxIterations", "8"]);

    expect(harness.errors[0]).toContain("Cannot use --local and --global together.");
    expect(harness.exits).toEqual([1]);
  });

  test("edit rejects conflicting scope flags", async () => {
    const harness = createCommandHarness();
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["edit", "--global", "--local"]);

    expect(harness.errors[0]).toContain("Cannot use --local and --global together.");
    expect(harness.exits).toEqual([1]);
  });

  test("show --global reports a missing config file", async () => {
    const harness = createCommandHarness({
      configExists: async () => false,
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["show", "--global"]);

    expect(harness.errors[0]).toContain('Configuration not found. Run "rr init" first.');
    expect(harness.exits).toEqual([1]);
  });

  test("show --global reports invalid global config diagnostics", async () => {
    const harness = createCommandHarness({
      loadConfigWithDiagnostics: async () => ({
        exists: true,
        config: null,
        errors: ["notifications.sound.enabled must be a boolean."],
      }),
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["show", "--global"]);

    expect(harness.errors[0]).toContain("Invalid configuration: /tmp/ralph-test-config.json");
    expect(harness.errors[0]).toContain("- notifications.sound.enabled must be a boolean.");
    expect(harness.exits).toEqual([1]);
  });

  test("show --local reports invalid repo-local override diagnostics", async () => {
    const harness = createCommandHarness({
      loadConfigOverrideWithDiagnostics: async () => ({
        exists: true,
        path: "/repo/.ralph-review/config.json",
        config: null,
        errors: ["run.watch is not supported."],
      }),
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["show", "--local"]);

    expect(harness.errors[0]).toContain(
      "Invalid repo-local configuration: /repo/.ralph-review/config.json"
    );
    expect(harness.errors[0]).toContain("- run.watch is not supported.");
    expect(harness.exits).toEqual([1]);
  });

  test("set --local can create an agent-only override when the role is absent", async () => {
    const harness = createCommandHarness({
      loadEffectiveConfigWithDiagnostics: async () => ({
        exists: true,
        config: null,
        errors: ["Effective configuration is invalid.", "reviewer must be an object."],
        source: "local",
        globalPath: "/tmp/ralph-test-config.json",
        localPath: "/repo/.ralph-review/config.json",
        repoRoot: "/repo",
        globalExists: false,
        localExists: true,
        globalErrors: [],
        localErrors: [],
      }),
      loadConfigOverrideWithDiagnostics: async () => ({
        exists: true,
        path: "/repo/.ralph-review/config.json",
        config: {},
        errors: [],
      }),
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["set", "--local", "reviewer.agent", "codex"]);

    expect(harness.savedOverrides).toEqual([
      {
        reviewer: { agent: "codex" },
      },
    ]);
    expect(harness.errors).toEqual([]);
    expect(harness.exits).toEqual([]);
  });

  test("set --local rejects provider updates for non-pi overrides", async () => {
    const harness = createCommandHarness({
      loadEffectiveConfigWithDiagnostics: async () => ({
        exists: true,
        config: null,
        errors: ["Effective configuration is invalid.", "reviewer must be an object."],
        source: "local",
        globalPath: "/tmp/ralph-test-config.json",
        localPath: "/repo/.ralph-review/config.json",
        repoRoot: "/repo",
        globalExists: false,
        localExists: true,
        globalErrors: [],
        localErrors: [],
      }),
      loadConfigOverrideWithDiagnostics: async () => ({
        exists: true,
        path: "/repo/.ralph-review/config.json",
        config: { reviewer: { agent: "codex" } },
        errors: [],
      }),
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["set", "--local", "reviewer.provider", "openai"]);

    expect(harness.errors[0]).toContain(
      '"reviewer.provider" is only valid when "reviewer.agent" is "pi".'
    );
    expect(harness.savedOverrides).toHaveLength(0);
    expect(harness.exits).toEqual([1]);
  });

  test("set --local removes provider from a non-pi override", async () => {
    const harness = createCommandHarness({
      loadEffectiveConfigWithDiagnostics: async () => ({
        exists: true,
        config: null,
        errors: ["Effective configuration is invalid.", "reviewer must be an object."],
        source: "local",
        globalPath: "/tmp/ralph-test-config.json",
        localPath: "/repo/.ralph-review/config.json",
        repoRoot: "/repo",
        globalExists: false,
        localExists: true,
        globalErrors: [],
        localErrors: [],
      }),
      loadConfigOverrideWithDiagnostics: async () => ({
        exists: true,
        path: "/repo/.ralph-review/config.json",
        config: {
          reviewer: {
            agent: "codex",
            provider: "unused-provider",
          },
        },
        errors: [],
      }),
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["set", "--local", "reviewer.provider", "null"]);

    expect(harness.savedOverrides).toEqual([
      {
        reviewer: { agent: "codex" },
      },
    ]);
    expect(harness.errors).toEqual([]);
    expect(harness.exits).toEqual([]);
  });

  test("set --local rejects unsetting provider for pi overrides", async () => {
    const harness = createCommandHarness({
      loadEffectiveConfigWithDiagnostics: async () => ({
        exists: true,
        config: null,
        errors: ["Effective configuration is invalid.", "reviewer must be an object."],
        source: "local",
        globalPath: "/tmp/ralph-test-config.json",
        localPath: "/repo/.ralph-review/config.json",
        repoRoot: "/repo",
        globalExists: false,
        localExists: true,
        globalErrors: [],
        localErrors: [],
      }),
      loadConfigOverrideWithDiagnostics: async () => ({
        exists: true,
        path: "/repo/.ralph-review/config.json",
        config: {
          reviewer: {
            agent: "pi",
            provider: "acme",
            model: "r1",
          },
        },
        errors: [],
      }),
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["set", "--local", "reviewer.provider", "null"]);

    expect(harness.errors[0]).toContain(
      'Cannot unset "reviewer.provider" while "reviewer.agent" is "pi".'
    );
    expect(harness.savedOverrides).toHaveLength(0);
    expect(harness.exits).toEqual([1]);
  });

  test("set --local rejects unsetting model for pi overrides", async () => {
    const harness = createCommandHarness({
      loadEffectiveConfigWithDiagnostics: async () => ({
        exists: true,
        config: null,
        errors: ["Effective configuration is invalid.", "reviewer must be an object."],
        source: "local",
        globalPath: "/tmp/ralph-test-config.json",
        localPath: "/repo/.ralph-review/config.json",
        repoRoot: "/repo",
        globalExists: false,
        localExists: true,
        globalErrors: [],
        localErrors: [],
      }),
      loadConfigOverrideWithDiagnostics: async () => ({
        exists: true,
        path: "/repo/.ralph-review/config.json",
        config: {
          reviewer: {
            agent: "pi",
            provider: "acme",
            model: "r1",
          },
        },
        errors: [],
      }),
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["set", "--local", "reviewer.model", "null"]);

    expect(harness.errors[0]).toContain(
      'Cannot unset "reviewer.model" while "reviewer.agent" is "pi".'
    );
    expect(harness.savedOverrides).toHaveLength(0);
    expect(harness.exits).toEqual([1]);
  });

  test("set --local can switch a pi override to a non-pi agent", async () => {
    const harness = createCommandHarness({
      loadEffectiveConfigWithDiagnostics: async () => ({
        exists: true,
        config: null,
        errors: ["Effective configuration is invalid.", "reviewer must be an object."],
        source: "local",
        globalPath: "/tmp/ralph-test-config.json",
        localPath: "/repo/.ralph-review/config.json",
        repoRoot: "/repo",
        globalExists: false,
        localExists: true,
        globalErrors: [],
        localErrors: [],
      }),
      loadConfigOverrideWithDiagnostics: async () => ({
        exists: true,
        path: "/repo/.ralph-review/config.json",
        config: {
          reviewer: {
            agent: "pi",
            provider: "acme",
            model: "r1",
            reasoning: "medium",
          },
        },
        errors: [],
      }),
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["set", "--local", "reviewer.agent", "codex"]);

    expect(harness.savedOverrides).toEqual([
      {
        reviewer: {
          agent: "codex",
          model: "r1",
          reasoning: "medium",
        },
      },
    ]);
    expect(harness.errors).toEqual([]);
    expect(harness.exits).toEqual([]);
  });

  test("set --local can update model, reasoning, run, retry, notifications, and review defaults", async () => {
    const harness = createCommandHarness({
      loadEffectiveConfigWithDiagnostics: async () => ({
        exists: true,
        config: null,
        errors: ["Effective configuration is invalid.", "reviewer must be an object."],
        source: "local",
        globalPath: "/tmp/ralph-test-config.json",
        localPath: "/repo/.ralph-review/config.json",
        repoRoot: "/repo",
        globalExists: false,
        localExists: true,
        globalErrors: [],
        localErrors: [],
      }),
      loadConfigOverrideWithDiagnostics: async () => ({
        exists: true,
        path: "/repo/.ralph-review/config.json",
        config: {
          reviewer: {
            agent: "codex",
            model: "gpt-5",
            reasoning: "low",
          },
        },
        errors: [],
      }),
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["set", "--local", "reviewer.model", "null"]);
    await runConfig(["set", "--local", "reviewer.reasoning", "max"]);
    await runConfig(["set", "--local", "defaultReview.type", "uncommitted"]);
    await runConfig(["set", "--local", "defaultReview.branch", "main"]);
    await runConfig(["set", "--local", "run.simplifier", "true"]);
    await runConfig(["set", "--local", "run.interactive", "false"]);
    await runConfig(["set", "--local", "retry.maxRetries", "4"]);
    await runConfig(["set", "--local", "retry.baseDelayMs", "500"]);
    await runConfig(["set", "--local", "retry.maxDelayMs", "2000"]);
    await runConfig(["set", "--local", "notifications.sound.enabled", "false"]);

    expect(harness.savedOverrides.at(-1)).toEqual({
      reviewer: {
        agent: "codex",
        model: "gpt-5",
        reasoning: "low",
      },
      notifications: {
        sound: {
          enabled: false,
        },
      },
    });
    expect(harness.errors).toEqual([]);
    expect(harness.exits).toEqual([]);
  });

  test("set --local reports invalid override normalization failures", async () => {
    const harness = createCommandHarness({
      loadEffectiveConfigWithDiagnostics: async () => ({
        exists: true,
        config: null,
        errors: ["Effective configuration is invalid.", "reviewer must be an object."],
        source: "local",
        globalPath: "/tmp/ralph-test-config.json",
        localPath: "/repo/.ralph-review/config.json",
        repoRoot: "/repo",
        globalExists: false,
        localExists: true,
        globalErrors: [],
        localErrors: [],
      }),
      loadConfigOverrideWithDiagnostics: async () => ({
        exists: true,
        path: "/repo/.ralph-review/config.json",
        config: {},
        errors: [],
      }),
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["set", "--local", "defaultReview.type", "base"]);

    expect(harness.errors[0]).toContain("Updated repo-local configuration is invalid.");
    expect(harness.errors[0]).toContain(
      'defaultReview.branch must be a non-empty string when defaultReview.type is "base".'
    );
    expect(harness.savedOverrides).toHaveLength(0);
    expect(harness.exits).toEqual([1]);
  });

  test("set --local reports invalid effective config updates", async () => {
    const harness = createCommandHarness({
      loadEffectiveConfigWithDiagnostics: async () => ({
        exists: true,
        config: createBaseConfig(),
        errors: [],
        source: "global",
        globalPath: "/tmp/ralph-test-config.json",
        localPath: "/repo/.ralph-review/config.json",
        repoRoot: "/repo",
        globalExists: true,
        localExists: false,
        globalErrors: [],
        localErrors: [],
      }),
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["set", "--local", "defaultReview.type", "base"]);

    expect(harness.errors[0]).toContain("Updated configuration is invalid.");
    expect(harness.errors[0]).toContain(
      'defaultReview.branch must be a non-empty string when defaultReview.type is "base".'
    );
    expect(harness.savedOverrides).toHaveLength(0);
    expect(harness.exits).toEqual([1]);
  });

  test("legacy loadConfig overrides still receive configPath for effective reads", async () => {
    const printed: string[] = [];
    const errors: string[] = [];
    const exits: number[] = [];
    const loadCalls: string[] = [];
    const configPath = "/tmp/legacy-config.json";
    const runConfig = createRunConfig({
      configPath,
      cwd: () => "/repo/project",
      loadConfig: async (path = configPath) => {
        loadCalls.push(path);
        return path === configPath ? createBaseConfig() : null;
      },
      print: (value) => {
        printed.push(value);
      },
      log: {
        success: () => {},
        warn: () => {},
        error: (message) => {
          errors.push(message);
        },
      },
      exit: (code) => {
        exits.push(code);
      },
    });

    await runConfig(["get", "reviewer.agent"]);

    expect(loadCalls).toEqual([configPath]);
    expect(printed).toEqual(["codex"]);
    expect(errors).toEqual([]);
    expect(exits).toEqual([]);
  });

  test("createRunConfig default deps call process exit on failure", async () => {
    const runConfigWithDefaults = createRunConfig();
    const originalExit = process.exit;
    const originalError = p.log.error;
    process.exit = ((code?: number) => {
      throw new Error(`forced-exit:${code}`);
    }) as typeof process.exit;
    p.log.error = () => {};

    try {
      await expect(runConfigWithDefaults(["wizard"])).rejects.toThrow("forced-exit:1");
    } finally {
      process.exit = originalExit;
      p.log.error = originalError;
    }
  });

  test("runConfig export uses default implementation", async () => {
    const errors: string[] = [];
    const originalExit = process.exit;
    const originalError = p.log.error;
    process.exit = ((code?: number) => {
      throw new Error(`forced-exit:${code}`);
    }) as typeof process.exit;
    p.log.error = (message) => {
      errors.push(message);
    };

    try {
      await expect(runConfig(["wizard"])).rejects.toThrow("forced-exit:1");
    } finally {
      process.exit = originalExit;
      p.log.error = originalError;
    }

    expect(errors.some((message) => message.includes("Unknown config subcommand"))).toBe(true);
  });

  test("createRunConfig can use default logger methods for success, warn, and error", async () => {
    const messages = {
      success: [] as string[],
      warn: [] as string[],
      error: [] as string[],
    };
    const originalSuccess = p.log.success;
    const originalWarn = p.log.warn;
    const originalError = p.log.error;
    p.log.success = (message) => {
      messages.success.push(message);
    };
    p.log.warn = (message) => {
      messages.warn.push(message);
    };
    p.log.error = (message) => {
      messages.error.push(message);
    };

    try {
      const runWithDefaultLog = createRunConfig({
        configPath: "/tmp/ralph-default-log-config.json",
        configExists: async () => true,
        ensureConfigDir: async () => {},
        loadConfig: async () => createBaseConfig(),
        parseConfig: (value) => parseConfig(value),
        saveConfig: async () => {},
        spawn: (() => ({ exited: Promise.resolve(0) })) as ConfigCommandDeps["spawn"],
        env: {
          EDITOR: "vim",
          SHELL: "/bin/zsh",
        },
        print: () => {},
        exit: () => {},
      });

      await runWithDefaultLog(["set", "maxIterations", "8"]);
      await runWithDefaultLog(["wizard"]);

      const runWithWarnDefaultLog = createRunConfig({
        configPath: "/tmp/ralph-default-log-config.json",
        configExists: async () => false,
        ensureConfigDir: async () => {},
        loadConfig: async () => createBaseConfig(),
        parseConfig: (value) => parseConfig(value),
        saveConfig: async () => {},
        spawn: (() => ({ exited: Promise.resolve(0) })) as ConfigCommandDeps["spawn"],
        env: {
          EDITOR: "vim",
          SHELL: "/bin/zsh",
        },
        print: () => {},
        exit: () => {},
      });

      await runWithWarnDefaultLog(["edit"]);
    } finally {
      p.log.success = originalSuccess;
      p.log.warn = originalWarn;
      p.log.error = originalError;
    }

    expect(
      messages.success.some((message) => message.includes('Updated "maxIterations" to 8.'))
    ).toBe(true);
    expect(messages.warn.some((message) => message.includes("No config file was saved"))).toBe(
      true
    );
    expect(messages.error.some((message) => message.includes("Unknown config subcommand"))).toBe(
      true
    );
  });

  test("createRunConfig can use default print method", async () => {
    const output: string[] = [];
    const originalLog = console.log;
    console.log = ((message?: unknown) => {
      output.push(String(message));
    }) as typeof console.log;

    try {
      const runWithDefaultPrint = createRunConfig({
        configPath: "/tmp/ralph-default-print-config.json",
        configExists: async () => true,
        ensureConfigDir: async () => {},
        loadConfig: async () => createBaseConfig(),
        parseConfig: (value) => parseConfig(value),
        saveConfig: async () => {},
        spawn: (() => ({ exited: Promise.resolve(0) })) as ConfigCommandDeps["spawn"],
        env: {
          EDITOR: "vim",
          SHELL: "/bin/zsh",
        },
        exit: () => {},
      });

      await runWithDefaultPrint(["get", "reviewer.agent"]);
    } finally {
      console.log = originalLog;
    }

    expect(output).toEqual(["codex"]);
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

  test("edit --local derives parent directory from Windows-style local config path", async () => {
    const ensureConfigDirCalls: string[] = [];
    const harness = createCommandHarness({
      resolveRepoConfigPath: async () => ({
        repoRoot: "C:\\repo",
        path: "C:\\repo\\.ralph-review\\config.json",
      }),
      ensureConfigDir: async (dir = "") => {
        ensureConfigDirCalls.push(dir);
      },
      configExists: async () => false,
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["edit", "--local"]);

    expect(ensureConfigDirCalls).toEqual(["C:\\repo\\.ralph-review"]);
    expect(harness.exits).toEqual([]);
  });

  test("edit warns when saved config is invalid", async () => {
    const harness = createCommandHarness({
      loadConfigWithDiagnostics: async () => ({
        exists: true,
        config: null,
        errors: [
          "run.watch is not supported. Available settings: run.simplifier, run.interactive.",
        ],
      }),
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["edit"]);

    expect(harness.warnings[0]).toContain("Invalid configuration: /tmp/ralph-test-config.json");
    expect(harness.warnings[0]).toContain(
      "- run.watch is not supported. Available settings: run.simplifier, run.interactive."
    );
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

  test("edit --global warns when the edited global config breaks the effective repo config", async () => {
    const harness = createCommandHarness({
      loadConfigWithDiagnostics: async () => ({
        exists: true,
        config: createBaseConfig(),
        errors: [],
      }),
      loadEffectiveConfigWithDiagnostics: async () => ({
        exists: true,
        config: null,
        errors: ["Effective configuration is invalid.", "run.simplifier must be a boolean."],
        source: "merged",
        globalPath: "/tmp/ralph-test-config.json",
        localPath: "/repo/.ralph-review/config.json",
        repoRoot: "/repo",
        globalExists: true,
        localExists: true,
        globalErrors: [],
        localErrors: [],
      }),
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["edit", "--global"]);

    expect(harness.warnings[0]).toContain("Invalid effective configuration.");
    expect(harness.warnings[0]).toContain("- run.simplifier must be a boolean.");
    expect(harness.saved).toHaveLength(0);
    expect(harness.exits).toEqual([]);
  });

  test("edit --local saves overrides when a valid repo-local config masks global parse errors", async () => {
    const localConfig = {
      ...createBaseConfig(),
      maxIterations: 8,
    };
    const harness = createCommandHarness({
      loadConfig: async () => createBaseConfig(),
      loadEffectiveConfigWithDiagnostics: async () => ({
        exists: true,
        config: localConfig,
        errors: [
          "Invalid global config at /tmp/ralph-test-config.json: Invalid JSON syntax: Unexpected token",
        ],
        source: "local",
        globalPath: "/tmp/ralph-test-config.json",
        localPath: "/repo/.ralph-review/config.json",
        repoRoot: "/repo",
        globalExists: true,
        localExists: true,
        globalErrors: ["Invalid JSON syntax: Unexpected token"],
        localErrors: [],
      }),
      buildConfigOverride: (_baseConfig, config) => ({
        maxIterations: config.maxIterations,
      }),
    });
    const runConfig = createRunConfig(harness.deps);

    await runConfig(["edit", "--local"]);

    expect(harness.saved).toHaveLength(0);
    expect(harness.savedOverrides).toEqual([{ maxIterations: 8 }]);
    expect(harness.savedOverridePaths).toEqual(["/repo/.ralph-review/config.json"]);
    expect(harness.warnings).toEqual([]);
    expect(harness.exits).toEqual([]);
  });
});
