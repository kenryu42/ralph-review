import { describe, expect, test } from "bun:test";
import {
  formatConfigLayersDisplay,
  formatConfigRawLayersDisplay,
  formatConfigSection,
  formatReadableConfigSection,
} from "@/lib/config-display";
import { CONFIG_SCHEMA_URI, CONFIG_VERSION } from "@/lib/types";
import { baseConfig } from "../helpers/config";

type EffectiveLayer = Parameters<typeof formatConfigLayersDisplay>[0];
type GlobalLayer = Parameters<typeof formatConfigLayersDisplay>[1];
type LocalLayer = NonNullable<Parameters<typeof formatConfigLayersDisplay>[2]>;

function effectiveLayer(overrides: Partial<EffectiveLayer> = {}): EffectiveLayer {
  return {
    exists: true,
    source: "merged",
    config: baseConfig,
    errors: [],
    globalPath: "/tmp/global.json",
    localPath: "/repo/.ralph-review/config.json",
    repoRoot: "/repo",
    globalExists: false,
    localExists: true,
    globalErrors: [],
    localErrors: [],
    ...overrides,
  };
}

function globalLayer(overrides: Partial<GlobalLayer> = {}): GlobalLayer {
  return {
    exists: false,
    config: null,
    errors: [],
    ...overrides,
  };
}

function localLayer(overrides: Partial<LocalLayer> = {}): LocalLayer {
  return {
    exists: true,
    path: "/repo/.ralph-review/config.json",
    config: { maxIterations: 9 },
    errors: [],
    ...overrides,
  };
}

