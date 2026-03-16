import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveRepositoryRootAsync } from "./git";
import {
  type AgentOverrideSettings,
  type AgentSettings,
  CONFIG_SCHEMA_URI,
  CONFIG_VERSION,
  type Config,
  type ConfigOverride,
  DEFAULT_NOTIFICATIONS_CONFIG,
  type DefaultReview,
  isAgentType,
  isReasoningLevel,
  type NotificationsConfig,
  type NotificationsOverrideConfig,
  type RetryConfig,
  type RetryOverrideConfig,
  type RunConfig,
  type RunOverrideConfig,
} from "./types";

const CONFIG_DIR = join(homedir(), ".config", "ralph-review");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");
export const LOGS_DIR = join(CONFIG_DIR, "logs");
const LOCAL_CONFIG_DIRNAME = ".ralph-review";
const LOCAL_CONFIG_FILENAME = "config.json";
const VALID_AGENT_VALUES = ["codex", "claude", "opencode", "droid", "gemini", "pi"] as const;
const VALID_AGENT_CHOICES = VALID_AGENT_VALUES.join(", ");
const VALID_REASONING_VALUES = ["low", "medium", "high", "xhigh", "max"] as const;
const RUN_SETTING_KEYS = ["simplifier", "interactive"] as const;
const OVERRIDE_TOP_LEVEL_KEYS = [
  "reviewer",
  "fixer",
  "code-simplifier",
  "defaultReview",
  "retry",
  "notifications",
  "run",
  "maxIterations",
  "iterationTimeout",
] as const;

export interface ConfigParseDiagnostics {
  config: Config | null;
  errors: string[];
}

export interface LoadedConfigDiagnostics extends ConfigParseDiagnostics {
  exists: boolean;
}

interface ConfigOverrideParseDiagnostics {
  config: ConfigOverride | null;
  errors: string[];
}

export interface LoadedConfigOverrideDiagnostics extends ConfigOverrideParseDiagnostics {
  exists: boolean;
  path: string;
}

export interface ResolveConfigOptions {
  globalPath?: string;
  repositoryRootResolver?: (projectPath: string) => Promise<string | undefined>;
}

export interface ResolvedRepoConfigPath {
  repoRoot: string;
  path: string;
}

export interface EffectiveConfigDiagnostics extends ConfigParseDiagnostics {
  exists: boolean;
  source: "none" | "global" | "local" | "merged";
  globalPath: string;
  localPath: string | null;
  repoRoot: string | null;
  globalExists: boolean;
  localExists: boolean;
  globalErrors: string[];
  localErrors: string[];
}

function withCanonicalMetadata(
  config: Omit<Config, "$schema" | "version"> & Partial<Pick<Config, "$schema" | "version">>
): Config {
  return {
    ...config,
    $schema: CONFIG_SCHEMA_URI,
    version: CONFIG_VERSION,
  };
}

function withCanonicalOverrideMetadata(
  config: ConfigOverride,
  includeMetadata: boolean
): ConfigOverride {
  if (!includeMetadata) {
    return config;
  }

  return {
    ...config,
    $schema: CONFIG_SCHEMA_URI,
    version: CONFIG_VERSION,
  };
}

function hasOwnKey(value: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(value, key);
}

function isObjectEmpty(value: Record<string, unknown>): boolean {
  return Object.keys(value).length === 0;
}

async function ensureParentDir(path: string): Promise<void> {
  const parentDirSeparator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const parentDir = parentDirSeparator >= 0 ? path.substring(0, parentDirSeparator) : "";
  if (parentDir) {
    await mkdir(parentDir, { recursive: true });
  }
}

export function getRepoConfigPath(repoRoot: string): string {
  return join(repoRoot, LOCAL_CONFIG_DIRNAME, LOCAL_CONFIG_FILENAME);
}

export async function resolveRepoConfigPath(
  projectPath: string,
  options: ResolveConfigOptions = {}
): Promise<ResolvedRepoConfigPath | null> {
  const resolveRepositoryRoot = options.repositoryRootResolver ?? resolveRepositoryRootAsync;
  const repoRoot = await resolveRepositoryRoot(projectPath);
  if (!repoRoot) {
    return null;
  }

  return {
    repoRoot,
    path: getRepoConfigPath(repoRoot),
  };
}

export async function ensureConfigDir(dir: string = CONFIG_DIR): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function saveConfig(config: Config, path: string = CONFIG_PATH): Promise<void> {
  await ensureParentDir(path);
  await Bun.write(path, JSON.stringify(withCanonicalMetadata(config), null, 2));
}

