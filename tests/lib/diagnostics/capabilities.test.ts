import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  clearCapabilityDiscoveryCache,
  discoverAgentCapabilities,
  parsePiListModelsOutput,
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

describe("diagnostics capabilities", () => {
  beforeEach(() => {
    originalSpawn = Bun.spawn;
    originalWhich = Bun.which;
    clearCapabilityDiscoveryCache();
  });

  afterEach(() => {
    Bun.spawn = originalSpawn;
    Bun.which = originalWhich;
  });

  test("uses dynamic probes for opencode and pi when available", async () => {
    const capabilities = await discoverAgentCapabilities({
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

  test("marks probe warning when dynamic model discovery fails", async () => {
    const capabilities = await discoverAgentCapabilities({
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

  test("falls back to static catalog for non-dynamic agents", async () => {
    const capabilities = await discoverAgentCapabilities({
      availabilityOverride: {
        codex: true,
        claude: false,
        droid: false,
        gemini: false,
        opencode: false,
        pi: false,
      },
    });

    expect(capabilities.codex.modelCatalogSource).toBe("static");
    expect(capabilities.codex.models.some((entry) => entry.model === "gpt-5.3-codex")).toBe(true);
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

    await discoverAgentCapabilities(options);
    await discoverAgentCapabilities(options);

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

    await discoverAgentCapabilities(options);
    await discoverAgentCapabilities(options);
    await discoverAgentCapabilities({
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

    const capabilities = await discoverAgentCapabilities({
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
      const capabilities = await discoverAgentCapabilities({
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

  test("returns fallback message when pi probe exits non-zero without stderr", async () => {
    Bun.spawn = ((args) => {
      expect(args).toEqual(["pi", "--list-models"]);
      return createMockProcess(createTextStream(""), createTextStream("   "), 3);
    }) as typeof Bun.spawn;

    const capabilities = await discoverAgentCapabilities({
      availabilityOverride: {
        ...createDynamicAvailability(),
        opencode: false,
      },
    });

    expect(capabilities.pi.modelCatalogSource).toBe("none");
    expect(capabilities.pi.probeWarnings[0]).toContain("pi --list-models exited with code 3");
  });

  test("skips dynamic probes when probeAgents excludes opencode and pi", async () => {
    let opencodeProbeCalls = 0;
    let piProbeCalls = 0;

    const capabilities = await discoverAgentCapabilities({
      availabilityOverride: createDynamicAvailability(),
      probeAgents: ["codex"],
      deps: {
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

    expect(opencodeProbeCalls).toBe(0);
    expect(piProbeCalls).toBe(0);
    expect(capabilities.opencode.modelCatalogSource).toBe("none");
    expect(capabilities.opencode.models).toEqual([]);
    expect(capabilities.opencode.probeWarnings).toEqual([]);
    expect(capabilities.pi.modelCatalogSource).toBe("none");
    expect(capabilities.pi.models).toEqual([]);
    expect(capabilities.pi.probeWarnings).toEqual([]);
  });

  test("uses Bun.which when availability override is omitted", async () => {
    let whichCalls = 0;
    Bun.which = ((command) => {
      whichCalls += 1;
      return command === "codex" ? "/usr/local/bin/codex" : null;
    }) as typeof Bun.which;

    const capabilities = await discoverAgentCapabilities();

    expect(whichCalls).toBeGreaterThan(0);
    expect(capabilities.codex.installed).toBe(true);
    expect(capabilities.codex.modelCatalogSource).toBe("static");
    expect(capabilities.opencode.installed).toBe(false);
    expect(capabilities.pi.installed).toBe(false);
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
});
