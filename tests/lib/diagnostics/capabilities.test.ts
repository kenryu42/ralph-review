import { beforeEach, describe, expect, test } from "bun:test";
import {
  clearCapabilityDiscoveryCache,
  discoverAgentCapabilities,
  parsePiListModelsOutput,
} from "@/lib/diagnostics";

describe("diagnostics capabilities", () => {
  beforeEach(() => {
    clearCapabilityDiscoveryCache();
  });

  test("uses dynamic probes for opencode and pi when available", async () => {
    const capabilities = await discoverAgentCapabilities({
      availabilityOverride: {
        codex: false,
        claude: false,
        droid: false,
        gemini: false,
        opencode: true,
        pi: true,
      },
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
        codex: false,
        claude: false,
        droid: false,
        gemini: false,
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
        codex: false,
        claude: false,
        droid: false,
        gemini: false,
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

  test("parses pi model listings", () => {
    const parsed = parsePiListModelsOutput(
      [
        "provider   model                              context  max-out",
        "anthropic  claude-sonnet-4-5                 200K     64K",
        "llm-proxy  gemini_cli/gemini-3-pro-preview   1M       64K",
      ].join("\n")
    );

    expect(parsed).toEqual([
      { provider: "anthropic", model: "claude-sonnet-4-5" },
      { provider: "llm-proxy", model: "gemini_cli/gemini-3-pro-preview" },
    ]);
  });
});