export async function saveConfigOverride(config: ConfigOverride, path: string): Promise<void> {
  await ensureParentDir(path);
  await Bun.write(path, JSON.stringify(withCanonicalOverrideMetadata(config, true), null, 2));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseRetryConfigWithDiagnostics(
  value: unknown,
  errors: string[]
): RetryConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    errors.push("retry must be an object.");
    return undefined;
  }

  const maxRetries = value.maxRetries;
  const baseDelayMs = value.baseDelayMs;
  const maxDelayMs = value.maxDelayMs;
  let hasError = false;

  if (typeof maxRetries !== "number") {
    errors.push("retry.maxRetries must be a number.");
    hasError = true;
  }
  if (typeof baseDelayMs !== "number") {
    errors.push("retry.baseDelayMs must be a number.");
    hasError = true;
  }
  if (typeof maxDelayMs !== "number") {
    errors.push("retry.maxDelayMs must be a number.");
    hasError = true;
  }

  if (
    !hasError &&
    typeof maxRetries === "number" &&
    typeof baseDelayMs === "number" &&
    typeof maxDelayMs === "number"
  ) {
    return { maxRetries, baseDelayMs, maxDelayMs };
  }

  return undefined;
}

function parseNotificationsConfigWithDiagnostics(
  value: unknown,
  errors: string[]
): NotificationsConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    errors.push("notifications must be an object.");
    return undefined;
  }

  const sound = value.sound;
  if (!isRecord(sound)) {
    errors.push("notifications.sound must be an object.");
    return undefined;
  }
  if (typeof sound.enabled !== "boolean") {
    errors.push("notifications.sound.enabled must be a boolean.");
    return undefined;
  }

  return {
    sound: {
      enabled: sound.enabled,
    },
  };
}

function formatRunSettingChoices(): string {
  return RUN_SETTING_KEYS.map((key) => `run.${key}`).join(", ");
}

function formatOverrideTopLevelChoices(): string {
  return OVERRIDE_TOP_LEVEL_KEYS.join(", ");
}

function parseRunConfigWithDiagnostics(value: unknown, errors: string[]): RunConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    errors.push("run must be an object.");
    return undefined;
  }

  const keys = Object.keys(value);
  let hasError = false;
  for (const key of keys) {
    if (key === "simplifier" || key === "interactive") {
      continue;
    }

    errors.push(`run.${key} is not supported. Available settings: ${formatRunSettingChoices()}.`);
    hasError = true;
  }

  const simplifier = value.simplifier;
  const interactive = value.interactive === undefined ? true : value.interactive;

  if (typeof simplifier !== "boolean") {
    errors.push("run.simplifier must be a boolean.");
    hasError = true;
  }
  if (typeof interactive !== "boolean") {
    errors.push("run.interactive must be a boolean.");
    hasError = true;
  }

  if (!hasError && typeof simplifier === "boolean" && typeof interactive === "boolean") {
    return {
      simplifier,
      interactive,
    };
  }

  return undefined;
}

function parseRetryConfigOverrideWithDiagnostics(
  value: unknown,
  errors: string[]
): RetryOverrideConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    errors.push("retry must be an object.");
    return undefined;
  }

  const override: RetryOverrideConfig = {};
  let hasError = false;
  for (const key of Object.keys(value)) {
    if (key !== "maxRetries" && key !== "baseDelayMs" && key !== "maxDelayMs") {
      errors.push(`retry.${key} is not supported.`);
      hasError = true;
    }
  }

  if (hasOwnKey(value, "maxRetries")) {
    if (typeof value.maxRetries !== "number") {
      errors.push("retry.maxRetries must be a number.");
      hasError = true;
    } else {
      override.maxRetries = value.maxRetries;
    }
  }

  if (hasOwnKey(value, "baseDelayMs")) {
    if (typeof value.baseDelayMs !== "number") {
      errors.push("retry.baseDelayMs must be a number.");
      hasError = true;
    } else {
      override.baseDelayMs = value.baseDelayMs;
    }
  }

  if (hasOwnKey(value, "maxDelayMs")) {
    if (typeof value.maxDelayMs !== "number") {
      errors.push("retry.maxDelayMs must be a number.");
      hasError = true;
    } else {
      override.maxDelayMs = value.maxDelayMs;
    }
  }

  return hasError ? undefined : override;
}