describe("config display", () => {
  test("formats invalid sections with bullet errors", () => {
    expect(
      formatConfigSection({
        title: "Global config",
        path: "/tmp/global.json",
        config: null,
        errors: ["bad json", "missing reviewer"],
      })
    ).toBe(
      [
        "Global config",
        "Path: /tmp/global.json",
        "Invalid configuration:",
        "- bad json",
        "- missing reviewer",
      ].join("\n")
    );
  });

  test("formats missing sections with explicit not found text", () => {
    expect(
      formatConfigSection({
        title: "Repo-local config",
        path: "/repo/.ralph-review/config.json",
        config: null,
      })
    ).toBe(["Repo-local config", "Path: /repo/.ralph-review/config.json", "Not found."].join("\n"));
  });

  test("formats config sections with notes and serialized json", () => {
    expect(
      formatConfigSection({
        title: "Effective config",
        path: "/tmp/global.json",
        note: "Source: global",
        config: { maxIterations: 9 },
      })
    ).toBe(
      [
        "Effective config",
        "Path: /tmp/global.json",
        "Source: global",
        JSON.stringify({ maxIterations: 9 }, null, 2),
      ].join("\n")
    );
  });

  test("formats readable full config by section", () => {
    const output = formatReadableConfigSection({
      title: "Current configuration",
      path: "/tmp/global.json",
      config: baseConfig,
      mode: "full",
    });

    expect(output).toContain("Current configuration");
    expect(output).toContain("Path: /tmp/global.json");
    expect(output).toContain("Agents");
    expect(output).toContain("Reviewer:");
    expect(output).toContain("Limits");
    expect(output).toContain("Iteration timeout:");
    expect(output).toContain("30m");
    expect(output).toContain("Notifications");
    expect(output).not.toContain("Interactive Mode");
    expect(output).not.toContain("$schema");
    expect(output).not.toContain("version");
  });

  test("formats readable full config with metadata when requested", () => {
    const output = formatReadableConfigSection({
      title: "Current configuration",
      config: baseConfig,
      mode: "full",
      showMetadata: true,
    });

    expect(output).toContain("Metadata");
    expect(output).toContain(CONFIG_SCHEMA_URI);
    expect(output).toContain(`${CONFIG_VERSION}`);
  });

  test("formats readable repo-local overrides with only changed keys", () => {
    const output = formatReadableConfigSection({
      title: "Repo-local overrides",
      path: "/repo/.ralph-review/config.json",
      config: {
        maxIterations: 9,
        defaultReview: { type: "base", branch: "develop" },
      },
      mode: "override",
    });

    expect(output).toContain("Repo-local overrides");
    expect(output).toContain("Path: /repo/.ralph-review/config.json");
    expect(output).toContain("Limits");
    expect(output).toContain("Default review");
    expect(output).toContain("base branch (develop)");
    expect(output).not.toContain("Reviewer:");
    expect(output).not.toContain('"maxIterations"');
  });

  test("formats empty readable repo-local overrides explicitly", () => {
    const output = formatReadableConfigSection({
      title: "Repo-local overrides",
      path: "/repo/.ralph-review/config.json",
      config: {},
      mode: "override",
    });

    expect(output).toContain("Repo-local overrides");
    expect(output).toContain("No repo-local overrides.");
  });

  test("formats readable repo-local overrides with explicit section removals", () => {
    const output = formatReadableConfigSection({
      title: "Repo-local overrides",
      path: "/repo/.ralph-review/config.json",
      config: {
        retry: null,
      },
      mode: "override",
    });

    expect(output).toContain("Removed sections");
    expect(output).toContain("Retry: removed");
    expect(output).not.toContain("No repo-local overrides.");
  });

  test("formats readable repo-local overrides with agent, retry, notification, and metadata sections", () => {
    const output = formatReadableConfigSection({
      title: "Repo-local overrides",
      path: "/repo/.ralph-review/config.json",
      config: {
        $schema: CONFIG_SCHEMA_URI,
        version: CONFIG_VERSION,
        reviewer: { agent: "codex", reasoning: "medium" },
        fixer: { agent: "claude", model: "claude-opus-4-6" },
        iterationTimeout: 5000,
        retry: { maxRetries: 4, baseDelayMs: 250, maxDelayMs: 5000 },
        notifications: { sound: { enabled: false } },
      },
      mode: "override",
      showMetadata: true,
    });

    expect(output).toContain("Reviewer: Codex (Default, medium)");
    expect(output).toContain("Fixer: Claude (Claude Opus 4.6, default)");
    expect(output).toContain("Iteration timeout: 5,000 ms (5s)");
    expect(output).toContain("Retry");
    expect(output).toContain("Max retries: 4");
    expect(output).toContain("Base delay: 250 ms");
    expect(output).toContain("Max delay: 5000 ms");
    expect(output).toContain("Notifications");
    expect(output).toContain("Sound: disabled");
    expect(output).toContain("Metadata");
  });

  test("formats readable repo-local overrides for pi agents with inherited removals", () => {
    expect(
      formatReadableConfigSection({
        title: "Repo-local overrides",
        config: {
          reviewer: {
            agent: "pi",
            model: null,
            reasoning: null,
            provider: null,
          },
          fixer: {
            agent: "pi",
            model: "custom-model",
            reasoning: "high",
            provider: "acme",
          },
        },
        mode: "override",
      })
    ).toBe(
      [
        "Repo-local overrides",
        "",
        "Agents",
        "  Reviewer: Pi (inherited/inherited, default); model removed, reasoning removed, provider removed",
        "  Fixer: Pi (acme/custom-model, high)",
      ].join("\n")
    );
  });

  test("formats readable repo-local overrides without agent identity", () => {
    expect(
      formatReadableConfigSection({
        title: "Repo-local overrides",
        config: {
          reviewer: {
            model: "gpt-5.4",
            reasoning: "xhigh",
            provider: "openai",
          },
          maxIterations: 7,
        },
        mode: "override",
      })
    ).toBe(
      [
        "Repo-local overrides",
        "",
        "Agents",
        "  Reviewer: model gpt-5.4, reasoning xhigh, provider openai",
        "",
        "Limits",
        "  Max iterations: 7",
      ].join("\n")
    );
  });

  test("formats readable full config with retry settings", () => {
    const output = formatReadableConfigSection({
      title: "Current configuration",
      config: {
        ...baseConfig,
        retry: { maxRetries: 5, baseDelayMs: 2000, maxDelayMs: 60000 },
      },
      mode: "full",
    });

    expect(output).toContain("Retry");
    expect(output).toContain("Max retries: 5");
    expect(output).toContain("Base delay: 2000 ms");
    expect(output).toContain("Max delay: 60000 ms");
  });

  test("omits retry section in full mode when retry is not configured", () => {
    const output = formatReadableConfigSection({
      title: "Current configuration",
      config: baseConfig,
      mode: "full",
    });

    expect(output).not.toContain("Retry");
  });

  test("formats readable full config with hour timeout", () => {
    const output = formatReadableConfigSection({
      title: "Current configuration",
      config: {
        ...baseConfig,
        iterationTimeout: 7200000,
      },
      mode: "full",
    });

    expect(output).toContain("Iteration timeout: 7,200,000 ms (2h)");
  });

  test("formats readable override timeout without unit shorthand when not divisible", () => {
    const output = formatReadableConfigSection({
      title: "Repo-local overrides",
      config: {
        iterationTimeout: 5500,
      },
      mode: "override",
    });

    expect(output).toContain("Iteration timeout: 5,500 ms");
    expect(output).not.toContain("(5.5s)");
  });

  test("formats readable layered config without duplicating global json", () => {
    const output = formatConfigLayersDisplay(effectiveLayer(), globalLayer(), localLayer());

    expect(output).toContain("Effective config");
    expect(output).toContain("Source: global + repo-local");
    expect(output).toContain("Repo-local overrides");
    expect(output).toContain("Path: /repo/.ralph-review/config.json");
    expect(output).toContain("Limits");
    expect(output).not.toContain("Global config");
    expect(output).not.toContain('"reviewer"');
  });

  test("formats readable layered config for repo-local only source", () => {
    const output = formatConfigLayersDisplay(
      effectiveLayer({
        source: "local",
      }),
      globalLayer(),
      localLayer({
        config: {},
      })
    );

    expect(output).toContain("Source: repo-local only");
    expect(output).toContain("Repo-local overrides");
    expect(output).toContain("No repo-local overrides.");
  });

  test("formats readable layered config for global-only source", () => {
    const output = formatConfigLayersDisplay(
      effectiveLayer({
        source: "global",
        localPath: null,
        repoRoot: null,
        globalExists: true,
        localExists: false,
      }),
      globalLayer({
        exists: true,
        config: baseConfig,
      }),
      null
    );

    expect(output).toContain("Source: global");
    expect(output).not.toContain("Repo-local overrides");
  });

  test("falls back to missing readable effective config details when no config is available", () => {
    const output = formatConfigLayersDisplay(
      effectiveLayer({
        source: "none",
        config: null,
        localPath: null,
        repoRoot: null,
        localExists: false,
      }),
      globalLayer(),
      null
    );

    expect(output).toBe(["Effective config", "Path: /tmp/global.json", "Not found."].join("\n"));
  });

  test("formats raw layered config as JSON with missing global section", () => {
    const output = JSON.parse(
      formatConfigRawLayersDisplay(effectiveLayer({ source: "local" }), globalLayer(), localLayer())
    );

    expect(output).toEqual({
      effective: baseConfig,
      global: null,
      local: { maxIterations: 9 },
    });
  });

  test("formats raw global-only layered config as JSON", () => {
    const output = JSON.parse(
      formatConfigRawLayersDisplay(
        effectiveLayer({
          source: "global",
          localPath: null,
          repoRoot: null,
          globalExists: true,
          localExists: false,
        }),
        globalLayer({
          exists: true,
          config: baseConfig,
        }),
        null
      )
    );

    expect(output).toEqual({
      effective: baseConfig,
      global: baseConfig,
      local: null,
    });
  });
});
