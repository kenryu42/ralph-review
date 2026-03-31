import { validateConfigInvariants } from "@/commands/config-model";
import type {
  configExists,
  EffectiveConfigDiagnostics,
  loadConfigOverrideWithDiagnostics,
  loadConfigWithDiagnostics,
  loadEffectiveConfigWithDiagnostics,
  resolveRepoConfigPath,
} from "@/lib/config";
import { loadConfigDisplayLayers } from "@/lib/config-layers";
import type { Config, ConfigOverride } from "@/lib/types";

type ConfigCommandRuntimeDeps = {
  configPath: string;
  cwd: () => string;
  resolveRepoConfigPath: typeof resolveRepoConfigPath;
  configExists: typeof configExists;
  loadConfigOverrideWithDiagnostics: typeof loadConfigOverrideWithDiagnostics;
  loadEffectiveConfigWithDiagnostics: typeof loadEffectiveConfigWithDiagnostics;
  loadConfigWithDiagnostics: typeof loadConfigWithDiagnostics;
};

export function getEffectiveConfigErrorHeader(loaded: EffectiveConfigDiagnostics): string {
  const hasLocalErrors = loaded.localErrors.length > 0;
  const hasGlobalErrors = loaded.globalErrors.length > 0;

  if (hasLocalErrors && !hasGlobalErrors && loaded.localPath) {
    return `Invalid repo-local configuration: ${loaded.localPath}`;
  }

  if (hasGlobalErrors && !hasLocalErrors) {
    return `Invalid configuration: ${loaded.globalPath}`;
  }

  if (loaded.source === "local" && loaded.localPath) {
    return `Invalid repo-local configuration: ${loaded.localPath}`;
  }

  if (loaded.source === "global") {
    return `Invalid configuration: ${loaded.globalPath}`;
  }

  return "Invalid effective configuration.";
}

export function formatConfigValidationMessage(
  header: string,
  errors: string[],
  footer?: string
): string {
  const uniqueErrors = [...new Set(errors)];
  const lines = [header];
  for (const error of uniqueErrors) {
    lines.push(`- ${error}`);
  }
  if (footer) {
    lines.push(footer);
  }
  return lines.join("\n");
}

export function collectConfigValidationErrors(config: Config | null, errors: string[]): string[] {
  const combined = [...errors];
  if (config) {
    combined.push(...validateConfigInvariants(config));
  }
  return [...new Set(combined)];
}

export function collectEffectiveConfigValidationErrors(
  loaded: EffectiveConfigDiagnostics
): string[] {
  const combined = loaded.config ? [] : [...loaded.errors];
  if (loaded.config) {
    combined.push(...validateConfigInvariants(loaded.config));
  }
  return [...new Set(combined)];
}

export async function resolveLocalConfigPathOrThrow(
  deps: ConfigCommandRuntimeDeps
): Promise<string> {
  const resolved = await deps.resolveRepoConfigPath(deps.cwd());
  if (!resolved) {
    throw new Error("Cannot use --local outside a git repository.");
  }

  return resolved.path;
}

export async function loadExistingRawConfig(
  path: string,
  deps: ConfigCommandRuntimeDeps
): Promise<Config> {
  if (!(await deps.configExists(path))) {
    throw new Error('Configuration not found. Run "rr init" first.');
  }

  const loaded = await deps.loadConfigWithDiagnostics(path);
  if (!loaded.exists) {
    throw new Error('Configuration not found. Run "rr init" first.');
  }

  const errors = collectConfigValidationErrors(loaded.config, loaded.errors);
  if (!loaded.config || errors.length > 0) {
    throw new Error(
      formatConfigValidationMessage(
        `Invalid configuration: ${path}`,
        errors.length > 0 ? errors : ["Configuration format is invalid."],
        'Run "rr init" to regenerate the file, or fix it manually.'
      )
    );
  }

  return loaded.config;
}

export async function loadExistingEffectiveConfig(deps: ConfigCommandRuntimeDeps): Promise<Config> {
  const loaded = await deps.loadEffectiveConfigWithDiagnostics(deps.cwd());
  if (!loaded.exists) {
    throw new Error('Configuration not found. Run "rr init" first.');
  }

  const errors = collectEffectiveConfigValidationErrors(loaded);
  if (!loaded.config || errors.length > 0) {
    throw new Error(
      formatConfigValidationMessage(
        getEffectiveConfigErrorHeader(loaded),
        errors.length > 0 ? errors : ["Configuration format is invalid."],
        'Run "rr init" to regenerate the file, or fix it manually.'
      )
    );
  }

  return loaded.config;
}

export async function loadExistingRawOverride(
  path: string,
  deps: ConfigCommandRuntimeDeps
): Promise<ConfigOverride> {
  if (!(await deps.configExists(path))) {
    throw new Error('Configuration not found. Run "rr init" and choose Repo-local config first.');
  }

  const loaded = await deps.loadConfigOverrideWithDiagnostics(path);
  if (!loaded.exists) {
    throw new Error('Configuration not found. Run "rr init" and choose Repo-local config first.');
  }

  if (!loaded.config || loaded.errors.length > 0) {
    throw new Error(
      formatConfigValidationMessage(
        `Invalid repo-local configuration: ${path}`,
        loaded.errors.length > 0 ? loaded.errors : ["Configuration format is invalid."],
        'Run "rr init" and choose Repo-local config to regenerate the file, or fix it manually.'
      )
    );
  }

  return loaded.config;
}

export async function loadExistingConfig(deps: ConfigCommandRuntimeDeps): Promise<Config> {
  return await loadExistingRawConfig(deps.configPath, deps);
}

export async function loadDisplayLayers(deps: ConfigCommandRuntimeDeps) {
  const layers = await loadConfigDisplayLayers(deps.cwd(), {
    loadEffectiveConfigWithDiagnostics: deps.loadEffectiveConfigWithDiagnostics,
    loadConfigWithDiagnostics: deps.loadConfigWithDiagnostics,
    loadConfigOverrideWithDiagnostics: deps.loadConfigOverrideWithDiagnostics,
  });
  const { effective } = layers;
  if (!effective.exists) {
    throw new Error('Configuration not found. Run "rr init" first.');
  }

  const errors = collectEffectiveConfigValidationErrors(effective);
  if (!effective.config || errors.length > 0) {
    throw new Error(
      formatConfigValidationMessage(
        getEffectiveConfigErrorHeader(effective),
        errors.length > 0 ? errors : ["Configuration format is invalid."],
        'Run "rr init" to regenerate the file, or fix it manually.'
      )
    );
  }

  return layers;
}
