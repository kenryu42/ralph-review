import { describe, expect, test } from "bun:test";
import {
  buildAutoInitInput,
  buildConfig,
  checkAgentInstalled,
  checkAllAgents,
  checkTmuxInstalled,
  createInitRuntime,
  discoverAutoModelCandidates,
  getRoleAgentPriorityRank,
  getRoleModelPriorityRank,
  type InitRuntimeOverrides,
  pickAutoRoleCandidate,
  runInit,
  runInitWithRuntime,
  selectAutoReasoning,
  validateAgentSelection,
} from "@/commands/init";
import type { AgentCapabilitiesMap } from "@/lib/diagnostics";
import { type AgentType, CONFIG_SCHEMA_URI, CONFIG_VERSION, type Config } from "@/lib/types";

const CANCEL = Symbol("cancel");

type CapabilityOverrides = Partial<{
  [K in AgentType]: Partial<AgentCapabilitiesMap[K]>;
}>;

function createCapabilities(overrides: CapabilityOverrides = {}): AgentCapabilitiesMap {
  return {
    codex: {
      agent: "codex",
      command: "codex",
      installed: true,
      modelCatalogSource: "static",
      models: [{ model: "gpt-5.3-codex" }],
      probeWarnings: [],
      ...overrides.codex,
    },
    claude: {
      agent: "claude",
      command: "claude",
      installed: true,
      modelCatalogSource: "static",
      models: [{ model: "claude-opus-4-6" }],
      probeWarnings: [],
      ...overrides.claude,
    },
    droid: {
      agent: "droid",
      command: "droid",
      installed: true,
      modelCatalogSource: "static",
      models: [{ model: "gpt-5.2-codex" }],
      probeWarnings: [],
      ...overrides.droid,
    },
    gemini: {
      agent: "gemini",
      command: "gemini",
      installed: true,
      modelCatalogSource: "static",
      models: [{ model: "gemini-3-pro-preview" }],
      probeWarnings: [],
      ...overrides.gemini,
    },
    opencode: {
      agent: "opencode",
      command: "opencode",
      installed: true,
      modelCatalogSource: "dynamic",
      models: [{ model: "gpt-5.3-codex" }],
      probeWarnings: [],
      ...overrides.opencode,
    },
    pi: {
      agent: "pi",
      command: "pi",
      installed: true,
      modelCatalogSource: "dynamic",
      models: [{ provider: "anthropic", model: "claude-opus-4-6" }],
      probeWarnings: [],
      ...overrides.pi,
    },
  };
}

function createExistingConfigWithPi(): Config {
  return {
    $schema: CONFIG_SCHEMA_URI,
    version: CONFIG_VERSION,
    reviewer: {
      agent: "pi",
      provider: "llm-proxy",
      model: "gemini_cli/gemini-3-flash-preview",
      reasoning: "high",
    },
    fixer: {
      agent: "claude",
      model: "claude-opus-4-6",
      reasoning: "medium",
    },
    "code-simplifier": {
      agent: "droid",
      model: "gpt-5.2-codex",
      reasoning: "low",
    },
    run: { simplifier: false, watch: true },
    maxIterations: 4,
    iterationTimeout: 1200000,
    defaultReview: { type: "base", branch: "main" },
    notifications: { sound: { enabled: true } },
  };
}

function createAvailability(
  overrides: Partial<Record<AgentType, boolean>> = {}
): Record<AgentType, boolean> {
  return {
    codex: false,
    claude: false,
    droid: false,
    gemini: false,
    opencode: false,
    pi: false,
    ...overrides,
  };
}

interface InitHarnessOptions {
  selectResponses?: unknown[];
  confirmResponses?: unknown[];
  textResponses?: unknown[];
  configExists?: boolean;
  existingConfig?: Config | null;
  tmuxInstalled?: boolean;
  availability?: Record<AgentType, boolean>;
  capabilities?: AgentCapabilitiesMap;
  discoverAgentCapabilities?: InitRuntimeOverrides["discoverAgentCapabilities"];
}

