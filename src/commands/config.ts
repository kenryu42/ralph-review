import * as p from "@clack/prompts";
import {
  getConfigValue,
  parseConfigKey,
  parseConfigUpdate,
  setConfigOverrideValue,
  setConfigValue,
} from "@/commands/config-model";
import {
  collectConfigValidationErrors,
  collectEffectiveConfigValidationErrors,
  formatConfigValidationMessage,
  getEffectiveConfigErrorHeader,
  loadDisplayLayers,
  loadExistingConfig,
  loadExistingEffectiveConfig,
  loadExistingRawConfig,
  loadExistingRawOverride,
  resolveLocalConfigPathOrThrow,
} from "@/commands/config-runtime";
import {
  buildConfigOverride,
  CONFIG_PATH,
  configExists,
  ensureConfigDir,
  loadConfig,
  loadConfigOverrideWithDiagnostics,
  loadConfigWithDiagnostics,
  loadEffectiveConfigWithDiagnostics,
  parseConfig,
  parseConfigOverrideWithDiagnostics,
  parseConfigWithDiagnostics,
  resolveRepoConfigPath,
  saveConfig,
  saveConfigOverride,
} from "@/lib/config";
import {
  formatConfigLayersDisplay,
  formatConfigRawLayersDisplay,
  formatReadableConfigSection,
} from "@/lib/config-display";
import type { Config } from "@/lib/types";

export {
  getConfigValue,
  parseConfigKey,
  parseConfigValue,
  setConfigValue,
  validateConfigInvariants,
} from "@/commands/config-model";

type ConfigSubcommand = "show" | "get" | "set" | "edit";

type ConfigCommandLogger = {
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
};

type ConfigCommandSpawner = (
  command: string[],
  options: {
    stdin: "inherit";
    stdout: "inherit";
    stderr: "inherit";
  }
) => {
  exited: Promise<number>;
};

export type ConfigCommandDeps = {
  configPath: string;
  cwd: () => string;
  resolveRepoConfigPath: typeof resolveRepoConfigPath;
  configExists: typeof configExists;
  ensureConfigDir: typeof ensureConfigDir;
  loadConfig: typeof loadConfig;
  loadConfigOverrideWithDiagnostics: typeof loadConfigOverrideWithDiagnostics;
  loadEffectiveConfigWithDiagnostics: typeof loadEffectiveConfigWithDiagnostics;
  loadConfigWithDiagnostics: typeof loadConfigWithDiagnostics;
  parseConfig: typeof parseConfig;
  parseConfigWithDiagnostics: typeof parseConfigWithDiagnostics;
  saveConfig: typeof saveConfig;
  saveConfigOverride: typeof saveConfigOverride;
  buildConfigOverride: typeof buildConfigOverride;
  spawn: ConfigCommandSpawner;
  env: Record<string, string | undefined>;
  note(message: string, title: string): void;
  print(value: string): void;
  log: ConfigCommandLogger;
  exit(code: number): void;
};

type ConfigScope = "global" | "local";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function formatValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  return String(value);
}

function printValue(value: unknown, print: (value: string) => void): void {
  if (typeof value === "object" && value !== null) {
    print(JSON.stringify(value, null, 2));
    return;
  }

  print(String(value));
}

export function parseConfigSubcommand(value: string): ConfigSubcommand {
  if (value === "show" || value === "get" || value === "set" || value === "edit") {
    return value;
  }

  throw new Error(`Unknown config subcommand "${value}". Use: show, get, set, edit.`);
}

type ResolvedReadScope = "effective" | ConfigScope;

interface ParsedScopedArgs {
  scope: ResolvedReadScope;
  positional: string[];
}

interface ParsedShowArgs extends ParsedScopedArgs {
  json: boolean;
  verbose: boolean;
}

const SHOW_USAGE = "Usage: rr config show [--local|--global] [--json] [--verbose]";

function parseScopedArgs(args: string[], defaultScope: ResolvedReadScope): ParsedScopedArgs {
  const positional: string[] = [];
  let scope = defaultScope;
  let sawLocal = false;
  let sawGlobal = false;

  for (const arg of args) {
    if (arg === "--local") {
      if (sawGlobal) {
        throw new Error("Cannot use --local and --global together.");
      }
      sawLocal = true;
      scope = "local";
      continue;
    }

    if (arg === "--global") {
      if (sawLocal) {
        throw new Error("Cannot use --local and --global together.");
      }
      sawGlobal = true;
      scope = "global";
      continue;
    }

    positional.push(arg);
  }

  return { scope, positional };
}