function parseNotificationsConfigOverrideWithDiagnostics(
  value: unknown,
  errors: string[]
): NotificationsOverrideConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    errors.push("notifications must be an object.");
    return undefined;
  }

  const override: NotificationsOverrideConfig = {};
  let hasError = false;
  for (const key of Object.keys(value)) {
    if (key !== "sound") {
      errors.push(`notifications.${key} is not supported.`);
      hasError = true;
    }
  }

  if (hasOwnKey(value, "sound")) {
    if (!isRecord(value.sound)) {
      errors.push("notifications.sound must be an object.");
      hasError = true;
    } else {
      const soundOverride: NonNullable<NotificationsOverrideConfig["sound"]> = {};
      for (const key of Object.keys(value.sound)) {
        if (key !== "enabled") {
          errors.push(`notifications.sound.${key} is not supported.`);
          hasError = true;
        }
      }

      if (hasOwnKey(value.sound, "enabled")) {
        if (typeof value.sound.enabled !== "boolean") {
          errors.push("notifications.sound.enabled must be a boolean.");
          hasError = true;
        } else {
          soundOverride.enabled = value.sound.enabled;
        }
      }

      override.sound = soundOverride;
    }
  }

  return hasError ? undefined : override;
}

function parseRunConfigOverrideWithDiagnostics(
  value: unknown,
  errors: string[]
): RunOverrideConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    errors.push("run must be an object.");
    return undefined;
  }

  const override: RunOverrideConfig = {};
  let hasError = false;
  for (const key of Object.keys(value)) {
    if (key !== "simplifier" && key !== "interactive") {
      errors.push(`run.${key} is not supported. Available settings: ${formatRunSettingChoices()}.`);
      hasError = true;
    }
  }

  if (hasOwnKey(value, "simplifier")) {
    if (typeof value.simplifier !== "boolean") {
      errors.push("run.simplifier must be a boolean.");
      hasError = true;
    } else {
      override.simplifier = value.simplifier;
    }
  }

  if (hasOwnKey(value, "interactive")) {
    if (typeof value.interactive !== "boolean") {
      errors.push("run.interactive must be a boolean.");
      hasError = true;
    } else {
      override.interactive = value.interactive;
    }
  }

  return hasError ? undefined : override;
}

function parseDefaultReviewWithDiagnostics(value: unknown, errors: string[]): DefaultReview | null {
  if (!isRecord(value)) {
    errors.push('defaultReview must be an object with type "uncommitted" or "base".');
    return null;
  }

  if (typeof value.type !== "string") {
    errors.push('defaultReview.type must be "uncommitted" or "base".');
    return null;
  }

  if (value.type === "uncommitted") {
    return { type: "uncommitted" };
  }

  if (value.type === "base" && typeof value.branch === "string" && value.branch.trim() !== "") {
    return { type: "base", branch: value.branch };
  }

  if (value.type === "base") {
    errors.push(
      'defaultReview.branch must be a non-empty string when defaultReview.type is "base".'
    );
    return null;
  }

  errors.push('defaultReview.type must be "uncommitted" or "base".');
  return null;
}

function parseAgentSettingsWithDiagnostics(
  value: unknown,
  path: "reviewer" | "fixer" | "code-simplifier",
  errors: string[]
): AgentSettings | null {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return null;
  }

  const agent = isAgentType(value.agent) ? value.agent : undefined;
  let reasoning: AgentSettings["reasoning"] | undefined;
  if (value.reasoning !== undefined) {
    reasoning = isReasoningLevel(value.reasoning) ? value.reasoning : undefined;
  }
  let hasError = false;

  if (!agent) {
    hasError = true;
    errors.push(`${path}.agent must be one of: ${VALID_AGENT_CHOICES}.`);
  }
  if (value.reasoning !== undefined && reasoning === undefined) {
    errors.push(`${path}.reasoning must be one of: ${VALID_REASONING_VALUES.join(", ")}.`);
    hasError = true;
  }

  if (agent === "pi") {
    const provider = value.provider;
    const model = value.model;

    if (typeof provider !== "string") {
      errors.push(`${path}.provider must be a string when ${path}.agent is "pi".`);
      hasError = true;
    }
    if (typeof model !== "string") {
      errors.push(`${path}.model must be a string when ${path}.agent is "pi".`);
      hasError = true;
    }

    if (!hasError && typeof provider === "string" && typeof model === "string") {
      return {
        agent: "pi",
        provider,
        model,
        reasoning,
      };
    }

    return null;
  }

  if (agent && value.provider !== undefined) {
    errors.push(`${path}.provider is only valid when ${path}.agent is "pi".`);
    hasError = true;
  }
  if (value.model !== undefined && typeof value.model !== "string") {
    errors.push(`${path}.model must be a string.`);
    hasError = true;
  }

  if (!agent || hasError) {
    return null;
  }

  return {
    agent,
    model: typeof value.model === "string" ? value.model : undefined,
    reasoning,
  };
}

