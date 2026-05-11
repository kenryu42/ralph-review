import {
  type AgentOverrideSettings,
  type AgentSettings,
  type AgentType,
  type Config,
  type ConfigOverride,
  DEFAULT_RETRY_CONFIG,
  isAgentType,
  isReasoningLevel,
  type ReasoningLevel,
  type RetryOverrideConfig,
} from "@/lib/types";

type ConfigRole = "reviewer" | "fixer";
type ConfigRoleField = "agent" | "model" | "provider" | "reasoning";
type RoleConfigKey = `${ConfigRole}.${ConfigRoleField}`;

const CONFIG_KEYS = [
  "reviewer.agent",
  "reviewer.model",
  "reviewer.provider",
  "reviewer.reasoning",
  "fixer.agent",
  "fixer.model",
  "fixer.provider",
  "fixer.reasoning",
  "maxIterations",
  "iterationTimeout",
  "defaultReview.type",
  "defaultReview.branch",
  "retry.maxRetries",
  "retry.baseDelayMs",
  "retry.maxDelayMs",
  "notifications.sound.enabled",
] as const;

type ConfigKey = (typeof CONFIG_KEYS)[number];
type ConfigValue = string | number | boolean | null;

type ParsedRoleConfigUpdate =
  | {
      key: RoleConfigKey;
      role: ConfigRole;
      field: "agent";
      value: AgentType;
    }
  | {
      key: RoleConfigKey;
      role: ConfigRole;
      field: "model";
      value: string | null;
    }
  | {
      key: RoleConfigKey;
      role: ConfigRole;
      field: "provider";
      value: string | null;
    }
  | {
      key: RoleConfigKey;
      role: ConfigRole;
      field: "reasoning";
      value: ReasoningLevel | null;
    };

type ParsedScalarConfigUpdate =
  | { key: "maxIterations"; value: number }
  | { key: "iterationTimeout"; value: number }
  | { key: "defaultReview.type"; value: "uncommitted" | "base" }
  | { key: "defaultReview.branch"; value: string | null }
  | { key: "retry.maxRetries"; value: number }
  | { key: "retry.baseDelayMs"; value: number }
  | { key: "retry.maxDelayMs"; value: number }
  | { key: "notifications.sound.enabled"; value: boolean };

type ParsedConfigUpdate = ParsedRoleConfigUpdate | ParsedScalarConfigUpdate;

function isRoleWithSettings(role: ConfigRole, config: Config): boolean {
  return role in config;
}

function readRoleSettings(role: ConfigRole, config: Config): AgentSettings | undefined {
  return config[role];
}

function writeRoleSettings(role: ConfigRole, config: Config, settings: AgentSettings): void {
  config[role] = settings;
}