function parseShowArgs(args: string[]): ParsedShowArgs {
  const positional: string[] = [];
  let scope: ResolvedReadScope = "effective";
  let sawLocal = false;
  let sawGlobal = false;
  let json = false;
  let verbose = false;

  for (const arg of args) {
    if (arg === "--local") {
      if (sawGlobal) {
        throw new Error("Cannot use --local and --global together.");
      }
      sawLocal = true;
      scope = "local";
      continue;
    }

    if (arg === "--global") {
      if (sawLocal) {
        throw new Error("Cannot use --local and --global together.");
      }
      sawGlobal = true;
      scope = "global";
      continue;
    }

    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg === "--verbose") {
      verbose = true;
      continue;
    }

    positional.push(arg);
  }

  return { scope, positional, json, verbose };
}

async function runShow(args: string[], deps: ConfigCommandDeps): Promise<void> {
  const parsed = parseShowArgs(args);
  if (parsed.positional.length !== 0) {
    throw new Error(SHOW_USAGE);
  }

  if (parsed.scope === "effective") {
    const layers = await loadDisplayLayers(deps);
    if (parsed.json) {
      deps.print(
        formatConfigRawLayersDisplay(layers.effective, layers.globalConfig, layers.localConfig)
      );
      return;
    }

    deps.note(
      formatConfigLayersDisplay(layers.effective, layers.globalConfig, layers.localConfig, {
        showMetadata: parsed.verbose,
      }),
      "Configuration"
    );
    return;
  }

  if (parsed.scope === "global") {
    const path = deps.configPath;
    const config = await loadExistingRawConfig(path, deps);
    if (parsed.json) {
      deps.print(JSON.stringify(config, null, 2));
      return;
    }

    deps.note(
      formatReadableConfigSection({
        title: "Global config",
        path,
        config,
        mode: "full",
        showMetadata: parsed.verbose,
      }),
      "Configuration"
    );
    return;
  }

  const path = await resolveLocalConfigPathOrThrow(deps);
  const config = await loadExistingRawOverride(path, deps);
  if (parsed.json) {
    deps.print(JSON.stringify(config, null, 2));
    return;
  }

  deps.note(
    formatReadableConfigSection({
      title: "Repo-local overrides",
      path,
      config,
      mode: "override",
      showMetadata: parsed.verbose,
    }),
    "Configuration"
  );
}

async function runGet(args: string[], deps: ConfigCommandDeps): Promise<void> {
  const parsed = parseScopedArgs(args, "effective");
  if (parsed.positional.length !== 1) {
    throw new Error("Usage: rr config get [--local|--global] <key>");
  }

  const key = parseConfigKey(parsed.positional[0] as string);
  const config =
    parsed.scope === "effective"
      ? await loadExistingEffectiveConfig(deps)
      : parsed.scope === "global"
        ? await loadExistingRawConfig(deps.configPath, deps)
        : await loadExistingRawOverride(await resolveLocalConfigPathOrThrow(deps), deps);
  const value = getConfigValue(config, key);

  if (value === undefined) {
    throw new Error(`Key "${key}" is not set in the current configuration.`);
  }

  printValue(value, deps.print);
}

