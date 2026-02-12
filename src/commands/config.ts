import * as p from "@clack/prompts";
import {
  CONFIG_PATH,
  configExists,
  ensureConfigDir,
  loadConfig,
  parseConfig,
  saveConfig,
} from "@/lib/config";
import {
  type AgentSettings,
  type AgentType,
  type Config,
  DEFAULT_RETRY_CONFIG,
  isAgentType,
  isReasoningLevel,
} from "@/lib/types";

type ConfigRole = "reviewer" | "fixer" | "code-simplifier";
type ConfigSubcommand = "show" | "get" | "set" | "edit";

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
  "retry.maxRetries",
  "retry.baseDelayMs",
  "retry.maxDelayMs",
  "notifications.sound.enabled",
] as const;

export type ConfigKey = (typeof CONFIG_KEYS)[number];
export type ConfigValue = string | number | boolean | null;

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
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function printValue(value: unknown): void {
  if (typeof value === "object" && value !== null) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  console.log(String(value));
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

    case "notifications.sound.enabled":
      if (rawValue !== "true" && rawValue !== "false") {
        throw new Error(`Value for "${key}" must be "true" or "false".`);
      }
      return rawValue === "true";

    default:
      return rawValue;
  }
}

export function getConfigValue(config: Config, key: ConfigKey): unknown {
  switch (key) {
    case "reviewer.agent":
      return config.reviewer.agent;
    case "reviewer.model":
      return config.reviewer.model;
    case "reviewer.provider":
      return config.reviewer.agent === "pi" ? config.reviewer.provider : undefined;
    case "reviewer.reasoning":
      return config.reviewer.reasoning;
    case "fixer.agent":
      return config.fixer.agent;
    case "fixer.model":
      return config.fixer.model;
    case "fixer.provider":
      return config.fixer.agent === "pi" ? config.fixer.provider : undefined;
    case "fixer.reasoning":
      return config.fixer.reasoning;
    case "code-simplifier.agent":
      return config["code-simplifier"]?.agent;
    case "code-simplifier.model":
      return config["code-simplifier"]?.model;
    case "code-simplifier.provider":
      return config["code-simplifier"]?.agent === "pi"
        ? config["code-simplifier"].provider
        : undefined;
    case "code-simplifier.reasoning":
      return config["code-simplifier"]?.reasoning;
    case "maxIterations":
      return config.maxIterations;
    case "iterationTimeout":
      return config.iterationTimeout;
    case "defaultReview.type":
      return config.defaultReview.type;
    case "defaultReview.branch":
      return config.defaultReview.type === "base" ? config.defaultReview.branch : undefined;
    case "retry.maxRetries":
      return config.retry?.maxRetries;
    case "retry.baseDelayMs":
      return config.retry?.baseDelayMs;
    case "retry.maxDelayMs":
      return config.retry?.maxDelayMs;
    case "notifications.sound.enabled":
      return config.notifications.sound.enabled;
  }
}

function ensureRoleForMutation(
  config: Config,
  role: ConfigRole,
  field: "agent" | "model" | "provider" | "reasoning"
): AgentSettings {
  const existing = readRoleSettings(role, config);
  if (existing) {
    return existing;
  }

  if (field !== "agent") {
    throw new Error(
      `Role "${role}" is not configured. Set "${role}.agent" first or run "rr init" to reconfigure.`
    );
  }

  const created: AgentSettings = { agent: "codex" };
  writeRoleSettings(role, config, created);
  return created;
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

  return errors;
}

async function loadExistingConfig(): Promise<Config> {
  if (!(await configExists())) {
    throw new Error('Configuration not found. Run "rr init" first.');
  }

  const config = await loadConfig();
  if (!config) {
    throw new Error(
      `Configuration exists but is invalid: ${CONFIG_PATH}. Run "rr init" or fix the file manually.`
    );
  }

  return config;
}

async function runShow(args: string[]): Promise<void> {
  if (args.length !== 0) {
    throw new Error("Usage: rr config show");
  }

  const config = await loadExistingConfig();
  console.log(JSON.stringify(config, null, 2));
}

async function runGet(args: string[]): Promise<void> {
  if (args.length !== 1) {
    throw new Error("Usage: rr config get <key>");
  }

  const key = parseConfigKey(args[0] as string);
  const config = await loadExistingConfig();
  const value = getConfigValue(config, key);

  if (value === undefined) {
    throw new Error(`Key "${key}" is not set in the current configuration.`);
  }

  printValue(value);
}

async function runSet(args: string[]): Promise<void> {
  if (args.length !== 2) {
    throw new Error("Usage: rr config set <key> <value>");
  }

  const key = parseConfigKey(args[0] as string);
  const rawValue = args[1] as string;
  const parsedValue = parseConfigValue(key, rawValue);

  const current = await loadExistingConfig();
  const updated = setConfigValue(current, key, parsedValue);

  const invariantErrors = validateConfigInvariants(updated);
  if (invariantErrors.length > 0) {
    throw new Error(invariantErrors.join("\n"));
  }

  const normalized = parseConfig(updated as unknown);
  if (!normalized) {
    throw new Error("Updated configuration is invalid.");
  }

  await saveConfig(normalized);
  p.log.success(`Updated "${key}" to ${formatValue(parsedValue)}.`);
}

async function runEdit(args: string[]): Promise<void> {
  if (args.length !== 0) {
    throw new Error("Usage: rr config edit");
  }

  const editor = process.env.EDITOR?.trim();
  if (!editor) {
    throw new Error('EDITOR is not set. Set $EDITOR (for example: export EDITOR="vim").');
  }

  await ensureConfigDir();

  const shell = process.env.SHELL?.trim() || "sh";
  const command = `exec $EDITOR ${shellQuote(CONFIG_PATH)}`;

  const proc = Bun.spawn([shell, "-lc", command], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Editor exited with code ${exitCode}.`);
  }

  if (!(await configExists())) {
    p.log.warn(`No config file was saved at ${CONFIG_PATH}.`);
    return;
  }

  const config = await loadConfig();
  if (!config) {
    p.log.warn(
      `Configuration exists but is invalid: ${CONFIG_PATH}. Run "rr init" or fix it manually.`
    );
    return;
  }

  await saveConfig(config);
}

export async function runConfig(args: string[]): Promise<void> {
  try {
    const subcommand = parseConfigSubcommand(args[0] ?? "");
    const rest = args.slice(1);

    switch (subcommand) {
      case "show":
        await runShow(rest);
        return;
      case "get":
        await runGet(rest);
        return;
      case "set":
        await runSet(rest);
        return;
      case "edit":
        await runEdit(rest);
        return;
    }
  } catch (error) {
    p.log.error(`${error}`);
    process.exit(1);
  }
}