function resolveRoleAndField(key: ConfigKey): { role: ConfigRole; field: ConfigRoleField } | null {
  const match = key.match(/^(reviewer|fixer)\.(agent|model|provider|reasoning)$/);
  if (!match) {
    return null;
  }

  const role = match[1];
  const field = match[2];
  if (!role || !field) {
    return null;
  }

  if (role !== "reviewer" && role !== "fixer") {
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

function parseBoundedIntegerUpdate(
  key: ParsedScalarConfigUpdate["key"],
  rawValue: string,
  minimum: number
): ParsedScalarConfigUpdate {
  const parsed = parseInteger(requireNonNullRawValue(key, rawValue), key);
  if (parsed < minimum) {
    throw new Error(
      `Value for "${key}" must be ${minimum === 0 ? "greater than or equal to 0" : "greater than 0"}.`
    );
  }
  return { key, value: parsed } as ParsedScalarConfigUpdate;
}

function requireNumberConfigValue(key: ConfigKey, value: ConfigValue, requirement: string): number {
  if (typeof value === "number") {
    return value;
  }

  throw new Error(`Value for "${key}" must be an integer ${requirement}.`);
}

function requirePiRoleSettings<T extends AgentSettings | AgentOverrideSettings>(
  current: T | undefined,
  role: ConfigRole,
  command: string
): T {
  if (!current || current.agent !== "pi") {
    throw new Error(
      `Cannot set "${role}.agent" to "pi" in a single-key update. Run "${command}" for pi setup.`
    );
  }

  return current;
}

function requireNonNullRawValue(key: ConfigKey, rawValue: string): string {
  if (rawValue === "null") {
    throw new Error(`Value "null" is not allowed for "${key}".`);
  }

  return rawValue;
}

function formatValidKeys(): string {
  return CONFIG_KEYS.join(", ");
}

function createRoleAgentUpdate(key: RoleConfigKey, value: AgentType): ParsedRoleConfigUpdate {
  const { role } = resolveRoleAndField(key) as { role: ConfigRole; field: ConfigRoleField };

  return { key, role, field: "agent", value };
}

function createRoleStringUpdate(
  key: RoleConfigKey,
  field: "model" | "provider",
  value: string | null
): ParsedRoleConfigUpdate {
  const { role } = resolveRoleAndField(key) as { role: ConfigRole; field: ConfigRoleField };

  if (field === "model") {
    return { key, role, field: "model", value };
  }

  return { key, role, field: "provider", value };
}

function createRoleReasoningUpdate(
  key: RoleConfigKey,
  value: ReasoningLevel | null
): ParsedRoleConfigUpdate {
  const { role } = resolveRoleAndField(key) as { role: ConfigRole; field: ConfigRoleField };

  return { key, role, field: "reasoning", value };
}

export function parseConfigKey(value: string): ConfigKey {
  if ((CONFIG_KEYS as readonly string[]).includes(value)) {
    return value as ConfigKey;
  }

  throw new Error(`Unknown config key "${value}". Valid keys: ${formatValidKeys()}`);
}

export function parseConfigUpdate(key: ConfigKey, rawValue: string): ParsedConfigUpdate {
  switch (key) {
    case "reviewer.agent":
    case "fixer.agent":
      rawValue = requireNonNullRawValue(key, rawValue);
      if (!isAgentType(rawValue)) {
        throw new Error(`Value for "${key}" must be a valid agent.`);
      }

      return createRoleAgentUpdate(key, rawValue);

    case "reviewer.model":
    case "fixer.model":
      if (rawValue === "null") {
        return createRoleStringUpdate(key, "model", null);
      }

      return createRoleStringUpdate(key, "model", rawValue);

    case "reviewer.provider":
    case "fixer.provider":
      if (rawValue === "null") {
        return createRoleStringUpdate(key, "provider", null);
      }

      return createRoleStringUpdate(key, "provider", rawValue);

    case "reviewer.reasoning":
    case "fixer.reasoning":
      if (rawValue === "null") {
        return createRoleReasoningUpdate(key, null);
      }

      if (!isReasoningLevel(rawValue)) {
        throw new Error(`Value for "${key}" must be one of: low, medium, high, xhigh, max.`);
      }

      return createRoleReasoningUpdate(key, rawValue);

    case "maxIterations": {
      return parseBoundedIntegerUpdate(key, rawValue, 1);
    }

    case "iterationTimeout": {
      return parseBoundedIntegerUpdate(key, rawValue, 1);
    }

    case "retry.maxRetries": {
      return parseBoundedIntegerUpdate(key, rawValue, 0);
    }

    case "retry.baseDelayMs":
    case "retry.maxDelayMs": {
      return parseBoundedIntegerUpdate(key, rawValue, 1);
    }

    case "defaultReview.type":
      rawValue = requireNonNullRawValue(key, rawValue);
      if (rawValue !== "uncommitted" && rawValue !== "base") {
        throw new Error(`Value for "${key}" must be "uncommitted" or "base".`);
      }
      return { key, value: rawValue };

    case "defaultReview.branch":
      if (rawValue === "null") {
        return { key, value: null };
      }

      if (rawValue.trim() === "") {
        throw new Error(`Value for "${key}" must be a non-empty branch name or "null".`);
      }
      return { key, value: rawValue };

    case "notifications.sound.enabled":
      if (requireNonNullRawValue(key, rawValue) !== "true" && rawValue !== "false") {
        throw new Error(`Value for "${key}" must be "true" or "false".`);
      }
      return { key, value: rawValue === "true" };
  }
}

export function parseConfigValue(key: ConfigKey, rawValue: string): ConfigValue {
  return parseConfigUpdate(key, rawValue).value;
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
    case "maxIterations":
      return config.maxIterations;
    case "iterationTimeout":
      return config.iterationTimeout;
    case "defaultReview.type":
      return config.defaultReview?.type;
    case "defaultReview.branch":
      return config.defaultReview?.type === "base" ? config.defaultReview.branch : undefined;
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
    const piSettings = requirePiRoleSettings(current, role, "rr init");

    writeRoleSettings(role, config, piSettings);
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

function setRequiredRetryValue(
  config: Config,
  field: keyof typeof DEFAULT_RETRY_CONFIG,
  value: number
): void {
  config.retry = config.retry ? { ...config.retry } : { ...DEFAULT_RETRY_CONFIG };
  config.retry[field] = value;
}

function setOverrideRetryValue(
  config: ConfigOverride,
  field: keyof RetryOverrideConfig,
  value: number
): void {
  config.retry = {
    ...(config.retry && config.retry !== null ? config.retry : {}),
    [field]: value,
  };
}

function applyRoleProviderUpdate(
  settings: AgentSettings | AgentOverrideSettings,
  role: ConfigRole,
  key: RoleConfigKey,
  value: ConfigValue,
  clearNonPiProvider: boolean
): "updated" | "unchanged" {
  if (value === null) {
    if (settings.agent !== "pi") {
      if (clearNonPiProvider) {
        delete settings.provider;
      }
      return "unchanged";
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
  return "updated";
}

function applyRoleModelUpdate(
  settings: AgentSettings | AgentOverrideSettings,
  role: ConfigRole,
  key: RoleConfigKey,
  value: ConfigValue,
  assignNullForNonPi: boolean
): void {
  if (settings.agent === "pi") {
    if (value === null || typeof value !== "string") {
      throw new Error(`Cannot unset "${role}.model" while "${role}.agent" is "pi".`);
    }
    settings.model = value;
    return;
  }

  if (value === null) {
    if (assignNullForNonPi) {
      settings.model = value;
      return;
    }
    delete settings.model;
    return;
  }

  if (typeof value === "string") {
    settings.model = value;
    return;
  }

  throw new Error(`Value for "${key}" must be a string or null.`);
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
      applyRoleProviderUpdate(settings, role, key as RoleConfigKey, value, false);
      return next;
    }

    if (field === "model") {
      applyRoleModelUpdate(settings, role, key as RoleConfigKey, value, false);
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
      setRequiredRetryValue(
        next,
        "maxRetries",
        requireNumberConfigValue(key, value, "greater than or equal to 0")
      );
      return next;
    case "retry.baseDelayMs":
      setRequiredRetryValue(
        next,
        "baseDelayMs",
        requireNumberConfigValue(key, value, "greater than 0")
      );
      return next;
    case "retry.maxDelayMs":
      setRequiredRetryValue(
        next,
        "maxDelayMs",
        requireNumberConfigValue(key, value, "greater than 0")
      );
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

function readOverrideRoleSettings(
  role: ConfigRole,
  config: ConfigOverride
): AgentOverrideSettings | undefined {
  return config[role];
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
    const piSettings = requirePiRoleSettings(current, role, "rr init --local");

    writeOverrideRoleSettings(role, config, {
      agent: "pi",
      provider: piSettings.provider,
      model: piSettings.model,
      reasoning: piSettings.reasoning,
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

export function setConfigOverrideValue(
  config: ConfigOverride,
  update: ParsedConfigUpdate
): ConfigOverride {
  const next = structuredClone(config) as ConfigOverride;

  if ("field" in update) {
    const { role, field, value } = update;
    if (field === "agent") {
      return applyOverrideRoleAgentUpdate(next, role, value);
    }

    const settings = ensureOverrideRoleForMutation(next, role);

    if (field === "provider") {
      applyRoleProviderUpdate(settings, role, update.key, value, true);
      return next;
    }

    if (field === "model") {
      applyRoleModelUpdate(settings, role, update.key, value, true);
      return next;
    }

    settings.reasoning = value;
    return next;
  }

  switch (update.key) {
    case "maxIterations":
      next.maxIterations = update.value;
      return next;
    case "iterationTimeout":
      next.iterationTimeout = update.value;
      return next;
    case "defaultReview.type": {
      if (update.value === "base") {
        const branch = next.defaultReview?.type === "base" ? next.defaultReview.branch : "";
        next.defaultReview = { type: "base", branch };
      } else {
        next.defaultReview = { type: "uncommitted" };
      }
      return next;
    }
    case "defaultReview.branch":
      if (update.value === null) {
        if (next.defaultReview?.type === "base") {
          next.defaultReview = { type: "base", branch: "" };
        }
        return next;
      }
      next.defaultReview = { type: "base", branch: update.value };
      return next;
    case "retry.maxRetries":
      setOverrideRetryValue(next, "maxRetries", update.value);
      return next;
    case "retry.baseDelayMs":
      setOverrideRetryValue(next, "baseDelayMs", update.value);
      return next;
    case "retry.maxDelayMs":
      setOverrideRetryValue(next, "maxDelayMs", update.value);
      return next;
    case "notifications.sound.enabled":
      next.notifications = {
        ...next.notifications,
        sound: {
          ...(next.notifications?.sound ?? {}),
          enabled: update.value,
        },
      };
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

  const roles: readonly ConfigRole[] = ["reviewer", "fixer"];
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