async function runSet(args: string[], deps: ConfigCommandDeps): Promise<void> {
  const parsed = parseScopedArgs(args, "global");
  if (parsed.positional.length !== 2) {
    throw new Error("Usage: rr config set [--local|--global] <key> <value>");
  }

  const key = parseConfigKey(parsed.positional[0] as string);
  const rawValue = parsed.positional[1] as string;
  const parsedUpdate = parseConfigUpdate(key, rawValue);
  const parsedValue = parsedUpdate.value;
  const localPath = parsed.scope === "local" ? await resolveLocalConfigPathOrThrow(deps) : null;

  if (localPath !== null) {
    let current: Config | null = null;
    try {
      current = await loadExistingEffectiveConfig(deps);
    } catch {
      const currentOverride = await loadExistingRawOverride(localPath, deps);
      const updatedOverride = setConfigOverrideValue(currentOverride, parsedUpdate);
      const normalizedOverride = parseConfigOverrideWithDiagnostics(updatedOverride as unknown);
      if (!normalizedOverride.config || normalizedOverride.errors.length > 0) {
        throw new Error(
          formatConfigValidationMessage(
            "Updated repo-local configuration is invalid.",
            normalizedOverride.errors.length > 0
              ? normalizedOverride.errors
              : ["Configuration format is invalid."]
          )
        );
      }

      await deps.saveConfigOverride(normalizedOverride.config, localPath);
      deps.log.success(`Updated "${key}" to ${formatValue(parsedValue)}.`);
      return;
    }

    const updated = setConfigValue(current, key, parsedValue);

    const normalized = deps.parseConfigWithDiagnostics(updated as unknown);
    const validationErrors = collectConfigValidationErrors(normalized.config, normalized.errors);
    if (!normalized.config || validationErrors.length > 0) {
      throw new Error(
        formatConfigValidationMessage(
          "Updated configuration is invalid.",
          validationErrors.length > 0 ? validationErrors : ["Configuration format is invalid."]
        )
      );
    }

    const globalBase = await deps.loadConfig(deps.configPath);
    await deps.saveConfigOverride(
      deps.buildConfigOverride(globalBase, normalized.config),
      localPath
    );
    deps.log.success(`Updated "${key}" to ${formatValue(parsedValue)}.`);
    return;
  }

  const current = await loadExistingConfig(deps);
  const updated = setConfigValue(current, key, parsedValue);

  const normalized = deps.parseConfigWithDiagnostics(updated as unknown);
  const validationErrors = collectConfigValidationErrors(normalized.config, normalized.errors);
  if (!normalized.config || validationErrors.length > 0) {
    throw new Error(
      formatConfigValidationMessage(
        "Updated configuration is invalid.",
        validationErrors.length > 0 ? validationErrors : ["Configuration format is invalid."]
      )
    );
  }

  await deps.saveConfig(normalized.config);
  deps.log.success(`Updated "${key}" to ${formatValue(parsedValue)}.`);

  const effective = await deps.loadEffectiveConfigWithDiagnostics(deps.cwd());
  const effectiveErrors = collectEffectiveConfigValidationErrors(effective);
  if (!effective.config || effectiveErrors.length > 0) {
    deps.log.warn(
      formatConfigValidationMessage(
        getEffectiveConfigErrorHeader(effective),
        effectiveErrors.length > 0 ? effectiveErrors : ["Configuration format is invalid."],
        "Fix the repo-local override or restore compatible global values, then try again."
      )
    );
  }
}