function parseAgentOverrideWithDiagnostics(
  value: unknown,
  path: "reviewer" | "fixer" | "code-simplifier",
  errors: string[]
): AgentOverrideSettings | null {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return null;
  }

  const override: AgentOverrideSettings = {};
  let hasError = false;

  for (const key of Object.keys(value)) {
    if (key !== "agent" && key !== "model" && key !== "provider" && key !== "reasoning") {
      errors.push(`${path}.${key} is not supported.`);
      hasError = true;
    }
  }

  if (hasOwnKey(value, "agent")) {
    if (!isAgentType(value.agent)) {
      errors.push(`${path}.agent must be one of: ${VALID_AGENT_CHOICES}.`);
      hasError = true;
    } else {
      override.agent = value.agent;
    }
  }

  if (hasOwnKey(value, "model")) {
    if (value.model !== null && typeof value.model !== "string") {
      errors.push(`${path}.model must be a string or null.`);
      hasError = true;
    } else {
      override.model = value.model === null ? null : value.model;
    }
  }

  if (hasOwnKey(value, "provider")) {
    if (value.provider !== null && typeof value.provider !== "string") {
      errors.push(`${path}.provider must be a string or null.`);
      hasError = true;
    } else {
      override.provider = value.provider === null ? null : value.provider;
    }
  }

  if (hasOwnKey(value, "reasoning")) {
    if (value.reasoning !== null && !isReasoningLevel(value.reasoning)) {
      errors.push(`${path}.reasoning must be one of: ${VALID_REASONING_VALUES.join(", ")}.`);
      hasError = true;
    } else {
      override.reasoning = value.reasoning === null ? null : value.reasoning;
    }
  }

  return hasError ? null : override;
}

function uniqueErrors(errors: string[]): string[] {
  return [...new Set(errors)];
}

export function parseConfigWithDiagnostics(value: unknown): ConfigParseDiagnostics {
  if (!isRecord(value)) {
    return {
      config: null,
      errors: ["Configuration must be a JSON object."],
    };
  }

  const errors: string[] = [];
  const reviewer = parseAgentSettingsWithDiagnostics(value.reviewer, "reviewer", errors);
  const fixer = parseAgentSettingsWithDiagnostics(value.fixer, "fixer", errors);
  const codeSimplifier =
    value["code-simplifier"] === undefined
      ? undefined
      : parseAgentSettingsWithDiagnostics(value["code-simplifier"], "code-simplifier", errors);
  const defaultReview = parseDefaultReviewWithDiagnostics(value.defaultReview, errors);
  const retry = parseRetryConfigWithDiagnostics(value.retry, errors);
  const notifications = parseNotificationsConfigWithDiagnostics(value.notifications, errors);
  const run = parseRunConfigWithDiagnostics(value.run, errors);
  const maxIterations = typeof value.maxIterations === "number" ? value.maxIterations : undefined;
  const iterationTimeout =
    typeof value.iterationTimeout === "number" ? value.iterationTimeout : undefined;

  if (maxIterations === undefined) {
    errors.push("maxIterations must be a number.");
  }
  if (iterationTimeout === undefined) {
    errors.push("iterationTimeout must be a number.");
  }

  if (
    !reviewer ||
    !fixer ||
    !defaultReview ||
    maxIterations === undefined ||
    iterationTimeout === undefined ||
    errors.length > 0 ||
    (value["code-simplifier"] !== undefined && !codeSimplifier) ||
    (value.retry !== undefined && !retry) ||
    (value.notifications !== undefined && !notifications) ||
    (value.run !== undefined && !run)
  ) {
    return {
      config: null,
      errors: uniqueErrors(errors),
    };
  }

  return {
    config: withCanonicalMetadata({
      reviewer,
      fixer,
      ...(codeSimplifier ? { "code-simplifier": codeSimplifier } : {}),
      ...(run ? { run } : {}),
      maxIterations,
      iterationTimeout,
      ...(retry ? { retry } : {}),
      defaultReview,
      notifications: notifications ?? {
        sound: { enabled: DEFAULT_NOTIFICATIONS_CONFIG.sound.enabled },
      },
    }),
    errors: [],
  };
}

export function parseConfig(value: unknown): Config | null {
  return parseConfigWithDiagnostics(value).config;
}

