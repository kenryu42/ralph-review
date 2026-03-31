import * as p from "@clack/prompts";
import { runEdit, runGet, runSet, runShow } from "@/commands/config-handlers";
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
  parseConfigWithDiagnostics,
  resolveRepoConfigPath,
  saveConfig,
  saveConfigOverride,
} from "@/lib/config";

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

export function parseConfigSubcommand(value: string): ConfigSubcommand {
  if (value === "show" || value === "get" || value === "set" || value === "edit") {
    return value;
  }

  throw new Error(`Unknown config subcommand "${value}". Use: show, get, set, edit.`);
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