async function runEdit(args: string[], deps: ConfigCommandDeps): Promise<void> {
  const parsed = parseScopedArgs(args, "global");
  if (parsed.positional.length !== 0) {
    throw new Error("Usage: rr config edit [--local|--global]");
  }

  const editor = deps.env.EDITOR?.trim();
  if (!editor) {
    throw new Error('EDITOR is not set. Set $EDITOR (for example: export EDITOR="vim").');
  }

  const path =
    parsed.scope === "local" ? await resolveLocalConfigPathOrThrow(deps) : deps.configPath;
  const dirSeparatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dir = dirSeparatorIndex >= 0 ? path.substring(0, dirSeparatorIndex) : "";

  await deps.ensureConfigDir(dir);

  const shell = deps.env.SHELL?.trim() || "sh";
  const command = `exec $EDITOR ${shellQuote(path)}`;

  const proc = deps.spawn([shell, "-lc", command], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Editor exited with code ${exitCode}.`);
  }

  if (!(await deps.configExists(path))) {
    deps.log.warn(`No config file was saved at ${path}.`);
    return;
  }

  if (parsed.scope === "local") {
    const effective = await deps.loadEffectiveConfigWithDiagnostics(deps.cwd());
    const errors = collectEffectiveConfigValidationErrors(effective);
    if (!effective.config || errors.length > 0) {
      deps.log.warn(
        formatConfigValidationMessage(
          getEffectiveConfigErrorHeader(effective),
          errors.length > 0 ? errors : ["Configuration format is invalid."],
          'Run "rr init" and choose Repo-local config to regenerate the file, or fix it manually.'
        )
      );
      return;
    }

    const globalBase = await deps.loadConfig(deps.configPath);
    await deps.saveConfigOverride(deps.buildConfigOverride(globalBase, effective.config), path);
    return;
  }

  const loaded = await deps.loadConfigWithDiagnostics(path);
  const errors = collectConfigValidationErrors(loaded.config, loaded.errors);
  if (!loaded.config || errors.length > 0) {
    deps.log.warn(
      formatConfigValidationMessage(
        `Invalid configuration: ${path}`,
        errors.length > 0 ? errors : ["Configuration format is invalid."],
        'Run "rr init" to regenerate the file, or fix it manually.'
      )
    );
    return;
  }

  const effective = await deps.loadEffectiveConfigWithDiagnostics(deps.cwd());
  const effectiveErrors = collectEffectiveConfigValidationErrors(effective);
  if (!effective.config || effectiveErrors.length > 0) {
    deps.log.warn(
      formatConfigValidationMessage(
        getEffectiveConfigErrorHeader(effective),
        effectiveErrors.length > 0 ? effectiveErrors : ["Configuration format is invalid."],
        "Fix the repo-local override or restore compatible global values, then try again."
      )
    );
    return;
  }

  await deps.saveConfig(loaded.config, path);
}

const DEFAULT_CONFIG_COMMAND_DEPS: ConfigCommandDeps = {
  configPath: CONFIG_PATH,
  cwd: () => process.cwd(),
  resolveRepoConfigPath,
  configExists,
  ensureConfigDir,
  loadConfig,
  loadConfigOverrideWithDiagnostics,
  loadEffectiveConfigWithDiagnostics,
  loadConfigWithDiagnostics,
  parseConfig,
  parseConfigWithDiagnostics,
  saveConfig,
  saveConfigOverride,
  buildConfigOverride,
  spawn: Bun.spawn as unknown as ConfigCommandSpawner,
  env: process.env as Record<string, string | undefined>,
  note: p.note,
  print: (value) => console.log(value),
  log: {
    success: (message) => p.log.success(message),
    warn: (message) => p.log.warn(message),
    error: (message) => p.log.error(message),
  },
  exit: (code) => {
    process.exit(code);
  },
};

function resolveConfigCommandDeps(overrides?: Partial<ConfigCommandDeps>): ConfigCommandDeps {
  if (!overrides) {
    return DEFAULT_CONFIG_COMMAND_DEPS;
  }

  const deps: ConfigCommandDeps = {
    ...DEFAULT_CONFIG_COMMAND_DEPS,
    ...overrides,
    log: {
      ...DEFAULT_CONFIG_COMMAND_DEPS.log,
      ...overrides.log,
    },
  };

  const loadConfigOverride = overrides.loadConfig;
  if (loadConfigOverride && !overrides.loadConfigWithDiagnostics) {
    deps.loadConfigWithDiagnostics = async (path = deps.configPath) => {
      const config = (await loadConfigOverride(path)) ?? null;
      return {
        exists: config !== null,
        config,
        errors: config ? [] : ["Configuration format is invalid."],
      };
    };
  }

  if (loadConfigOverride && !overrides.loadEffectiveConfigWithDiagnostics) {
    deps.loadEffectiveConfigWithDiagnostics = async (_projectPath = deps.cwd()) => {
      const config = (await loadConfigOverride(deps.configPath)) ?? null;
      return {
        exists: config !== null,
        config,
        errors: config ? [] : ["Configuration format is invalid."],
        source: "global",
        globalPath: deps.configPath,
        localPath: null,
        repoRoot: null,
        globalExists: config !== null,
        localExists: false,
        globalErrors: config ? [] : ["Configuration format is invalid."],
        localErrors: [],
      };
    };
  }

  if (overrides.parseConfig && !overrides.parseConfigWithDiagnostics) {
    deps.parseConfigWithDiagnostics = (value) => {
      const config = overrides.parseConfig?.(value) ?? null;
      return {
        config,
        errors: config ? [] : ["Configuration format is invalid."],
      };
    };
  }

  return deps;
}

export function createRunConfig(overrides?: Partial<ConfigCommandDeps>) {
  const deps = resolveConfigCommandDeps(overrides);

  return async function runConfigWithDeps(args: string[]): Promise<void> {
    try {
      const subcommand = parseConfigSubcommand(args[0] ?? "");
      const rest = args.slice(1);

      switch (subcommand) {
        case "show":
          await runShow(rest, deps);
          return;
        case "get":
          await runGet(rest, deps);
          return;
        case "set":
          await runSet(rest, deps);
          return;
        case "edit":
          await runEdit(rest, deps);
          return;
      }
    } catch (error) {
      deps.log.error(`${error}`);
      deps.exit(1);
    }
  };
}

const runConfigImpl = createRunConfig();

export async function runConfig(args: string[]): Promise<void> {
  await runConfigImpl(args);
}