export function parseConfigOverrideWithDiagnostics(value: unknown): ConfigOverrideParseDiagnostics {
  if (!isRecord(value)) {
    return {
      config: null,
      errors: ["Configuration override must be a JSON object."],
    };
  }

  const errors: string[] = [];
  for (const key of Object.keys(value)) {
    if (
      key !== "$schema" &&
      key !== "version" &&
      !(OVERRIDE_TOP_LEVEL_KEYS as readonly string[]).includes(key)
    ) {
      errors.push(
        `${key} is not supported. Available settings: ${formatOverrideTopLevelChoices()}.`
      );
    }
  }
  const hasCodeSimplifierOverride = hasOwnKey(value, "code-simplifier");
  const hasRetryOverride = hasOwnKey(value, "retry");
  const hasRunOverride = hasOwnKey(value, "run");
  const reviewer =
    value.reviewer === undefined
      ? undefined
      : parseAgentOverrideWithDiagnostics(value.reviewer, "reviewer", errors);
  const fixer =
    value.fixer === undefined
      ? undefined
      : parseAgentOverrideWithDiagnostics(value.fixer, "fixer", errors);
  const codeSimplifier = !hasCodeSimplifierOverride
    ? undefined
    : value["code-simplifier"] === null
      ? null
      : parseAgentOverrideWithDiagnostics(value["code-simplifier"], "code-simplifier", errors);
  const defaultReview =
    value.defaultReview === undefined
      ? undefined
      : parseDefaultReviewWithDiagnostics(value.defaultReview, errors);
  const retry =
    !hasRetryOverride || value.retry === null
      ? value.retry === null
        ? null
        : undefined
      : parseRetryConfigOverrideWithDiagnostics(value.retry, errors);
  const notifications = parseNotificationsConfigOverrideWithDiagnostics(
    value.notifications,
    errors
  );
  const run =
    !hasRunOverride || value.run === null
      ? value.run === null
        ? null
        : undefined
      : parseRunConfigOverrideWithDiagnostics(value.run, errors);

  let maxIterations: number | undefined;
  if (hasOwnKey(value, "maxIterations")) {
    if (typeof value.maxIterations !== "number") {
      errors.push("maxIterations must be a number.");
    } else {
      maxIterations = value.maxIterations;
    }
  }

  let iterationTimeout: number | undefined;
  if (hasOwnKey(value, "iterationTimeout")) {
    if (typeof value.iterationTimeout !== "number") {
      errors.push("iterationTimeout must be a number.");
    } else {
      iterationTimeout = value.iterationTimeout;
    }
  }

  if (
    errors.length > 0 ||
    (value.reviewer !== undefined && !reviewer) ||
    (value.fixer !== undefined && !fixer) ||
    (hasCodeSimplifierOverride && value["code-simplifier"] !== null && !codeSimplifier) ||
    (value.defaultReview !== undefined && !defaultReview) ||
    (hasRetryOverride && value.retry !== null && !retry) ||
    (value.notifications !== undefined && !notifications) ||
    (hasRunOverride && value.run !== null && !run)
  ) {
    return {
      config: null,
      errors: uniqueErrors(errors),
    };
  }

  const includeMetadata = value.$schema !== undefined || value.version !== undefined;
  return {
    config: withCanonicalOverrideMetadata(
      {
        ...(reviewer ? { reviewer } : {}),
        ...(fixer ? { fixer } : {}),
        ...(hasCodeSimplifierOverride ? { "code-simplifier": codeSimplifier } : {}),
        ...(hasRunOverride ? { run } : {}),
        ...(maxIterations !== undefined ? { maxIterations } : {}),
        ...(iterationTimeout !== undefined ? { iterationTimeout } : {}),
        ...(hasRetryOverride ? { retry } : {}),
        ...(defaultReview ? { defaultReview } : {}),
        ...(notifications ? { notifications } : {}),
      },
      includeMetadata
    ),
    errors: [],
  };
}

