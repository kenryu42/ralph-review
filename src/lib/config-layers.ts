import {
  type EffectiveConfigDiagnostics,
  type LoadedConfigDiagnostics,
  type LoadedConfigOverrideDiagnostics,
  loadConfigOverrideWithDiagnostics,
  loadConfigWithDiagnostics,
  loadEffectiveConfigWithDiagnostics,
} from "@/lib/config";

export interface ConfigDisplayLayers {
  effective: EffectiveConfigDiagnostics;
  globalConfig: LoadedConfigDiagnostics;
  localConfig: LoadedConfigOverrideDiagnostics | null;
}

export interface LoadConfigDisplayLayersDeps {
  loadEffectiveConfigWithDiagnostics?: typeof loadEffectiveConfigWithDiagnostics;
  loadConfigWithDiagnostics?: typeof loadConfigWithDiagnostics;
  loadConfigOverrideWithDiagnostics?: typeof loadConfigOverrideWithDiagnostics;
}

export async function loadConfigDisplayLayers(
  projectPath: string,
  deps: LoadConfigDisplayLayersDeps = {}
): Promise<ConfigDisplayLayers> {
  const loadEffective =
    deps.loadEffectiveConfigWithDiagnostics ?? loadEffectiveConfigWithDiagnostics;
  const loadGlobal = deps.loadConfigWithDiagnostics ?? loadConfigWithDiagnostics;
  const loadLocal = deps.loadConfigOverrideWithDiagnostics ?? loadConfigOverrideWithDiagnostics;

  const effective = await loadEffective(projectPath);
  const globalConfig = await loadGlobal(effective.globalPath);
  const localConfig = effective.localPath ? await loadLocal(effective.localPath) : null;

  return {
    effective,
    globalConfig,
    localConfig,
  };
}