function createInitHarness(options: InitHarnessOptions = {}) {
  const selectQueue = [...(options.selectResponses ?? [])];
  const confirmQueue = [...(options.confirmResponses ?? [])];
  const textQueue = [...(options.textResponses ?? [])];

  const intros: string[] = [];
  const outros: string[] = [];
  const cancels: string[] = [];
  const infos: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const messages: string[] = [];
  const successes: string[] = [];
  const exits: number[] = [];
  const spinnerStarts: string[] = [];
  const spinnerStops: string[] = [];
  const textCalls: Array<{
    message: string;
    defaultValue?: string;
    placeholder?: string;
    validate?: (value: string | undefined) => string | Error | undefined;
  }> = [];
  const discoverCalls: Array<{
    probeAgents?: AgentType[];
    cacheNamespace?: string;
  }> = [];
  const savedConfigs: Config[] = [];
  let ensureConfigDirCalls = 0;

  const next = (queue: unknown[], label: string): unknown => {
    const value = queue.shift();
    if (value === undefined) {
      throw new Error(`missing ${label} response`);
    }
    return value;
  };

  const defaultAvailability = {
    codex: true,
    claude: false,
    droid: false,
    gemini: false,
    opencode: false,
    pi: false,
  } satisfies Record<AgentType, boolean>;

  const overrides: InitRuntimeOverrides = {
    prompt: {
      intro: (message) => {
        intros.push(message);
      },
      outro: (message) => {
        outros.push(message);
      },
      cancel: (message) => {
        cancels.push(message);
      },
      isCancel: (value) => value === CANCEL,
      select: async (input) => {
        return next(selectQueue, `select(${input.message})`);
      },
      confirm: async (input) => {
        return next(confirmQueue, `confirm(${input.message})`);
      },
      text: async (input) => {
        textCalls.push({
          message: input.message,
          defaultValue: input.defaultValue,
          placeholder: input.placeholder,
          validate: input.validate,
        });
        return next(textQueue, `text(${input.message})`);
      },
      spinner: () => ({
        start: (message) => {
          spinnerStarts.push(message);
        },
        stop: (message) => {
          spinnerStops.push(message);
        },
      }),
      log: {
        info: (message) => {
          infos.push(message);
        },
        warn: (message) => {
          warnings.push(message);
        },
        error: (message) => {
          errors.push(message);
        },
        message: (message) => {
          messages.push(message);
        },
        success: (message) => {
          successes.push(message);
        },
      },
    },
    configExists: async () => options.configExists ?? false,
    loadConfig: async () => options.existingConfig ?? null,
    ensureConfigDir: async () => {
      ensureConfigDirCalls += 1;
    },
    saveConfig: async (config) => {
      savedConfigs.push(config);
    },
    discoverAgentCapabilities:
      options.discoverAgentCapabilities ??
      (async (input = {}) => {
        discoverCalls.push({
          probeAgents: input.probeAgents,
          cacheNamespace: input.cacheNamespace,
        });
        return options.capabilities ?? createCapabilities();
      }),
    checkTmuxInstalled: () => options.tmuxInstalled ?? true,
    checkAllAgents: () => options.availability ?? defaultAvailability,
    getTmuxInstallHint: () => "brew install tmux",
    exit: ((code: number) => {
      exits.push(code);
      throw new Error(`forced-exit:${code}`);
    }) as InitRuntimeOverrides["exit"],
  };

  return {
    overrides,
    intros,
    outros,
    cancels,
    infos,
    warnings,
    errors,
    messages,
    successes,
    exits,
    spinnerStarts,
    spinnerStops,
    textCalls,
    discoverCalls,
    savedConfigs,
    get ensureConfigDirCalls() {
      return ensureConfigDirCalls;
    },
  };
}

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
        runSimplifierByDefault: false,
        runWatchByDefault: true,
        soundNotificationsEnabled: false,
      });

      expect(config.$schema).toBe(CONFIG_SCHEMA_URI);
      expect(config.version).toBe(CONFIG_VERSION);
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
      expect(config.run).toEqual({ simplifier: false, watch: true });
      expect(config.notifications.sound.enabled).toBe(false);
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
        runSimplifierByDefault: true,
        runWatchByDefault: false,
        soundNotificationsEnabled: true,
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
      expect(config.notifications.sound.enabled).toBe(true);
    });

    test("throws when pi settings are missing provider", () => {
      expect(() =>
        buildConfig({
          reviewerAgent: "pi",
          reviewerModel: "claude-opus-4-6",
          fixerAgent: "codex",
          fixerModel: "gpt-5.3-codex",
          simplifierAgent: "codex",
          simplifierModel: "gpt-5.3-codex",
          maxIterations: 3,
          iterationTimeoutMinutes: 10,
          defaultReviewType: "uncommitted",
          runSimplifierByDefault: false,
          runWatchByDefault: true,
          soundNotificationsEnabled: true,
        })
      ).toThrow("Pi agent requires provider and model");
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
        runSimplifierByDefault: false,
        runWatchByDefault: true,
        soundNotificationsEnabled: false,
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
        runSimplifierByDefault: false,
        runWatchByDefault: true,
        soundNotificationsEnabled: false,
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

    test("fixer model priority matches claude, codex, and gemini in order", () => {
      expect(getRoleModelPriorityRank("fixer", "claude-opus-4-6")).toBe(0);
      expect(getRoleModelPriorityRank("fixer", "provider/gpt-5.3-codex")).toBe(1);
      expect(getRoleModelPriorityRank("fixer", "gemini-3-pro-preview")).toBe(2);
      expect(getRoleModelPriorityRank("fixer", "unknown-model")).toBe(3);
    });

    test("simplifier model priority matches opus 4.6, codex, opus 4.5 family, then gpt-5.2 codex", () => {
      expect(getRoleModelPriorityRank("code-simplifier", "claude-opus-4-6")).toBe(0);
      expect(getRoleModelPriorityRank("code-simplifier", "gpt-5.3-codex")).toBe(1);
      expect(getRoleModelPriorityRank("code-simplifier", "claude-opus-4-5-20251101")).toBe(2);
      expect(getRoleModelPriorityRank("code-simplifier", "gpt-5.2-codex")).toBe(3);
      expect(getRoleModelPriorityRank("code-simplifier", "unknown-model")).toBe(4);
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

    test("returns null when there are no candidates", () => {
      const selected = pickAutoRoleCandidate("reviewer", []);
      expect(selected).toBeNull();
    });

    test("breaks fully tied unknown candidates by agent name", () => {
      const selected = pickAutoRoleCandidate("reviewer", [
        {
          agent: "pi",
          model: "unknown-model",
          modelOrder: 0,
          probeOrder: 0,
        },
        {
          agent: "opencode",
          model: "unknown-model",
          modelOrder: 0,
          probeOrder: 0,
        },
      ]);

      expect(selected).not.toBeNull();
      expect(selected?.agent).toBe("opencode");
    });

    test("breaks fully tied same-agent unknown candidates by model name", () => {
      const selected = pickAutoRoleCandidate("reviewer", [
        {
          agent: "opencode",
          model: "zzz-model",
          modelOrder: 0,
          probeOrder: 0,
        },
        {
          agent: "opencode",
          model: "aaa-model",
          modelOrder: 0,
          probeOrder: 0,
        },
      ]);

      expect(selected).not.toBeNull();
      expect(selected?.model).toBe("aaa-model");
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
      expect(result.input.runSimplifierByDefault).toBe(false);
      expect(result.input.runWatchByDefault).toBe(true);
      expect(result.input.soundNotificationsEnabled).toBe(true);
      expect(result.input.maxIterations).toBeGreaterThan(0);
      expect(result.input.iterationTimeoutMinutes).toBeGreaterThan(0);
    });

    test("throws when automatic setup cannot determine all roles", async () => {
      const availability = {
        codex: true,
        claude: false,
        droid: false,
        gemini: false,
        opencode: false,
        pi: false,
      } satisfies Record<AgentType, boolean>;

      await expect(
        buildAutoInitInput(availability, {
          capabilitiesByAgent: createCapabilities({
            codex: { models: [] },
          }),
        })
      ).rejects.toThrow("Automatic setup could not determine reviewer/fixer/simplifier");
    });
  });

  describe("runInitWithRuntime", () => {
    test("createInitRuntime applies prompt and dependency overrides", async () => {
      const infos: string[] = [];
      const runtime = createInitRuntime({
        prompt: {
          log: {
            info: (message) => {
              infos.push(message);
            },
          },
        },
        configExists: async () => false,
      });

      runtime.prompt.log.info("hello");
      expect(infos).toEqual(["hello"]);
      await expect(runtime.configExists()).resolves.toBe(false);
    });

    test("shows existing config and cancels when overwrite is declined", async () => {
      const harness = createInitHarness({
        configExists: true,
        existingConfig: createExistingConfigWithPi(),
        confirmResponses: [false],
      });

      await runInitWithRuntime(harness.overrides);

      expect(harness.intros).toEqual(["Ralph Review Setup"]);
      expect(harness.infos[0]).toContain("Current configuration:");
      expect(harness.infos[0]).toContain("llm-proxy/gemini_cli/gemini-3-flash-preview");
      expect(harness.cancels).toEqual(["Setup cancelled."]);
      expect(harness.savedConfigs).toHaveLength(0);
      expect(harness.ensureConfigDirCalls).toBe(0);
      expect(harness.spinnerStarts).toHaveLength(0);
      expect(harness.outros).toHaveLength(0);
      expect(harness.successes).toHaveLength(0);
    });

    test("cancels when overwrite is declined and existing config cannot be loaded", async () => {
      const harness = createInitHarness({
        configExists: true,
        existingConfig: null,
        confirmResponses: [false],
      });

      await runInitWithRuntime(harness.overrides);

      expect(harness.cancels).toEqual(["Setup cancelled."]);
      expect(harness.infos).toHaveLength(0);
      expect(harness.savedConfigs).toHaveLength(0);
      expect(harness.ensureConfigDirCalls).toBe(0);
      expect(harness.spinnerStarts).toHaveLength(0);
      expect(harness.outros).toHaveLength(0);
      expect(harness.successes).toHaveLength(0);
    });

    test("exits with error when no supported agents are installed", async () => {
      const harness = createInitHarness({
        availability: createAvailability(),
      });

      await expect(runInitWithRuntime(harness.overrides)).rejects.toThrow("forced-exit:1");
      expect(harness.errors[0]).toContain("No supported agents are installed.");
      expect(harness.exits).toEqual([1]);
    });

    test("runs auto setup, warns for tmux and skipped agents, then saves config", async () => {
      const harness = createInitHarness({
        tmuxInstalled: false,
        availability: createAvailability({ codex: true, opencode: true }),
        capabilities: createCapabilities({
          opencode: {
            models: [],
            probeWarnings: ["OpenCode probe timed out"],
          },
          pi: {
            models: [],
            probeWarnings: [],
          },
        }),
        selectResponses: ["auto"],
        confirmResponses: [true, true, true],
      });

      await runInitWithRuntime(harness.overrides);

      expect(harness.warnings[0]).toContain("tmux is not installed.");
      expect(harness.warnings.some((entry) => entry.includes("Skipped agents"))).toBe(true);
      expect(harness.messages).toContain("  OpenCode probe timed out");
      expect(harness.spinnerStarts).toContain(
        "Detecting installed models and building automatic configuration..."
      );
      expect(harness.spinnerStops).toContain("Automatic configuration ready");
      expect(harness.savedConfigs).toHaveLength(1);
      expect(harness.ensureConfigDirCalls).toBe(1);
      expect(harness.successes[0]).toContain("Configuration saved to");
      expect(harness.outros).toEqual(["You can now run: rr run"]);
    });

    test("exits when auto capability discovery fails", async () => {
      const harness = createInitHarness({
        availability: createAvailability({ codex: true }),
        selectResponses: ["auto"],
        discoverAgentCapabilities: async () => {
          throw new Error("boom");
        },
      });

      await expect(runInitWithRuntime(harness.overrides)).rejects.toThrow("forced-exit:1");
      expect(harness.spinnerStops).toContain("Automatic setup failed");
      expect(harness.errors.some((entry) => entry.includes("boom"))).toBe(true);
      expect(harness.exits).toEqual([1]);
    });

    test("exits when auto build cannot pick all roles", async () => {
      const harness = createInitHarness({
        availability: createAvailability({ codex: true }),
        selectResponses: ["auto"],
        capabilities: createCapabilities({
          codex: { models: [] },
        }),
      });

      await expect(runInitWithRuntime(harness.overrides)).rejects.toThrow("forced-exit:1");
      expect(
        harness.errors.some((entry) =>
          entry.includes("Automatic setup could not determine reviewer/fixer/simplifier")
        )
      ).toBe(true);
      expect(harness.exits).toEqual([1]);
    });

    test("runs custom setup with base branch and saves selected values", async () => {
      const harness = createInitHarness({
        availability: createAvailability({ codex: true, claude: true, droid: true }),
        capabilities: createCapabilities(),
        selectResponses: [
          "custom",
          "codex",
          "gpt-5.3-codex",
          "high",
          "claude",
          "claude-opus-4-6",
          "medium",
          "droid",
          "gpt-5.2-codex",
          "low",
          "base",
        ],
        textResponses: ["7", "15", "develop"],
        confirmResponses: [true, true, false, true],
      });

      await runInitWithRuntime(harness.overrides);

      expect(harness.savedConfigs).toHaveLength(1);
      expect(harness.ensureConfigDirCalls).toBe(1);
      expect(harness.savedConfigs[0]?.defaultReview).toEqual({ type: "base", branch: "develop" });
      expect(harness.savedConfigs[0]?.run?.simplifier).toBe(true);
      expect(harness.savedConfigs[0]?.run?.watch).toBe(true);
      expect(harness.savedConfigs[0]?.notifications.sound.enabled).toBe(false);
      expect(harness.savedConfigs[0]?.maxIterations).toBe(7);
      expect(harness.savedConfigs[0]?.iterationTimeout).toBe(15 * 60 * 1000);

      const maxValidate = harness.textCalls[0]?.validate;
      const timeoutValidate = harness.textCalls[1]?.validate;
      const branchValidate = harness.textCalls[2]?.validate;
      expect(maxValidate?.("")).toBeUndefined();
      expect(maxValidate?.("0")).toBe("Must be a positive number");
      expect(timeoutValidate?.("not-a-number")).toBe("Must be a positive number");
      expect(timeoutValidate?.("12")).toBeUndefined();
      expect(branchValidate?.("   ")).toBe("Branch name is required");
      expect(branchValidate?.("main")).toBeUndefined();
    });

    test("runs custom setup with gemini and leaves reasoning unset", async () => {
      const harness = createInitHarness({
        availability: createAvailability({ gemini: true }),
        capabilities: createCapabilities(),
        selectResponses: [
          "custom",
          "gemini",
          "gemini-3-pro-preview",
          "gemini",
          "gemini-3-flash-preview",
          "gemini",
          "gemini-3-pro-preview",
          "uncommitted",
        ],
        textResponses: ["4", "12"],
        confirmResponses: [false, true, true, true],
      });

      await runInitWithRuntime(harness.overrides);

      expect(harness.savedConfigs).toHaveLength(1);
      expect(harness.savedConfigs[0]?.reviewer.reasoning).toBeUndefined();
      expect(harness.savedConfigs[0]?.fixer.reasoning).toBeUndefined();
      expect(harness.savedConfigs[0]?.["code-simplifier"]?.reasoning).toBeUndefined();
    });

    test("probes opencode models in custom mode and handles cancel", async () => {
      const harness = createInitHarness({
        availability: createAvailability({ opencode: true }),
        selectResponses: ["custom", "opencode", "open-model", CANCEL],
        discoverAgentCapabilities: async (input = {}) => {
          if (input.cacheNamespace === "init-custom-opencode") {
            return createCapabilities({
              opencode: {
                models: [{ model: "open-model" }],
              },
            });
          }
          return createCapabilities({
            opencode: { models: [] },
          });
        },
      });

      await expect(runInitWithRuntime(harness.overrides)).rejects.toThrow("forced-exit:0");
      expect(harness.spinnerStarts).toContain("Fetching OpenCode models...");
      expect(harness.spinnerStops).toContain("Models loaded");
      expect(harness.cancels).toContain("Setup cancelled.");
      expect(harness.exits).toContain(0);
    });

    test("exits when opencode probe fails in custom mode", async () => {
      const harness = createInitHarness({
        availability: createAvailability({ opencode: true }),
        selectResponses: ["custom", "opencode"],
        discoverAgentCapabilities: async (input = {}) => {
          if (input.cacheNamespace === "init-custom-opencode") {
            throw new Error("probe failed");
          }
          return createCapabilities({
            opencode: { models: [] },
          });
        },
      });

      await expect(runInitWithRuntime(harness.overrides)).rejects.toThrow("forced-exit:1");
      expect(harness.spinnerStops).toContain("Failed to load models");
      expect(harness.errors.some((entry) => entry.includes("probe failed"))).toBe(true);
      expect(harness.exits).toContain(1);
    });

    test("exits when dynamic probe returns no capability entry", async () => {
      const harness = createInitHarness({
        availability: createAvailability({ opencode: true }),
        selectResponses: ["custom", "opencode"],
        discoverAgentCapabilities: async (input = {}) => {
          if (input.cacheNamespace === "init-custom-opencode") {
            return {} as unknown as AgentCapabilitiesMap;
          }
          return createCapabilities({
            opencode: { models: [] },
          });
        },
      });

      await expect(runInitWithRuntime(harness.overrides)).rejects.toThrow("forced-exit:1");
      expect(harness.errors).toContain("Unable to inspect OpenCode capabilities.");
      expect(harness.exits).toContain(1);
    });

    test("exits and logs probe warnings when dynamic agent has no models", async () => {
      const harness = createInitHarness({
        availability: createAvailability({ opencode: true }),
        selectResponses: ["custom", "opencode"],
        discoverAgentCapabilities: async (input = {}) => {
          if (input.cacheNamespace === "init-custom-opencode") {
            return createCapabilities({
              opencode: {
                models: [],
                probeWarnings: ["No catalog was returned"],
              },
            });
          }
          return createCapabilities({
            opencode: { models: [] },
          });
        },
      });

      await expect(runInitWithRuntime(harness.overrides)).rejects.toThrow("forced-exit:1");
      expect(harness.errors).toContain("No models available from OpenCode.");
      expect(harness.messages).toContain("  No catalog was returned");
      expect(harness.exits).toContain(1);
    });

    test("exits when pi dynamic results have no provider values", async () => {
      const harness = createInitHarness({
        availability: createAvailability({ pi: true }),
        selectResponses: ["custom", "pi"],
        discoverAgentCapabilities: async (input = {}) => {
          if (input.cacheNamespace === "init-custom-pi") {
            return createCapabilities({
              pi: {
                models: [{ model: "provider-missing" }],
              },
            });
          }
          return createCapabilities({
            pi: { models: [] },
          });
        },
      });

      await expect(runInitWithRuntime(harness.overrides)).rejects.toThrow("forced-exit:1");
      expect(harness.errors).toContain("No provider/model entries were discovered for Pi.");
      expect(harness.exits).toContain(1);
    });

    test("exits when pi selection cannot be decoded", async () => {
      const harness = createInitHarness({
        availability: createAvailability({ pi: true }),
        selectResponses: ["custom", "pi", "not-json"],
        discoverAgentCapabilities: async (input = {}) => {
          if (input.cacheNamespace === "init-custom-pi") {
            return createCapabilities({
              pi: {
                models: [{ provider: "anthropic", model: "claude-opus-4-6" }],
              },
            });
          }
          return createCapabilities({
            pi: { models: [] },
          });
        },
      });

      await expect(runInitWithRuntime(harness.overrides)).rejects.toThrow("forced-exit:1");
      expect(harness.errors).toContain("Invalid Pi model selection");
      expect(harness.exits).toContain(1);
    });

    test("exits when pi selection has blank provider", async () => {
      const harness = createInitHarness({
        availability: createAvailability({ pi: true }),
        capabilities: createCapabilities(),
        selectResponses: [
          "custom",
          "pi",
          JSON.stringify({ provider: " ", model: "claude-opus-4-6" }),
        ],
      });

      await expect(runInitWithRuntime(harness.overrides)).rejects.toThrow("forced-exit:1");
      expect(harness.errors).toContain("Invalid Pi model selection");
      expect(harness.exits).toContain(1);
    });

    test("exits when pi selection has non-string provider/model", async () => {
      const harness = createInitHarness({
        availability: createAvailability({ pi: true }),
        capabilities: createCapabilities(),
        selectResponses: [
          "custom",
          "pi",
          JSON.stringify({ provider: 123, model: "claude-opus-4-6" }),
        ],
      });

      await expect(runInitWithRuntime(harness.overrides)).rejects.toThrow("forced-exit:1");
      expect(harness.errors).toContain("Invalid Pi model selection");
      expect(harness.exits).toContain(1);
    });

    test("runs custom setup with pi models and saves provider/model selections", async () => {
      const harness = createInitHarness({
        availability: createAvailability({ pi: true }),
        capabilities: createCapabilities(),
        selectResponses: [
          "custom",
          "pi",
          JSON.stringify({ provider: "anthropic", model: "claude-opus-4-6" }),
          "high",
          "pi",
          JSON.stringify({ provider: "anthropic", model: "claude-opus-4-6" }),
          "medium",
          "pi",
          JSON.stringify({ provider: "anthropic", model: "claude-opus-4-6" }),
          "low",
          "uncommitted",
        ],
        textResponses: ["3", "10"],
        confirmResponses: [false, true, true, true],
      });

      await runInitWithRuntime(harness.overrides);

      const saved = harness.savedConfigs[0];
      expect(saved).toBeDefined();
      expect(saved?.reviewer).toEqual({
        agent: "pi",
        provider: "anthropic",
        model: "claude-opus-4-6",
        reasoning: "high",
      });
      expect(saved?.fixer).toEqual({
        agent: "pi",
        provider: "anthropic",
        model: "claude-opus-4-6",
        reasoning: "medium",
      });
      expect(saved?.["code-simplifier"]).toEqual({
        agent: "pi",
        provider: "anthropic",
        model: "claude-opus-4-6",
        reasoning: "low",
      });
      expect(saved?.notifications.sound.enabled).toBe(true);
    });

    test("cancels after proposed config when save is declined", async () => {
      const harness = createInitHarness({
        availability: createAvailability({ codex: true }),
        capabilities: createCapabilities(),
        selectResponses: ["auto"],
        confirmResponses: [true, true, false],
      });

      await runInitWithRuntime(harness.overrides);

      expect(harness.cancels).toContain("Setup cancelled.");
      expect(harness.savedConfigs).toHaveLength(0);
      expect(harness.ensureConfigDirCalls).toBe(0);
    });

    test("exits with cancel code when setup mode prompt is cancelled", async () => {
      const harness = createInitHarness({
        availability: createAvailability({ codex: true }),
        selectResponses: [CANCEL],
      });

      await expect(runInitWithRuntime(harness.overrides)).rejects.toThrow("forced-exit:0");
      expect(harness.cancels).toContain("Setup cancelled.");
      expect(harness.exits).toContain(0);
    });

    test("logs invalid setup mode and missing setup input", async () => {
      const errors: string[] = [];
      const exits: number[] = [];
      let exitCount = 0;

      await expect(
        runInitWithRuntime({
          prompt: {
            intro: () => {},
            outro: () => {},
            cancel: () => {},
            isCancel: () => false,
            select: async () => "invalid-mode",
            confirm: async () => true,
            text: async () => "main",
            spinner: () => ({
              start: () => {},
              stop: () => {},
            }),
            log: {
              info: () => {},
              warn: () => {},
              error: (message) => {
                errors.push(message);
              },
              message: () => {},
              success: () => {},
            },
          },
          configExists: async () => false,
          checkTmuxInstalled: () => true,
          checkAllAgents: () => createAvailability({ codex: true }),
          discoverAgentCapabilities: async () => createCapabilities(),
          ensureConfigDir: async () => {},
          saveConfig: async () => {},
          exit: ((code: number) => {
            exits.push(code);
            exitCount += 1;
            if (exitCount >= 2) {
              throw new Error(`forced-exit:${code}`);
            }
          }) as InitRuntimeOverrides["exit"],
        })
      ).rejects.toThrow("forced-exit:1");

      expect(errors).toContain("Invalid setup mode selection");
      expect(errors).toContain("Setup input could not be created");
      expect(exits).toEqual([1, 1]);
    });
  });

  describe("runInit", () => {
    test("uses injected runtime overrides and completes setup", async () => {
      const harness = createInitHarness({
        availability: createAvailability({ codex: true }),
        capabilities: createCapabilities(),
        selectResponses: ["auto"],
        confirmResponses: [true, true, true],
      });

      await runInit(harness.overrides);

      expect(harness.intros).toEqual(["Ralph Review Setup"]);
      expect(harness.savedConfigs).toHaveLength(1);
      expect(harness.successes[0]).toContain("Configuration saved to");
      expect(harness.outros).toContain("You can now run: rr run");
    });
  });
});
