import * as p from "@clack/prompts";
import {
  buildConfigOverride,
  CONFIG_PATH,
  configExists,
  type EffectiveConfigDiagnostics,
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
import {
  type AgentOverrideSettings,
  type AgentSettings,
  type AgentType,
  type Config,
  type ConfigOverride,
  DEFAULT_RETRY_CONFIG,
  isAgentType,
  isReasoningLevel,
} from "@/lib/types";

type ConfigRole = "reviewer" | "fixer" | "code-simplifier";
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
  print(value: string): void;
  log: ConfigCommandLogger;
  exit(code: number): void;
};

const CONFIG_KEYS = [
  "reviewer.agent",
  "reviewer.model",
  "reviewer.provider",
  "reviewer.reasoning",
  "fixer.agent",
  "fixer.model",
  "fixer.provider",
  "fixer.reasoning",
  "code-simplifier.agent",
  "code-simplifier.model",
  "code-simplifier.provider",
  "code-simplifier.reasoning",
  "maxIterations",
  "iterationTimeout",
  "defaultReview.type",
  "defaultReview.branch",
  "run.simplifier",
  "run.interactive",
  "retry.maxRetries",
  "retry.baseDelayMs",
  "retry.maxDelayMs",
  "notifications.sound.enabled",
] as const;

export type ConfigKey = (typeof CONFIG_KEYS)[number];
export type ConfigValue = string | number | boolean | null;
type ConfigScope = "global" | "local";

