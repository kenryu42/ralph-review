import { describe, expect, test } from "bun:test";
import { loadConfigDisplayLayers } from "@/lib/config-layers";
import { CONFIG_SCHEMA_URI, CONFIG_VERSION, type Config, type ConfigOverride } from "@/lib/types";

const baseConfig: Config = {
  $schema: CONFIG_SCHEMA_URI,
  version: CONFIG_VERSION,
  reviewer: { agent: "codex", model: "gpt-5.3-codex", reasoning: "high" },
  fixer: { agent: "claude", model: "claude-opus-4-6", reasoning: "medium" },
  "code-simplifier": { agent: "droid", model: "gpt-5.2-codex", reasoning: "low" },
  run: { simplifier: false, interactive: true },
  maxIterations: 5,
  iterationTimeout: 1800000,
  defaultReview: { type: "uncommitted" },
  notifications: { sound: { enabled: true } },
};

describe("config layers", () => {
  test("loads effective, global, and local diagnostics using effective paths", async () => {
    const calls: string[] = [];
    const localOverride: ConfigOverride = {
      run: { simplifier: true },
    };

    const layers = await loadConfigDisplayLayers("/repo/project", {
      loadEffectiveConfigWithDiagnostics: async (projectPath) => {
        calls.push(`effective:${projectPath}`);
        return {
          exists: true,
          source: "merged",
          config: baseConfig,
          errors: [],
          globalPath: "/tmp/global.json",
          localPath: "/repo/.ralph-review/config.json",
          repoRoot: "/repo",
          globalExists: true,
          localExists: true,
          globalErrors: [],
          localErrors: [],
        };
      },
      loadConfigWithDiagnostics: async (path) => {
        calls.push(`global:${path}`);
        return {
          exists: true,
          config: baseConfig,
          errors: [],
        };
      },
      loadConfigOverrideWithDiagnostics: async (path) => {
        calls.push(`local:${path}`);
        return {
          exists: true,
          path,
          config: localOverride,
          errors: [],
        };
      },
    });

    expect(layers.effective.source).toBe("merged");
    expect(layers.globalConfig.config).toEqual(baseConfig);
    expect(layers.localConfig?.config).toEqual(localOverride);
    expect(calls).toEqual([
      "effective:/repo/project",
      "global:/tmp/global.json",
      "local:/repo/.ralph-review/config.json",
    ]);
  });

  test("does not load local diagnostics when there is no repo-local path", async () => {
    const calls: string[] = [];

    const layers = await loadConfigDisplayLayers("/project", {
      loadEffectiveConfigWithDiagnostics: async (projectPath) => {
        calls.push(`effective:${projectPath}`);
        return {
          exists: true,
          source: "global",
          config: baseConfig,
          errors: [],
          globalPath: "/tmp/global.json",
          localPath: null,
          repoRoot: null,
          globalExists: true,
          localExists: false,
          globalErrors: [],
          localErrors: [],
        };
      },
      loadConfigWithDiagnostics: async (path) => {
        calls.push(`global:${path}`);
        return {
          exists: true,
          config: baseConfig,
          errors: [],
        };
      },
      loadConfigOverrideWithDiagnostics: async (path) => {
        calls.push(`local:${path}`);
        return {
          exists: false,
          path,
          config: null,
          errors: [],
        };
      },
    });

    expect(layers.localConfig).toBeNull();
    expect(calls).toEqual(["effective:/project", "global:/tmp/global.json"]);
  });
});
