import { describe, expect, test } from "bun:test";
import type { EffectiveConfigDiagnostics, LoadedConfigOverrideDiagnostics } from "@/lib/config";
import { loadConfigDisplayLayers } from "@/lib/config-layers";
import type { ConfigOverride } from "@/lib/types";
import { baseConfig } from "../helpers/config";

function effectiveDiagnostics(
  overrides: Partial<EffectiveConfigDiagnostics> = {}
): EffectiveConfigDiagnostics {
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
    ...overrides,
  };
}

function globalDiagnostics() {
  return {
    exists: true,
    config: baseConfig,
    errors: [],
  };
}

function localDiagnostics(
  path: string,
  config: ConfigOverride | null
): LoadedConfigOverrideDiagnostics {
  return {
    exists: config !== null,
    path,
    config,
    errors: [],
  };
}

function createLayerDeps(
  calls: string[],
  effective: EffectiveConfigDiagnostics,
  localConfig: ConfigOverride | null
) {
  return {
    loadEffectiveConfigWithDiagnostics: async (projectPath: string | undefined) => {
      calls.push(`effective:${projectPath}`);
      return effective;
    },
    loadConfigWithDiagnostics: async (path: string | undefined) => {
      calls.push(`global:${path}`);
      return globalDiagnostics();
    },
    loadConfigOverrideWithDiagnostics: async (path: string | undefined) => {
      calls.push(`local:${path}`);
      return localDiagnostics(path ?? "", localConfig);
    },
  };
}

describe("config layers", () => {
  test("loads effective, global, and local diagnostics using effective paths", async () => {
    const calls: string[] = [];
    const localOverride: ConfigOverride = {
      maxIterations: 9,
    };

    const layers = await loadConfigDisplayLayers(
      "/repo/project",
      createLayerDeps(calls, effectiveDiagnostics(), localOverride)
    );

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

    const layers = await loadConfigDisplayLayers(
      "/project",
      createLayerDeps(
        calls,
        effectiveDiagnostics({
          source: "global",
          localPath: null,
          repoRoot: null,
          localExists: false,
        }),
        null
      )
    );

    expect(layers.localConfig).toBeNull();
    expect(calls).toEqual(["effective:/project", "global:/tmp/global.json"]);
  });
});