function getEffectiveConfigErrorHeader(loaded: EffectiveConfigDiagnostics): string {
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

function isRoleWithSettings(role: ConfigRole, config: Config): boolean {
  return role === "code-simplifier" ? config[role] !== undefined : true;
}

function readRoleSettings(role: ConfigRole, config: Config): AgentSettings | undefined {
  return role === "code-simplifier" ? config[role] : config[role];
}

function writeRoleSettings(role: ConfigRole, config: Config, settings: AgentSettings): void {
  if (role === "code-simplifier") {
    config[role] = settings;
    return;
  }

  config[role] = settings;
}

function resolveRoleAndField(
  key: ConfigKey
): { role: ConfigRole; field: "agent" | "model" | "provider" | "reasoning" } | null {
  const match = key.match(/^(reviewer|fixer|code-simplifier)\.(agent|model|provider|reasoning)$/);
  if (!match) {
    return null;
  }

  const role = match[1];
  const field = match[2];
  if (!role || !field) {
    return null;
  }

  if (role !== "reviewer" && role !== "fixer" && role !== "code-simplifier") {
    return null;
  }
  if (field !== "agent" && field !== "model" && field !== "provider" && field !== "reasoning") {
    return null;
  }

  return { role, field };
}

function parseInteger(value: string, key: ConfigKey): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Value for "${key}" must be an integer.`);
  }
  return parsed;
}

function formatValidKeys(): string {
  return CONFIG_KEYS.join(", ");
}

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

export function parseConfigKey(value: string): ConfigKey {
  if ((CONFIG_KEYS as readonly string[]).includes(value)) {
    return value as ConfigKey;
  }

  throw new Error(`Unknown config key "${value}". Valid keys: ${formatValidKeys()}`);
}

export function parseConfigValue(key: ConfigKey, rawValue: string): ConfigValue {
  const allowNull = [
    "reviewer.model",
    "reviewer.provider",
    "reviewer.reasoning",
    "fixer.model",
    "fixer.provider",
    "fixer.reasoning",
    "code-simplifier.model",
    "code-simplifier.provider",
    "code-simplifier.reasoning",
    "defaultReview.branch",
  ] as const;

  if (rawValue === "null") {
    if ((allowNull as readonly string[]).includes(key)) {
      return null;
    }
    throw new Error(`Value "null" is not allowed for "${key}".`);
  }

  switch (key) {
    case "reviewer.agent":
    case "fixer.agent":
    case "code-simplifier.agent":
      if (!isAgentType(rawValue)) {
        throw new Error(`Value for "${key}" must be a valid agent.`);
      }
      return rawValue;

    case "reviewer.reasoning":
    case "fixer.reasoning":
    case "code-simplifier.reasoning":
      if (!isReasoningLevel(rawValue)) {
        throw new Error(`Value for "${key}" must be one of: low, medium, high, xhigh, max.`);
      }
      return rawValue;

    case "maxIterations": {
      const parsed = parseInteger(rawValue, key);
      if (parsed <= 0) {
        throw new Error(`Value for "${key}" must be greater than 0.`);
      }
      return parsed;
    }

    case "iterationTimeout": {
      const parsed = parseInteger(rawValue, key);
      if (parsed <= 0) {
        throw new Error(`Value for "${key}" must be greater than 0.`);
      }
      return parsed;
    }

    case "retry.maxRetries": {
      const parsed = parseInteger(rawValue, key);
      if (parsed < 0) {
        throw new Error(`Value for "${key}" must be greater than or equal to 0.`);
      }
      return parsed;
    }

    case "retry.baseDelayMs":
    case "retry.maxDelayMs": {
      const parsed = parseInteger(rawValue, key);
      if (parsed <= 0) {
        throw new Error(`Value for "${key}" must be greater than 0.`);
      }
      return parsed;
    }

    case "defaultReview.type":
      if (rawValue !== "uncommitted" && rawValue !== "base") {
        throw new Error(`Value for "${key}" must be "uncommitted" or "base".`);
      }
      return rawValue;

    case "defaultReview.branch":
      if (rawValue.trim() === "") {
        throw new Error(`Value for "${key}" must be a non-empty branch name or "null".`);
      }
      return rawValue;

    case "run.simplifier":
    case "run.interactive":
      if (rawValue !== "true" && rawValue !== "false") {
        throw new Error(`Value for "${key}" must be "true" or "false".`);
      }
      return rawValue === "true";

    case "notifications.sound.enabled":
      if (rawValue !== "true" && rawValue !== "false") {
        throw new Error(`Value for "${key}" must be "true" or "false".`);
      }
      return rawValue === "true";

    default:
      return rawValue;
  }
}

export function getConfigValue(config: Config | ConfigOverride, key: ConfigKey): unknown {
  switch (key) {
    case "reviewer.agent":
      return config.reviewer?.agent;
    case "reviewer.model":
      return config.reviewer?.model;
    case "reviewer.provider":
      return config.reviewer && "provider" in config.reviewer
        ? config.reviewer.provider
        : config.reviewer?.agent === "pi"
          ? config.reviewer.provider
          : undefined;
    case "reviewer.reasoning":
      return config.reviewer?.reasoning;
    case "fixer.agent":
      return config.fixer?.agent;
    case "fixer.model":
      return config.fixer?.model;
    case "fixer.provider":
      return config.fixer && "provider" in config.fixer
        ? config.fixer.provider
        : config.fixer?.agent === "pi"
          ? config.fixer.provider
          : undefined;
    case "fixer.reasoning":
      return config.fixer?.reasoning;
    case "code-simplifier.agent":
      return config["code-simplifier"]?.agent;
    case "code-simplifier.model":
      return config["code-simplifier"]?.model;
    case "code-simplifier.provider":
      return config["code-simplifier"] && "provider" in config["code-simplifier"]
        ? config["code-simplifier"].provider
        : config["code-simplifier"]?.agent === "pi"
          ? config["code-simplifier"].provider
          : undefined;
    case "code-simplifier.reasoning":
      return config["code-simplifier"]?.reasoning;
    case "maxIterations":
      return config.maxIterations;
    case "iterationTimeout":
      return config.iterationTimeout;
    case "defaultReview.type":
      return config.defaultReview?.type;
    case "defaultReview.branch":
      return config.defaultReview?.type === "base" ? config.defaultReview.branch : undefined;
    case "run.simplifier":
      return config.run?.simplifier;
    case "run.interactive":
      return config.run?.interactive;
    case "retry.maxRetries":
      return config.retry?.maxRetries;
    case "retry.baseDelayMs":
      return config.retry?.baseDelayMs;
    case "retry.maxDelayMs":
      return config.retry?.maxDelayMs;
    case "notifications.sound.enabled":
      return config.notifications?.sound?.enabled;
  }
}

function ensureRoleForMutation(
  config: Config,
  role: ConfigRole,
  _field: "agent" | "model" | "provider" | "reasoning"
): AgentSettings {
  const existing = readRoleSettings(role, config);
  if (existing) {
    return existing;
  }

  throw new Error(
    `Role "${role}" is not configured. Set "${role}.agent" first or run "rr init" to reconfigure.`
  );
}

function applyRoleAgentUpdate(config: Config, role: ConfigRole, nextAgent: AgentType): Config {
  const current = readRoleSettings(role, config);
  if (nextAgent === "pi") {
    if (!current || current.agent !== "pi") {
      throw new Error(
        `Cannot set "${role}.agent" to "pi" in a single-key update. Run "rr init" for pi setup.`
      );
    }

    writeRoleSettings(role, config, {
      agent: "pi",
      provider: current.provider,
      model: current.model,
      reasoning: current.reasoning,
    });
    return config;
  }

  if (!current) {
    writeRoleSettings(role, config, { agent: nextAgent });
    return config;
  }

  if (current.agent === "pi") {
    writeRoleSettings(role, config, {
      agent: nextAgent,
      model: current.model,
      reasoning: current.reasoning,
    });
    return config;
  }

  writeRoleSettings(role, config, { ...current, agent: nextAgent });
  return config;
}

export function setConfigValue(config: Config, key: ConfigKey, value: ConfigValue): Config {
  const next = structuredClone(config) as Config;

  const roleField = resolveRoleAndField(key);
  if (roleField) {
    const { role, field } = roleField;

    if (!isRoleWithSettings(role, next) && field !== "agent") {
      throw new Error(
        `Role "${role}" is not configured. Set "${role}.agent" first or run "rr init" to reconfigure.`
      );
    }

    if (field === "agent") {
      if (typeof value !== "string" || !isAgentType(value)) {
        throw new Error(`Value for "${key}" must be a valid agent.`);
      }
      return applyRoleAgentUpdate(next, role, value);
    }

    const settings = ensureRoleForMutation(next, role, field);

    if (field === "provider") {
      if (value === null) {
        if (settings.agent !== "pi") {
          return next;
        }
        throw new Error(`Cannot unset "${role}.provider" while "${role}.agent" is "pi".`);
      }
      if (typeof value !== "string") {
        throw new Error(`Value for "${key}" must be a string or null.`);
      }
      if (settings.agent !== "pi") {
        throw new Error(`"${role}.provider" is only valid when "${role}.agent" is "pi".`);
      }
      settings.provider = value;
      return next;
    }

    if (field === "model") {
      if (settings.agent === "pi") {
        if (value === null || typeof value !== "string") {
          throw new Error(`Cannot unset "${role}.model" while "${role}.agent" is "pi".`);
        }
        settings.model = value;
        return next;
      }

      if (value === null) {
        delete settings.model;
      } else if (typeof value === "string") {
        settings.model = value;
      } else {
        throw new Error(`Value for "${key}" must be a string or null.`);
      }
      return next;
    }

    if (settings.agent === "pi") {
      if (value === null) {
        delete settings.reasoning;
      } else if (typeof value === "string" && isReasoningLevel(value)) {
        settings.reasoning = value;
      } else {
        throw new Error(`Value for "${key}" must be one of: low, medium, high, xhigh, max.`);
      }
      return next;
    }

    if (value === null) {
      delete settings.reasoning;
    } else if (typeof value === "string" && isReasoningLevel(value)) {
      settings.reasoning = value;
    } else {
      throw new Error(`Value for "${key}" must be one of: low, medium, high, xhigh, max.`);
    }

    return next;
  }

  switch (key) {
    case "maxIterations":
      if (typeof value !== "number") {
        throw new Error(`Value for "${key}" must be an integer greater than 0.`);
      }
      next.maxIterations = value;
      return next;
    case "iterationTimeout":
      if (typeof value !== "number") {
        throw new Error(`Value for "${key}" must be an integer greater than 0.`);
      }
      next.iterationTimeout = value;
      return next;
    case "defaultReview.type": {
      if (value === "base") {
        const branch = next.defaultReview.type === "base" ? next.defaultReview.branch : "";
        next.defaultReview = { type: "base", branch };
      } else if (value === "uncommitted") {
        next.defaultReview = { type: "uncommitted" };
      } else {
        throw new Error(`Value for "${key}" must be "uncommitted" or "base".`);
      }
      return next;
    }
    case "defaultReview.branch":
      if (value === null) {
        if (next.defaultReview.type === "base") {
          next.defaultReview = { type: "base", branch: "" };
        }
        return next;
      }
      if (typeof value !== "string") {
        throw new Error(`Value for "${key}" must be a non-empty branch name or "null".`);
      }
      next.defaultReview = { type: "base", branch: value };
      return next;
    case "run.simplifier":
      if (typeof value !== "boolean") {
        throw new Error(`Value for "${key}" must be "true" or "false".`);
      }
      next.run = { simplifier: value, interactive: next.run?.interactive ?? true };
      return next;
    case "run.interactive":
      if (typeof value !== "boolean") {
        throw new Error(`Value for "${key}" must be "true" or "false".`);
      }
      next.run = { simplifier: next.run?.simplifier ?? false, interactive: value };
      return next;
    case "retry.maxRetries":
      next.retry = next.retry ? { ...next.retry } : { ...DEFAULT_RETRY_CONFIG };
      if (typeof value !== "number") {
        throw new Error(`Value for "${key}" must be an integer greater than or equal to 0.`);
      }
      next.retry.maxRetries = value;
      return next;
    case "retry.baseDelayMs":
      next.retry = next.retry ? { ...next.retry } : { ...DEFAULT_RETRY_CONFIG };
      if (typeof value !== "number") {
        throw new Error(`Value for "${key}" must be an integer greater than 0.`);
      }
      next.retry.baseDelayMs = value;
      return next;
    case "retry.maxDelayMs":
      next.retry = next.retry ? { ...next.retry } : { ...DEFAULT_RETRY_CONFIG };
      if (typeof value !== "number") {
        throw new Error(`Value for "${key}" must be an integer greater than 0.`);
      }
      next.retry.maxDelayMs = value;
      return next;
    case "notifications.sound.enabled":
      if (typeof value !== "boolean") {
        throw new Error(`Value for "${key}" must be "true" or "false".`);
      }
      next.notifications = {
        ...next.notifications,
        sound: {
          ...next.notifications.sound,
          enabled: value,
        },
      };
      return next;
    default:
      return next;
  }
}

export function validateConfigInvariants(config: Config): string[] {
  const errors: string[] = [];

  if (!Number.isInteger(config.maxIterations) || config.maxIterations <= 0) {
    errors.push("maxIterations must be an integer greater than 0.");
  }

  if (!Number.isInteger(config.iterationTimeout) || config.iterationTimeout <= 0) {
    errors.push("iterationTimeout must be an integer greater than 0.");
  }

  if (config.defaultReview.type === "base" && config.defaultReview.branch.trim() === "") {
    errors.push('defaultReview.branch is required when defaultReview.type is "base".');
  }

  const roles: readonly ConfigRole[] = ["reviewer", "fixer", "code-simplifier"];
  for (const role of roles) {
    const settings = readRoleSettings(role, config);
    if (!settings) {
      continue;
    }

    if (settings.agent === "pi") {
      if (!settings.provider?.trim()) {
        errors.push(`${role}.provider is required when ${role}.agent is "pi".`);
      }
      if (!settings.model?.trim()) {
        errors.push(`${role}.model is required when ${role}.agent is "pi".`);
      }
      continue;
    }

    if ("provider" in settings) {
      errors.push(`${role}.provider must be absent when ${role}.agent is not "pi".`);
    }
  }

  if (config.retry) {
    if (!Number.isInteger(config.retry.maxRetries) || config.retry.maxRetries < 0) {
      errors.push("retry.maxRetries must be an integer greater than or equal to 0.");
    }
    if (!Number.isInteger(config.retry.baseDelayMs) || config.retry.baseDelayMs <= 0) {
      errors.push("retry.baseDelayMs must be an integer greater than 0.");
    }
    if (!Number.isInteger(config.retry.maxDelayMs) || config.retry.maxDelayMs <= 0) {
      errors.push("retry.maxDelayMs must be an integer greater than 0.");
    }
  }

  if (typeof config.notifications.sound.enabled !== "boolean") {
    errors.push("notifications.sound.enabled must be a boolean.");
  }
  if (config.run && typeof config.run.simplifier !== "boolean") {
    errors.push("run.simplifier must be a boolean.");
  }
  if (config.run && typeof config.run.interactive !== "boolean") {
    errors.push("run.interactive must be a boolean.");
  }

  return errors;
}

function formatConfigValidationMessage(header: string, errors: string[], footer?: string): string {
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

function collectConfigValidationErrors(config: Config | null, errors: string[]): string[] {
  const combined = [...errors];
  if (config) {
    combined.push(...validateConfigInvariants(config));
  }
  return [...new Set(combined)];
}

function collectEffectiveConfigValidationErrors(loaded: EffectiveConfigDiagnostics): string[] {
  const combined = loaded.config ? [] : [...loaded.errors];
  if (loaded.config) {
    combined.push(...validateConfigInvariants(loaded.config));
  }
  return [...new Set(combined)];
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

async function resolveLocalConfigPathOrThrow(deps: ConfigCommandDeps): Promise<string> {
  const resolved = await deps.resolveRepoConfigPath(deps.cwd());
  if (!resolved) {
    throw new Error("Cannot use --local outside a git repository.");
  }

  return resolved.path;
}

async function loadExistingRawConfig(path: string, deps: ConfigCommandDeps): Promise<Config> {
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

async function loadExistingEffectiveConfig(deps: ConfigCommandDeps): Promise<Config> {
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

async function loadExistingRawOverride(
  path: string,
  deps: ConfigCommandDeps
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

async function loadExistingConfig(deps: ConfigCommandDeps): Promise<Config> {
  return await loadExistingRawConfig(deps.configPath, deps);
}

async function loadDisplayLayers(deps: ConfigCommandDeps) {
  const effective = await deps.loadEffectiveConfigWithDiagnostics(deps.cwd());
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

  const globalConfig = await deps.loadConfigWithDiagnostics(effective.globalPath);
  const localConfig = effective.localPath
    ? await deps.loadConfigOverrideWithDiagnostics(effective.localPath)
    : null;

  return {
    effective,
    globalConfig,
    localConfig,
  };
}

function readOverrideRoleSettings(
  role: ConfigRole,
  config: ConfigOverride
): AgentOverrideSettings | undefined {
  return role === "code-simplifier" ? (config[role] ?? undefined) : config[role];
}

function writeOverrideRoleSettings(
  role: ConfigRole,
  config: ConfigOverride,
  settings: AgentOverrideSettings
): void {
  config[role] = settings;
}

function ensureOverrideRoleForMutation(
  config: ConfigOverride,
  role: ConfigRole
): AgentOverrideSettings {
  const existing = readOverrideRoleSettings(role, config);
  if (existing) {
    return existing;
  }

  throw new Error(
    `Role "${role}" is not configured in the repo-local override. Set "${role}.agent" first or run "rr init --local" to reconfigure.`
  );
}

function applyOverrideRoleAgentUpdate(
  config: ConfigOverride,
  role: ConfigRole,
  nextAgent: AgentType
): ConfigOverride {
  const current = readOverrideRoleSettings(role, config);
  if (nextAgent === "pi") {
    if (!current || current.agent !== "pi") {
      throw new Error(
        `Cannot set "${role}.agent" to "pi" in a single-key update. Run "rr init --local" for pi setup.`
      );
    }

    writeOverrideRoleSettings(role, config, {
      agent: "pi",
      provider: current.provider,
      model: current.model,
      reasoning: current.reasoning,
    });
    return config;
  }

  if (!current) {
    writeOverrideRoleSettings(role, config, { agent: nextAgent });
    return config;
  }

  if (current.agent === "pi") {
    writeOverrideRoleSettings(role, config, {
      agent: nextAgent,
      ...(current.model !== undefined ? { model: current.model } : {}),
      ...(current.reasoning !== undefined ? { reasoning: current.reasoning } : {}),
    });
    return config;
  }

  writeOverrideRoleSettings(role, config, { ...current, agent: nextAgent });
  return config;
}

function setConfigOverrideValue(
  config: ConfigOverride,
  key: ConfigKey,
  value: ConfigValue
): ConfigOverride {
  const next = structuredClone(config) as ConfigOverride;

  const roleField = resolveRoleAndField(key);
  if (roleField) {
    const { role, field } = roleField;

    if (field === "agent") {
      if (typeof value !== "string" || !isAgentType(value)) {
        throw new Error(`Value for "${key}" must be a valid agent.`);
      }
      return applyOverrideRoleAgentUpdate(next, role, value);
    }

    const settings = ensureOverrideRoleForMutation(next, role);

    if (field === "provider") {
      if (value === null) {
        if (settings.agent !== "pi") {
          delete settings.provider;
          return next;
        }
        throw new Error(`Cannot unset "${role}.provider" while "${role}.agent" is "pi".`);
      }
      if (typeof value !== "string") {
        throw new Error(`Value for "${key}" must be a string or null.`);
      }
      if (settings.agent !== "pi") {
        throw new Error(`"${role}.provider" is only valid when "${role}.agent" is "pi".`);
      }
      settings.provider = value;
      return next;
    }

    if (field === "model") {
      if (settings.agent === "pi") {
        if (value === null || typeof value !== "string") {
          throw new Error(`Cannot unset "${role}.model" while "${role}.agent" is "pi".`);
        }
        settings.model = value;
        return next;
      }

      if (value === null) {
        settings.model = null;
      } else if (typeof value === "string") {
        settings.model = value;
      } else {
        throw new Error(`Value for "${key}" must be a string or null.`);
      }
      return next;
    }

    if (settings.agent === "pi") {
      if (value === null) {
        settings.reasoning = null;
      } else if (typeof value === "string" && isReasoningLevel(value)) {
        settings.reasoning = value;
      } else {
        throw new Error(`Value for "${key}" must be one of: low, medium, high, xhigh, max.`);
      }
      return next;
    }

    if (value === null) {
      settings.reasoning = null;
    } else if (typeof value === "string" && isReasoningLevel(value)) {
      settings.reasoning = value;
    } else {
      throw new Error(`Value for "${key}" must be one of: low, medium, high, xhigh, max.`);
    }

    return next;
  }

  switch (key) {
    case "maxIterations":
      if (typeof value !== "number") {
        throw new Error(`Value for "${key}" must be an integer greater than 0.`);
      }
      next.maxIterations = value;
      return next;
    case "iterationTimeout":
      if (typeof value !== "number") {
        throw new Error(`Value for "${key}" must be an integer greater than 0.`);
      }
      next.iterationTimeout = value;
      return next;
    case "defaultReview.type": {
      if (value === "base") {
        const branch = next.defaultReview?.type === "base" ? next.defaultReview.branch : "";
        next.defaultReview = { type: "base", branch };
      } else if (value === "uncommitted") {
        next.defaultReview = { type: "uncommitted" };
      } else {
        throw new Error(`Value for "${key}" must be "uncommitted" or "base".`);
      }
      return next;
    }
    case "defaultReview.branch":
      if (value === null) {
        if (next.defaultReview?.type === "base") {
          next.defaultReview = { type: "base", branch: "" };
        }
        return next;
      }
      if (typeof value !== "string") {
        throw new Error(`Value for "${key}" must be a non-empty branch name or "null".`);
      }
      next.defaultReview = { type: "base", branch: value };
      return next;
    case "run.simplifier":
      if (typeof value !== "boolean") {
        throw new Error(`Value for "${key}" must be "true" or "false".`);
      }
      next.run = {
        ...(next.run && next.run !== null ? next.run : {}),
        simplifier: value,
      };
      return next;
    case "run.interactive":
      if (typeof value !== "boolean") {
        throw new Error(`Value for "${key}" must be "true" or "false".`);
      }
      next.run = {
        ...(next.run && next.run !== null ? next.run : {}),
        interactive: value,
      };
      return next;
    case "retry.maxRetries":
      if (typeof value !== "number") {
        throw new Error(`Value for "${key}" must be an integer greater than or equal to 0.`);
      }
      next.retry = {
        ...(next.retry && next.retry !== null ? next.retry : {}),
        maxRetries: value,
      };
      return next;
    case "retry.baseDelayMs":
      if (typeof value !== "number") {
        throw new Error(`Value for "${key}" must be an integer greater than 0.`);
      }
      next.retry = {
        ...(next.retry && next.retry !== null ? next.retry : {}),
        baseDelayMs: value,
      };
      return next;
    case "retry.maxDelayMs":
      if (typeof value !== "number") {
        throw new Error(`Value for "${key}" must be an integer greater than 0.`);
      }
      next.retry = {
        ...(next.retry && next.retry !== null ? next.retry : {}),
        maxDelayMs: value,
      };
      return next;
    case "notifications.sound.enabled":
      if (typeof value !== "boolean") {
        throw new Error(`Value for "${key}" must be "true" or "false".`);
      }
      next.notifications = {
        ...next.notifications,
        sound: {
          ...(next.notifications?.sound ?? {}),
          enabled: value,
        },
      };
      return next;
    default:
      return next;
  }
}

async function runShow(args: string[], deps: ConfigCommandDeps): Promise<void> {
  const parsed = parseShowArgs(args);
  if (parsed.positional.length !== 0) {
    throw new Error(SHOW_USAGE);
  }

  if (parsed.scope === "effective") {
    const layers = await loadDisplayLayers(deps);
    deps.print(
      parsed.json
        ? formatConfigRawLayersDisplay(layers.effective, layers.globalConfig, layers.localConfig)
        : formatConfigLayersDisplay(layers.effective, layers.globalConfig, layers.localConfig, {
            showMetadata: parsed.verbose,
          })
    );
    return;
  }

  if (parsed.scope === "global") {
    const path = deps.configPath;
    const config = await loadExistingRawConfig(path, deps);
    deps.print(
      parsed.json
        ? JSON.stringify(config, null, 2)
        : formatReadableConfigSection({
            title: "Global config",
            path,
            config,
            mode: "full",
            showMetadata: parsed.verbose,
          })
    );
    return;
  }

  const path = await resolveLocalConfigPathOrThrow(deps);
  const config = await loadExistingRawOverride(path, deps);
  deps.print(
    parsed.json
      ? JSON.stringify(config, null, 2)
      : formatReadableConfigSection({
          title: "Repo-local overrides",
          path,
          config,
          mode: "override",
          showMetadata: parsed.verbose,
        })
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
  const parsedValue = parseConfigValue(key, rawValue);
  const localPath = parsed.scope === "local" ? await resolveLocalConfigPathOrThrow(deps) : null;

  if (localPath !== null) {
    let current: Config | null = null;
    try {
      current = await loadExistingEffectiveConfig(deps);
    } catch {
      const currentOverride = await loadExistingRawOverride(localPath, deps);
      const updatedOverride = setConfigOverrideValue(currentOverride, key, parsedValue);
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
