import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  clearCapabilityReviewCache,
  parseCodexDebugModelsOutput,
  parseDroidExecHelpOutput,
  parsePiListModelsOutput,
  reviewAgentCapabilities,
} from "@/lib/diagnostics";

type SpawnProcess = ReturnType<typeof Bun.spawn>;

let originalSpawn: typeof Bun.spawn;
let originalWhich: typeof Bun.which;

function createTextStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function createMockProcess(
  stdout: ReadableStream<Uint8Array> | null,
  stderr: ReadableStream<Uint8Array> | null,
  exitCode: number,
  onKill?: () => void
): SpawnProcess {
  return {
    stdout,
    stderr,
    exited: Promise.resolve(exitCode),
    kill: () => {
      onKill?.();
      return true;
    },
  } as unknown as SpawnProcess;
}

function createDynamicAvailability() {
  return {
    codex: false,
    claude: false,
    droid: false,
    gemini: false,
    opencode: true,
    pi: true,
  } as const;
}

function createCodexDebugModelsOutput(): string {
  return JSON.stringify({
    models: [
      {
        slug: "gpt-5.4",
        display_name: "GPT-5.4",
        supported_reasoning_levels: [
          { effort: "low" },
          { effort: "medium" },
          { effort: "high" },
          { effort: "xhigh" },
          { effort: "invalid" },
        ],
      },
      {
        slug: "codex-auto-review",
        display_name: "Codex Auto Review",
        supported_reasoning_levels: [{ effort: "high" }],
      },
      {
        slug: "gpt-5.4",
        display_name: "Duplicate",
        supported_reasoning_levels: [{ effort: "low" }],
      },
      {
        slug: "gpt-5.4-mini",
        display_name: " ",
        supported_reasoning_levels: [{ effort: "medium" }],
      },
    ],
  });
}

