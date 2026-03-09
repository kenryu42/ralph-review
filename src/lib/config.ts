import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type AgentSettings,
  CONFIG_SCHEMA_URI,
  CONFIG_VERSION,
  type Config,
  DEFAULT_NOTIFICATIONS_CONFIG,
  type DefaultReview,
  isAgentType,
  isReasoningLevel,
  type NotificationsConfig,
  type RetryConfig,
  type RunConfig,
} from "./types";

const CONFIG_DIR = join(homedir(), ".config", "ralph-review");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");
export const LOGS_DIR = join(CONFIG_DIR, "logs");
const VALID_AGENT_VALUES = ["codex", "claude", "opencode", "droid", "gemini", "pi"] as const;
const VALID_REASONING_VALUES = ["low", "medium", "high", "xhigh", "max"] as const;
const RUN_SETTING_KEYS = ["simplifier", "interactive"] as const;

export interface ConfigParseDiagnostics {
  config: Config | null;
  errors: string[];
}

export interface LoadedConfigDiagnostics extends ConfigParseDiagnostics {
  exists: boolean;
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

export async function ensureConfigDir(dir: string = CONFIG_DIR): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function saveConfig(config: Config, path: string = CONFIG_PATH): Promise<void> {
  const parentDir = path.substring(0, path.lastIndexOf("/"));
  if (parentDir) {
    await mkdir(parentDir, { recursive: true });
  }

  await Bun.write(path, JSON.stringify(withCanonicalMetadata(config), null, 2));
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

  const maxRetries = typeof value.maxRetries === "number" ? value.maxRetries : undefined;
  const baseDelayMs = typeof value.baseDelayMs === "number" ? value.baseDelayMs : undefined;
  const maxDelayMs = typeof value.maxDelayMs === "number" ? value.maxDelayMs : undefined;
  let hasError = false;

  if (maxRetries === undefined) {
    errors.push("retry.maxRetries must be a number.");
    hasError = true;
  }
  if (baseDelayMs === undefined) {
    errors.push("retry.baseDelayMs must be a number.");
    hasError = true;
  }
  if (maxDelayMs === undefined) {
    errors.push("retry.maxDelayMs must be a number.");
    hasError = true;
  }

  if (hasError) {
    return undefined;
  }

  if (maxRetries === undefined || baseDelayMs === undefined || maxDelayMs === undefined) {
    return undefined;
  }

  return { maxRetries, baseDelayMs, maxDelayMs };
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

  const simplifier = typeof value.simplifier === "boolean" ? value.simplifier : undefined;
  const interactive =
    value.interactive === undefined
      ? true
      : typeof value.interactive === "boolean"
        ? value.interactive
        : undefined;

  if (simplifier === undefined) {
    errors.push("run.simplifier must be a boolean.");
    hasError = true;
  }
  if (value.interactive !== undefined && interactive === undefined) {
    errors.push("run.interactive must be a boolean.");
    hasError = true;
  }

  if (hasError) {
    return undefined;
  }

  if (simplifier === undefined || interactive === undefined) {
    return undefined;
  }

  return {
    simplifier,
    interactive,
  };
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
  const reasoning =
    value.reasoning === undefined
      ? undefined
      : isReasoningLevel(value.reasoning)
        ? value.reasoning
        : undefined;
  let hasError = false;

  if (!agent) {
    errors.push(`${path}.agent must be one of: ${VALID_AGENT_VALUES.join(", ")}.`);
    hasError = true;
  }
  if (value.reasoning !== undefined && !reasoning) {
    errors.push(`${path}.reasoning must be one of: ${VALID_REASONING_VALUES.join(", ")}.`);
    hasError = true;
  }

  if (agent === "pi") {
    const provider = typeof value.provider === "string" ? value.provider : undefined;
    const model = typeof value.model === "string" ? value.model : undefined;

    if (provider === undefined) {
      errors.push(`${path}.provider must be a string when ${path}.agent is "pi".`);
      hasError = true;
    }
    if (model === undefined) {
      errors.push(`${path}.model must be a string when ${path}.agent is "pi".`);
      hasError = true;
    }

    if (hasError) {
      return null;
    }

    if (provider === undefined || model === undefined) {
      return null;
    }

    return {
      agent: "pi",
      provider,
      model,
      reasoning,
    };
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

export async function configExists(path: string = CONFIG_PATH): Promise<boolean> {
  return await Bun.file(path).exists();
}

export const DEFAULT_CONFIG: Partial<Config> = {
  maxIterations: 5,
  iterationTimeout: 1800000,
  run: { simplifier: false, interactive: true },
  notifications: { sound: { enabled: DEFAULT_NOTIFICATIONS_CONFIG.sound.enabled } },
};