export async function loadConfigWithDiagnostics(
  path: string = CONFIG_PATH
): Promise<LoadedConfigDiagnostics> {
  const file = Bun.file(path);

  if (!(await file.exists())) {
    return {
      exists: false,
      config: null,
      errors: [],
    };
  }

  try {
    const content = await file.text();
    const parsed = JSON.parse(content) as unknown;
    const result = parseConfigWithDiagnostics(parsed);
    return {
      exists: true,
      ...result,
    };
  } catch (error) {
    return {
      exists: true,
      config: null,
      errors: [`Invalid JSON syntax: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

export async function loadConfig(path: string = CONFIG_PATH): Promise<Config | null> {
  const loaded = await loadConfigWithDiagnostics(path);
  return loaded.config;
}

export async function loadConfigOverrideWithDiagnostics(
  path: string
): Promise<LoadedConfigOverrideDiagnostics> {
  const file = Bun.file(path);

  if (!(await file.exists())) {
    return {
      exists: false,
      path,
      config: null,
      errors: [],
    };
  }

  try {
    const content = await file.text();
    const parsed = JSON.parse(content) as unknown;
    const result = parseConfigOverrideWithDiagnostics(parsed);
    return {
      exists: true,
      path,
      ...result,
    };
  } catch (error) {
    return {
      exists: true,
      path,
      config: null,
      errors: [`Invalid JSON syntax: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

function mergeRunSection(
  base: RunConfig | undefined,
  override: RunOverrideConfig | null | undefined
): Record<string, unknown> | undefined {
  if (!base && !override) {
    return undefined;
  }
  if (override === null) {
    return undefined;
  }

  const merged: Record<string, unknown> = {};
  if (base?.simplifier !== undefined) {
    merged.simplifier = base.simplifier;
  }
  if (base?.interactive !== undefined) {
    merged.interactive = base.interactive;
  }
  if (override?.simplifier !== undefined) {
    merged.simplifier = override.simplifier;
  }
  if (override?.interactive !== undefined) {
    merged.interactive = override.interactive;
  }

  return isObjectEmpty(merged) ? undefined : merged;
}

function mergeRetrySection(
  base: RetryConfig | undefined,
  override: RetryOverrideConfig | null | undefined
): Record<string, unknown> | undefined {
  if (!base && !override) {
    return undefined;
  }
  if (override === null) {
    return undefined;
  }

  const merged: Record<string, unknown> = {};
  if (base?.maxRetries !== undefined) {
    merged.maxRetries = base.maxRetries;
  }
  if (base?.baseDelayMs !== undefined) {
    merged.baseDelayMs = base.baseDelayMs;
  }
  if (base?.maxDelayMs !== undefined) {
    merged.maxDelayMs = base.maxDelayMs;
  }
  if (override?.maxRetries !== undefined) {
    merged.maxRetries = override.maxRetries;
  }
  if (override?.baseDelayMs !== undefined) {
    merged.baseDelayMs = override.baseDelayMs;
  }
  if (override?.maxDelayMs !== undefined) {
    merged.maxDelayMs = override.maxDelayMs;
  }

  return isObjectEmpty(merged) ? undefined : merged;
}

function mergeNotificationsSection(
  base: NotificationsConfig | undefined,
  override: NotificationsOverrideConfig | undefined
): Record<string, unknown> | undefined {
  if (!base && !override) {
    return undefined;
  }

  const sound: Record<string, unknown> = {};
  if (base?.sound.enabled !== undefined) {
    sound.enabled = base.sound.enabled;
  }
  if (override?.sound?.enabled !== undefined) {
    sound.enabled = override.sound.enabled;
  }

  if (isObjectEmpty(sound)) {
    return undefined;
  }

  return { sound };
}

function mergeAgentSection(
  base: AgentSettings | undefined,
  override: AgentOverrideSettings | undefined
): Record<string, unknown> | undefined {
  if (!base && !override) {
    return undefined;
  }

  const merged: Record<string, unknown> = base
    ? (structuredClone(base) as unknown as Record<string, unknown>)
    : {};

  if (!override) {
    return isObjectEmpty(merged) ? undefined : merged;
  }

  if (override.agent !== undefined) {
    merged.agent = override.agent;
    if (override.agent !== "pi") {
      delete merged.provider;
    }
  }

  if (override.model !== undefined) {
    if (override.model === null) {
      delete merged.model;
    } else {
      merged.model = override.model;
    }
  }

  if (override.reasoning !== undefined) {
    if (override.reasoning === null) {
      delete merged.reasoning;
    } else {
      merged.reasoning = override.reasoning;
    }
  }

  if (override.provider !== undefined) {
    if (override.provider === null) {
      delete merged.provider;
    } else {
      merged.provider = override.provider;
    }
  }

  return isObjectEmpty(merged) ? undefined : merged;
}

function mergeConfigWithOverride(
  base: Config | null,
  override: ConfigOverride | null
): ConfigParseDiagnostics {
  if (!base && !override) {
    return {
      config: null,
      errors: [],
    };
  }

  const candidate: Record<string, unknown> = base
    ? (structuredClone(base) as unknown as Record<string, unknown>)
    : {};

  if (override) {
    if (override.reviewer !== undefined) {
      const reviewer = mergeAgentSection(base?.reviewer, override.reviewer);
      if (reviewer) {
        candidate.reviewer = reviewer;
      } else {
        delete candidate.reviewer;
      }
    }
    if (override.fixer !== undefined) {
      const fixer = mergeAgentSection(base?.fixer, override.fixer);
      if (fixer) {
        candidate.fixer = fixer;
      } else {
        delete candidate.fixer;
      }
    }
    if (hasOwnKey(override as Record<string, unknown>, "code-simplifier")) {
      if (override["code-simplifier"] === null) {
        delete candidate["code-simplifier"];
      } else {
        const codeSimplifier = mergeAgentSection(
          base?.["code-simplifier"],
          override["code-simplifier"]
        );
        if (codeSimplifier) {
          candidate["code-simplifier"] = codeSimplifier;
        } else {
          delete candidate["code-simplifier"];
        }
      }
    }
    if (override.defaultReview !== undefined) {
      candidate.defaultReview = structuredClone(override.defaultReview);
    }
    if (override.maxIterations !== undefined) {
      candidate.maxIterations = override.maxIterations;
    }
    if (override.iterationTimeout !== undefined) {
      candidate.iterationTimeout = override.iterationTimeout;
    }

    const run = mergeRunSection(base?.run, override.run);
    if (run) {
      candidate.run = run;
    } else {
      delete candidate.run;
    }

    const retry = mergeRetrySection(base?.retry, override.retry);
    if (retry) {
      candidate.retry = retry;
    } else {
      delete candidate.retry;
    }

    const notifications = mergeNotificationsSection(base?.notifications, override.notifications);
    if (notifications) {
      candidate.notifications = notifications;
    } else {
      delete candidate.notifications;
    }
  }

  return parseConfigWithDiagnostics(candidate);
}

function areConfigValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildAgentOverride(
  base: AgentSettings | undefined,
  config: AgentSettings | undefined
): AgentOverrideSettings | undefined {
  if (!config) {
    return undefined;
  }

  if (!base) {
    return structuredClone(config) as AgentOverrideSettings;
  }

  const override: AgentOverrideSettings = {};

  if (base.agent !== config.agent) {
    override.agent = config.agent;
  }

  if (!areConfigValuesEqual(base.model, config.model)) {
    override.model = config.model ?? null;
  }

  if (!areConfigValuesEqual(base.reasoning, config.reasoning)) {
    override.reasoning = config.reasoning ?? null;
  }

  if (
    !areConfigValuesEqual(
      base.agent === "pi" ? base.provider : undefined,
      config.agent === "pi" ? config.provider : undefined
    )
  ) {
    override.provider = config.agent === "pi" ? config.provider : null;
  }

  return isObjectEmpty(override as Record<string, unknown>) ? undefined : override;
}

export function buildConfigOverride(base: Config | null, config: Config): ConfigOverride {
  if (!base) {
    return structuredClone(config) as ConfigOverride;
  }

  const override: ConfigOverride = {};

  const reviewerOverride = buildAgentOverride(base.reviewer, config.reviewer);
  if (reviewerOverride) {
    override.reviewer = reviewerOverride;
  }
  const fixerOverride = buildAgentOverride(base.fixer, config.fixer);
  if (fixerOverride) {
    override.fixer = fixerOverride;
  }
  if (base["code-simplifier"] !== undefined && config["code-simplifier"] === undefined) {
    override["code-simplifier"] = null;
  } else if (config["code-simplifier"] !== undefined) {
    const codeSimplifierOverride = buildAgentOverride(
      base["code-simplifier"],
      config["code-simplifier"]
    );
    if (codeSimplifierOverride) {
      override["code-simplifier"] = codeSimplifierOverride;
    }
  }
  if (!areConfigValuesEqual(base.defaultReview, config.defaultReview)) {
    override.defaultReview = structuredClone(config.defaultReview);
  }
  if (base.maxIterations !== config.maxIterations) {
    override.maxIterations = config.maxIterations;
  }
  if (base.iterationTimeout !== config.iterationTimeout) {
    override.iterationTimeout = config.iterationTimeout;
  }

  if (base.run !== undefined && config.run === undefined) {
    override.run = null;
  } else if (config.run !== undefined) {
    const runOverride: RunOverrideConfig = {};
    if (base.run?.simplifier !== config.run.simplifier) {
      runOverride.simplifier = config.run.simplifier;
    }
    if (base.run?.interactive !== config.run.interactive) {
      runOverride.interactive = config.run.interactive;
    }
    if (!isObjectEmpty(runOverride as Record<string, unknown>)) {
      override.run = runOverride;
    }
  }

  if (base.retry !== undefined && config.retry === undefined) {
    override.retry = null;
  } else if (config.retry !== undefined) {
    const retryOverride: RetryOverrideConfig = {};
    if (base.retry?.maxRetries !== config.retry.maxRetries) {
      retryOverride.maxRetries = config.retry.maxRetries;
    }
    if (base.retry?.baseDelayMs !== config.retry.baseDelayMs) {
      retryOverride.baseDelayMs = config.retry.baseDelayMs;
    }
    if (base.retry?.maxDelayMs !== config.retry.maxDelayMs) {
      retryOverride.maxDelayMs = config.retry.maxDelayMs;
    }
    if (!isObjectEmpty(retryOverride as Record<string, unknown>)) {
      override.retry = retryOverride;
    }
  }

  if (base.notifications.sound.enabled !== config.notifications.sound.enabled) {
    override.notifications = {
      sound: {
        enabled: config.notifications.sound.enabled,
      },
    };
  }

  return override;
}

function prefixPathErrors(prefix: string, errors: string[]): string[] {
  return errors.map((error) => `${prefix}: ${error}`);
}

export async function loadEffectiveConfigWithDiagnostics(
  projectPath: string = process.cwd(),
  options: ResolveConfigOptions = {}
): Promise<EffectiveConfigDiagnostics> {
  const globalPath = options.globalPath ?? CONFIG_PATH;
  const repoConfig = await resolveRepoConfigPath(projectPath, options);
  const globalDiagnostics = await loadConfigWithDiagnostics(globalPath);
  const localDiagnostics = repoConfig
    ? await loadConfigOverrideWithDiagnostics(repoConfig.path)
    : {
        exists: false,
        path: "",
        config: null,
        errors: [],
      };

  if (localDiagnostics.exists && !localDiagnostics.config) {
    return {
      exists: true,
      source: "local",
      config: null,
      errors: [
        ...prefixPathErrors(
          `Invalid repo-local config at ${repoConfig?.path}`,
          localDiagnostics.errors
        ),
        ...prefixPathErrors(`Invalid global config at ${globalPath}`, globalDiagnostics.errors),
      ],
      globalPath,
      localPath: repoConfig?.path ?? null,
      repoRoot: repoConfig?.repoRoot ?? null,
      globalExists: globalDiagnostics.exists,
      localExists: true,
      globalErrors: globalDiagnostics.errors,
      localErrors: localDiagnostics.errors,
    };
  }

  if (localDiagnostics.exists && localDiagnostics.config) {
    const merged = mergeConfigWithOverride(globalDiagnostics.config, localDiagnostics.config);
    if (merged.config) {
      return {
        exists: true,
        source: globalDiagnostics.config ? "merged" : "local",
        config: merged.config,
        errors: prefixPathErrors(
          `Invalid global config at ${globalPath}`,
          globalDiagnostics.errors
        ),
        globalPath,
        localPath: repoConfig?.path ?? null,
        repoRoot: repoConfig?.repoRoot ?? null,
        globalExists: globalDiagnostics.exists,
        localExists: true,
        globalErrors: globalDiagnostics.errors,
        localErrors: localDiagnostics.errors,
      };
    }

    return {
      exists: true,
      source: globalDiagnostics.exists ? "merged" : "local",
      config: null,
      errors: [
        "Effective configuration is invalid.",
        ...(repoConfig?.path ? [`Repo-local config path: ${repoConfig.path}`] : []),
        ...prefixPathErrors(`Global config ${globalPath}`, globalDiagnostics.errors),
        ...merged.errors,
      ],
      globalPath,
      localPath: repoConfig?.path ?? null,
      repoRoot: repoConfig?.repoRoot ?? null,
      globalExists: globalDiagnostics.exists,
      localExists: true,
      globalErrors: globalDiagnostics.errors,
      localErrors: localDiagnostics.errors,
    };
  }

  if (globalDiagnostics.config) {
    return {
      exists: true,
      source: "global",
      config: globalDiagnostics.config,
      errors: [],
      globalPath,
      localPath: repoConfig?.path ?? null,
      repoRoot: repoConfig?.repoRoot ?? null,
      globalExists: true,
      localExists: false,
      globalErrors: globalDiagnostics.errors,
      localErrors: [],
    };
  }

  if (globalDiagnostics.exists) {
    return {
      exists: true,
      source: "global",
      config: null,
      errors: prefixPathErrors(`Invalid global config at ${globalPath}`, globalDiagnostics.errors),
      globalPath,
      localPath: repoConfig?.path ?? null,
      repoRoot: repoConfig?.repoRoot ?? null,
      globalExists: true,
      localExists: false,
      globalErrors: globalDiagnostics.errors,
      localErrors: [],
    };
  }

  return {
    exists: false,
    source: "none",
    config: null,
    errors: [],
    globalPath,
    localPath: repoConfig?.path ?? null,
    repoRoot: repoConfig?.repoRoot ?? null,
    globalExists: false,
    localExists: false,
    globalErrors: [],
    localErrors: [],
  };
}

export async function loadEffectiveConfig(
  projectPath: string = process.cwd(),
  options: ResolveConfigOptions = {}
): Promise<Config | null> {
  const loaded = await loadEffectiveConfigWithDiagnostics(projectPath, options);
  return loaded.config;
}

export async function configExists(path: string = CONFIG_PATH): Promise<boolean> {
  return await Bun.file(path).exists();
}

export const DEFAULT_CONFIG: Partial<Config> = {
  maxIterations: 5,
  iterationTimeout: 1800000,
  run: { simplifier: false, interactive: true },
  notifications: { sound: { enabled: DEFAULT_NOTIFICATIONS_CONFIG.sound.enabled } },
};