describe("diagnostics capabilities", () => {
  beforeEach(() => {
    originalSpawn = Bun.spawn;
    originalWhich = Bun.which;
    clearCapabilityReviewCache();
  });

  afterEach(() => {
    Bun.spawn = originalSpawn;
    Bun.which = originalWhich;
  });

  test("uses dynamic probes for opencode and pi when available", async () => {
    const capabilities = await reviewAgentCapabilities({
      availabilityOverride: createDynamicAvailability(),
      deps: {
        fetchOpencodeModels: async () => [{ value: "gpt-5.2-codex", label: "gpt-5.2-codex" }],
        fetchPiModels: async () => [{ provider: "anthropic", model: "claude-opus-4-6" }],
      },
    });

    expect(capabilities.opencode.modelCatalogSource).toBe("dynamic");
    expect(capabilities.opencode.models).toEqual([{ model: "gpt-5.2-codex" }]);
    expect(capabilities.pi.modelCatalogSource).toBe("dynamic");
    expect(capabilities.pi.models).toEqual([{ provider: "anthropic", model: "claude-opus-4-6" }]);
  });

  test("marks probe warning when dynamic model review fails", async () => {
    const capabilities = await reviewAgentCapabilities({
      availabilityOverride: {
        ...createDynamicAvailability(),
        opencode: true,
        pi: false,
      },
      deps: {
        fetchOpencodeModels: async () => {
          throw new Error("failed to list models");
        },
      },
    });

    expect(capabilities.opencode.modelCatalogSource).toBe("none");
    expect(capabilities.opencode.probeWarnings.length).toBeGreaterThan(0);
  });

  test("uses dynamic probes for codex and droid", async () => {
    let codexProbeCalls = 0;
    let droidProbeCalls = 0;
    Bun.spawn = ((args) => {
      const command = Array.isArray(args) ? args[0] : args.cmd[0];
      if (command === "codex") {
        codexProbeCalls += 1;
        expect(args).toEqual(["codex", "debug", "models"]);
        return createMockProcess(
          createTextStream(createCodexDebugModelsOutput()),
          createTextStream(""),
          0
        );
      }

      droidProbeCalls += 1;
      expect(args).toEqual(["droid", "exec", "--help"]);
      return createMockProcess(
        createTextStream(
          [
            "Usage: droid exec [options] [prompt]",
            "",
            "Available Models:",
            "  gpt-5.4                      GPT-5.4",
            "  claude-opus-4-7              Claude Opus 4.7 (default)",
            "",
            "Model details:",
            "  - GPT-5.4: supports reasoning: Yes; supported: [low, medium, high, xhigh]; default: medium",
            "  - Claude Opus 4.7: supports reasoning: Yes; supported: [off, low, medium, high, xhigh, max]; default: high",
          ].join("\n")
        ),
        createTextStream(""),
        0
      );
    }) as typeof Bun.spawn;

    const capabilities = await reviewAgentCapabilities({
      availabilityOverride: {
        codex: true,
        droid: true,
        claude: false,
        gemini: false,
        opencode: false,
        pi: false,
      },
    });

    expect(codexProbeCalls).toBe(1);
    expect(droidProbeCalls).toBe(1);
    expect(capabilities.codex.modelCatalogSource).toBe("dynamic");
    expect(capabilities.codex.models).toEqual([
      { model: "gpt-5.4", label: "GPT-5.4" },
      { model: "gpt-5.4-mini", label: "gpt-5.4-mini" },
    ]);
    expect(capabilities.droid.modelCatalogSource).toBe("dynamic");
    expect(capabilities.droid.models).toEqual([
      { model: "gpt-5.4", label: "GPT-5.4" },
      { model: "claude-opus-4-7", label: "Claude Opus 4.7" },
    ]);
  });

  test("reuses in-memory cache between calls", async () => {
    let calls = 0;

    const options = {
      availabilityOverride: {
        ...createDynamicAvailability(),
        opencode: true,
        pi: false,
      },
      deps: {
        fetchOpencodeModels: async () => {
          calls += 1;
          return [{ value: "gpt-5.2", label: "gpt-5.2" }];
        },
      },
    };

    await reviewAgentCapabilities(options);
    await reviewAgentCapabilities(options);

    expect(calls).toBe(1);
  });

  test("bypasses cache when forceRefresh is true", async () => {
    let calls = 0;
    const options = {
      availabilityOverride: {
        ...createDynamicAvailability(),
        pi: false,
      },
      deps: {
        fetchOpencodeModels: async () => {
          calls += 1;
          return [{ value: "gpt-5.2", label: "gpt-5.2" }];
        },
      },
    };

    await reviewAgentCapabilities(options);
    await reviewAgentCapabilities(options);
    await reviewAgentCapabilities({
      ...options,
      forceRefresh: true,
    });

    expect(calls).toBe(2);
  });

  test("discovers opencode models from probe output and filters info lines", async () => {
    let spawnCalls = 0;
    Bun.spawn = ((args) => {
      spawnCalls += 1;
      expect(args).toEqual(["opencode", "models"]);
      return createMockProcess(
        createTextStream("INFO loading\n\n gpt-5.2-codex \nINFO done\ngpt-5.3-codex\n"),
        createTextStream(""),
        0
      );
    }) as typeof Bun.spawn;

    const capabilities = await reviewAgentCapabilities({
      availabilityOverride: {
        ...createDynamicAvailability(),
        pi: false,
      },
    });

    expect(spawnCalls).toBe(1);
    expect(capabilities.opencode.modelCatalogSource).toBe("dynamic");
    expect(capabilities.opencode.models).toEqual([
      { model: "gpt-5.2-codex" },
      { model: "gpt-5.3-codex" },
    ]);
  });

  test("returns timeout warning when opencode probe times out", async () => {
    let killed = false;
    const originalSetTimeout = globalThis.setTimeout;
    Bun.spawn = ((args) => {
      expect(args).toEqual(["opencode", "models"]);
      return createMockProcess(
        createTextStream("partial output"),
        createTextStream("probe interrupted"),
        0,
        () => {
          killed = true;
        }
      );
    }) as typeof Bun.spawn;
    globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
      const handler = args[0];
      if (typeof handler === "function") {
        handler();
      }
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;

    try {
      const capabilities = await reviewAgentCapabilities({
        availabilityOverride: {
          ...createDynamicAvailability(),
          pi: false,
        },
      });

      expect(killed).toBe(true);
      expect(capabilities.opencode.modelCatalogSource).toBe("none");
      expect(capabilities.opencode.probeWarnings[0]).toContain("probe timed out after 8000ms");
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });

  test("returns fallback message when droid probe exits non-zero without stderr", async () => {
    Bun.spawn = ((args) => {
      expect(args).toEqual(["droid", "exec", "--help"]);
      return createMockProcess(createTextStream(""), createTextStream("   "), 3);
    }) as typeof Bun.spawn;

    const capabilities = await reviewAgentCapabilities({
      availabilityOverride: {
        codex: false,
        claude: false,
        droid: true,
        gemini: false,
        opencode: false,
        pi: false,
      },
    });

    expect(capabilities.droid.modelCatalogSource).toBe("none");
    expect(capabilities.droid.models).toEqual([]);
    expect(capabilities.droid.probeWarnings[0]).toContain("droid exec --help exited with code 3");
  });

  test("warns when droid help returns no parseable models", async () => {
    Bun.spawn = ((args) => {
      expect(args).toEqual(["droid", "exec", "--help"]);
      return createMockProcess(
        createTextStream("Usage: droid exec [options] [prompt]\n\nModel details:\n"),
        createTextStream(""),
        0
      );
    }) as typeof Bun.spawn;

    const capabilities = await reviewAgentCapabilities({
      availabilityOverride: {
        codex: false,
        claude: false,
        droid: true,
        gemini: false,
        opencode: false,
        pi: false,
      },
    });

    expect(capabilities.droid.modelCatalogSource).toBe("none");
    expect(capabilities.droid.models).toEqual([]);
    expect(capabilities.droid.probeWarnings).toEqual([
      "No models were returned by `droid exec --help`.",
    ]);
  });

  test("returns fallback message when pi probe exits non-zero without stderr", async () => {
    Bun.spawn = ((args) => {
      expect(args).toEqual(["pi", "--list-models"]);
      return createMockProcess(createTextStream(""), createTextStream("   "), 3);
    }) as typeof Bun.spawn;

    const capabilities = await reviewAgentCapabilities({
      availabilityOverride: {
        ...createDynamicAvailability(),
        opencode: false,
      },
    });

    expect(capabilities.pi.modelCatalogSource).toBe("none");
    expect(capabilities.pi.probeWarnings[0]).toContain("pi --list-models exited with code 3");
  });

  test("discovers pi models from probe output when pi probe succeeds", async () => {
    Bun.spawn = ((args) => {
      expect(args).toEqual(["pi", "--list-models"]);
      return createMockProcess(
        createTextStream(
          [
            "provider   model                              context  max-out",
            "anthropic  claude-sonnet-4-5                 200K     64K",
            "llm-proxy  gemini_cli/gemini-3-pro-preview   1M       64K",
          ].join("\n")
        ),
        createTextStream(""),
        0
      );
    }) as typeof Bun.spawn;

    const capabilities = await reviewAgentCapabilities({
      availabilityOverride: {
        ...createDynamicAvailability(),
        opencode: false,
      },
    });

    expect(capabilities.pi.modelCatalogSource).toBe("dynamic");
    expect(capabilities.pi.models).toEqual([
      { provider: "anthropic", model: "claude-sonnet-4-5" },
      { provider: "llm-proxy", model: "gemini_cli/gemini-3-pro-preview" },
    ]);
    expect(capabilities.pi.probeWarnings).toEqual([]);
  });

  test("discovers pi models when pi writes the model table to stderr", async () => {
    Bun.spawn = ((args) => {
      expect(args).toEqual(["pi", "--list-models"]);
      return createMockProcess(
        createTextStream(""),
        createTextStream(
          [
            "Warning: EPERM creating lockfile",
            "provider  model                                       context  max-out  thinking  images",
            "google    gemini-2.5-pro                              1.0M     65.5K    yes       yes",
            "proxx     openai/gpt-5.4                              272K     128K     yes       yes",
          ].join("\n")
        ),
        0
      );
    }) as typeof Bun.spawn;

    const capabilities = await reviewAgentCapabilities({
      availabilityOverride: {
        ...createDynamicAvailability(),
        opencode: false,
      },
    });

    expect(capabilities.pi.modelCatalogSource).toBe("dynamic");
    expect(capabilities.pi.models).toEqual([
      { provider: "google", model: "gemini-2.5-pro" },
      { provider: "proxx", model: "openai/gpt-5.4" },
    ]);
    expect(capabilities.pi.probeWarnings).toEqual([]);
  });

  test("parses droid help model listing and ignores model detail rows", () => {
    const parsed = parseDroidExecHelpOutput(
      [
        "Usage: droid exec [options] [prompt]",
        "",
        "Available Models:",
        "  claude-opus-4-7              Claude Opus 4.7 (default)",
        "  gpt-5.4                      GPT-5.4",
        "  gpt-5.4                      GPT-5.4 Duplicate",
        "  glm-4.7                      Droid Core (GLM-4.7) [Deprecated]",
        "  gpt-5.1-codex-max            GPT-5.1-Codex-Max [Deprecated]",
        "",
        "Model details:",
        "  - Claude Opus 4.7: supports reasoning: Yes; supported: [off, low, medium, high, xhigh, max]; default: high",
        "  - GPT-5.4: supports reasoning: Yes; supported: [low, medium, high, xhigh]; default: medium",
        "  - Droid Core (GLM-4.7) [Deprecated]: supports reasoning: No; supported: [none]; default: none",
        "  - GPT-5.1-Codex-Max [Deprecated]: supports reasoning: Yes; supported: [low, medium, high, xhigh]; default: medium",
      ].join("\n")
    );

    expect(parsed.models).toEqual([
      { value: "claude-opus-4-7", label: "Claude Opus 4.7" },
      { value: "gpt-5.4", label: "GPT-5.4" },
      { value: "glm-4.7", label: "Droid Core (GLM-4.7) [Deprecated]" },
      { value: "gpt-5.1-codex-max", label: "GPT-5.1-Codex-Max [Deprecated]" },
    ]);
    expect(parsed.reasoningByModel).toEqual({
      "claude-opus-4-7": ["low", "medium", "high", "xhigh", "max"],
      "gpt-5.4": ["low", "medium", "high", "xhigh"],
      "glm-4.7": [],
      "gpt-5.1-codex-max": ["low", "medium", "high", "xhigh"],
    });
  });

  test("skips dynamic probes when probeAgents excludes opencode and pi", async () => {
    let codexProbeCalls = 0;
    let opencodeProbeCalls = 0;
    let piProbeCalls = 0;

    const capabilities = await reviewAgentCapabilities({
      availabilityOverride: {
        ...createDynamicAvailability(),
        codex: true,
      },
      probeAgents: ["codex"],
      deps: {
        fetchCodexModels: async () => {
          codexProbeCalls += 1;
          return { models: [{ value: "gpt-5.4", label: "GPT-5.4" }], reasoningByModel: {} };
        },
        fetchOpencodeModels: async () => {
          opencodeProbeCalls += 1;
          return [{ value: "unused", label: "unused" }];
        },
        fetchPiModels: async () => {
          piProbeCalls += 1;
          return [{ provider: "unused", model: "unused" }];
        },
      },
    });

    expect(codexProbeCalls).toBe(1);
    expect(opencodeProbeCalls).toBe(0);
    expect(piProbeCalls).toBe(0);
    expect(capabilities.codex.modelCatalogSource).toBe("dynamic");
    expect(capabilities.opencode.modelCatalogSource).toBe("none");
    expect(capabilities.opencode.models).toEqual([]);
    expect(capabilities.opencode.probeWarnings).toEqual([]);
    expect(capabilities.pi.modelCatalogSource).toBe("none");
    expect(capabilities.pi.models).toEqual([]);
    expect(capabilities.pi.probeWarnings).toEqual([]);
  });

  test("skips codex probe when probeAgents excludes codex", async () => {
    let codexProbeCalls = 0;

    const capabilities = await reviewAgentCapabilities({
      availabilityOverride: {
        ...createDynamicAvailability(),
        codex: true,
        opencode: false,
        pi: false,
      },
      probeAgents: ["droid"],
      deps: {
        fetchCodexModels: async () => {
          codexProbeCalls += 1;
          return { models: [{ value: "unused", label: "unused" }], reasoningByModel: {} };
        },
      },
    });

    expect(codexProbeCalls).toBe(0);
    expect(capabilities.codex.modelCatalogSource).toBe("none");
    expect(capabilities.codex.models).toEqual([]);
    expect(capabilities.codex.probeWarnings).toEqual([]);
  });

  test("uses Bun.which when availability override is omitted", async () => {
    let whichCalls = 0;
    Bun.which = ((command) => {
      whichCalls += 1;
      return command === "codex" ? "/usr/local/bin/codex" : null;
    }) as typeof Bun.which;
    Bun.spawn = ((args) => {
      expect(args).toEqual(["codex", "debug", "models"]);
      return createMockProcess(createTextStream(""), createTextStream("failed"), 2);
    }) as typeof Bun.spawn;

    const capabilities = await reviewAgentCapabilities();

    expect(whichCalls).toBeGreaterThan(0);
    expect(capabilities.codex.installed).toBe(true);
    expect(capabilities.codex.modelCatalogSource).toBe("none");
    expect(capabilities.opencode.installed).toBe(false);
    expect(capabilities.pi.installed).toBe(false);
  });

  test("returns warning when codex probe exits non-zero", async () => {
    Bun.spawn = ((args) => {
      expect(args).toEqual(["codex", "debug", "models"]);
      return createMockProcess(createTextStream(""), createTextStream("failed"), 2);
    }) as typeof Bun.spawn;

    const capabilities = await reviewAgentCapabilities({
      availabilityOverride: {
        codex: true,
        claude: false,
        droid: false,
        gemini: false,
        opencode: false,
        pi: false,
      },
    });

    expect(capabilities.codex.modelCatalogSource).toBe("none");
    expect(capabilities.codex.models).toEqual([]);
    expect(capabilities.codex.probeWarnings[0]).toContain("failed");
  });

  test("warns when codex debug models returns no usable models", async () => {
    Bun.spawn = ((args) => {
      expect(args).toEqual(["codex", "debug", "models"]);
      return createMockProcess(
        createTextStream(JSON.stringify({ models: [{ slug: "codex-auto-review" }] })),
        createTextStream(""),
        0
      );
    }) as typeof Bun.spawn;

    const capabilities = await reviewAgentCapabilities({
      availabilityOverride: {
        codex: true,
        claude: false,
        droid: false,
        gemini: false,
        opencode: false,
        pi: false,
      },
    });

    expect(capabilities.codex.modelCatalogSource).toBe("none");
    expect(capabilities.codex.models).toEqual([]);
    expect(capabilities.codex.probeWarnings).toEqual([
      "No models were returned by `codex debug models`.",
    ]);
  });

  test("parses codex debug models output and supported reasoning levels", () => {
    const parsed = parseCodexDebugModelsOutput(createCodexDebugModelsOutput());

    expect(parsed.models).toEqual([
      { value: "gpt-5.4", label: "GPT-5.4" },
      { value: "gpt-5.4-mini", label: "gpt-5.4-mini" },
    ]);
    expect(parsed.reasoningByModel).toEqual({
      "gpt-5.4": ["low", "medium", "high", "xhigh"],
      "gpt-5.4-mini": ["medium"],
    });
  });

  test("rejects invalid codex debug models output", () => {
    expect(() => parseCodexDebugModelsOutput("{")).toThrow(
      "Invalid JSON from `codex debug models`."
    );
    expect(() => parseCodexDebugModelsOutput(JSON.stringify({ models: {} }))).toThrow(
      "`codex debug models` output did not include a models array."
    );
  });

  test("parses pi model listings and ignores invalid and duplicate rows", () => {
    const parsed = parsePiListModelsOutput(
      [
        "",
        "provider   model                              context  max-out",
        "provider-only",
        "anthropic  claude-sonnet-4-5                 200K     64K",
        "anthropic  claude-sonnet-4-5                 200K     64K",
        "llm-proxy  gemini_cli/gemini-3-pro-preview   1M       64K",
        " ",
      ].join("\n")
    );

    expect(parsed).toEqual([
      { provider: "anthropic", model: "claude-sonnet-4-5" },
      { provider: "llm-proxy", model: "gemini_cli/gemini-3-pro-preview" },
    ]);
  });

  test("ignores preamble lines before the pi model table header", () => {
    const parsed = parsePiListModelsOutput(
      [
        "Warning: (startup session lookup) EPERM creating lockfile",
        "provider  model                                       context  max-out  thinking  images",
        "google    gemini-2.5-pro                              1.0M     65.5K    yes       yes",
        "proxx     openai/gpt-5.4                              272K     128K     yes       yes",
      ].join("\n")
    );

    expect(parsed).toEqual([
      { provider: "google", model: "gemini-2.5-pro" },
      { provider: "proxx", model: "openai/gpt-5.4" },
    ]);
  });
});
