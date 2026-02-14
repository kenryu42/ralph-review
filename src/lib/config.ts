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

function parseRetryConfig(value: unknown): RetryConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }

  const maxRetries = value.maxRetries;
  const baseDelayMs = value.baseDelayMs;
  const maxDelayMs = value.maxDelayMs;

  if (
    typeof maxRetries !== "number" ||
    typeof baseDelayMs !== "number" ||
    typeof maxDelayMs !== "number"
  ) {
    return undefined;
  }

  return { maxRetries, baseDelayMs, maxDelayMs };
}

function parseNotificationsConfig(value: unknown): NotificationsConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }

  const sound = value.sound;
  if (!isRecord(sound) || typeof sound.enabled !== "boolean") {
    return undefined;
  }

  return {
    sound: {
      enabled: sound.enabled,
    },
  };
}

function parseRunConfig(value: unknown): RunConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }

  if (typeof value.simplifier !== "boolean") {
    return undefined;
  }

  return {
    simplifier: value.simplifier,
  };
}

function parseDefaultReview(value: unknown): DefaultReview | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }

  if (value.type === "uncommitted") {
    return { type: "uncommitted" };
  }

  if (value.type === "base" && typeof value.branch === "string" && value.branch.trim() !== "") {
    return { type: "base", branch: value.branch };
  }

  return null;
}

function parseAgentSettings(value: unknown): AgentSettings | null {
  if (!isRecord(value)) {
    return null;
  }

  if (!isAgentType(value.agent)) {
    return null;
  }

  if (value.reasoning !== undefined && !isReasoningLevel(value.reasoning)) {
    return null;
  }

  if (value.agent === "pi") {
    if (typeof value.provider !== "string" || typeof value.model !== "string") {
      return null;
    }

    return {
      agent: "pi",
      provider: value.provider,
      model: value.model,
      reasoning: value.reasoning,
    };
  }

  if (value.provider !== undefined) {
    return null;
  }
  if (value.model !== undefined && typeof value.model !== "string") {
    return null;
  }

  return {
    agent: value.agent,
    model: value.model,
    reasoning: value.reasoning,
  };
}

export function parseConfig(value: unknown): Config | null {
  if (!isRecord(value)) {
    return null;
  }

  const reviewer = parseAgentSettings(value.reviewer);
  const fixer = parseAgentSettings(value.fixer);
  const codeSimplifier = parseAgentSettings(value["code-simplifier"]);
  const defaultReview = parseDefaultReview(value.defaultReview);
  const retry = parseRetryConfig(value.retry);
  const notifications = parseNotificationsConfig(value.notifications);
  const run = parseRunConfig(value.run);

  if (!reviewer || !fixer || !defaultReview) {
    return null;
  }
  if (value["code-simplifier"] !== undefined && !codeSimplifier) {
    return null;
  }
  if (value.retry !== undefined && !retry) {
    return null;
  }
  if (value.notifications !== undefined && !notifications) {
    return null;
  }
  if (value.run !== undefined && !run) {
    return null;
  }
  if (typeof value.maxIterations !== "number" || typeof value.iterationTimeout !== "number") {
    return null;
  }

  return withCanonicalMetadata({
    reviewer,
    fixer,
    ...(codeSimplifier ? { "code-simplifier": codeSimplifier } : {}),
    ...(run ? { run } : {}),
    maxIterations: value.maxIterations,
    iterationTimeout: value.iterationTimeout,
    ...(retry ? { retry } : {}),
    defaultReview,
    notifications: notifications ?? {
      sound: { enabled: DEFAULT_NOTIFICATIONS_CONFIG.sound.enabled },
    },
  });
}

export async function loadConfig(path: string = CONFIG_PATH): Promise<Config | null> {
  const file = Bun.file(path);

  if (!(await file.exists())) {
    return null;
  }

  try {
    const content = await file.text();
    const parsed = JSON.parse(content) as unknown;
    return parseConfig(parsed);
  } catch {
    return null;
  }
}

export async function configExists(path: string = CONFIG_PATH): Promise<boolean> {
  return await Bun.file(path).exists();
}

export const DEFAULT_CONFIG: Partial<Config> = {
  maxIterations: 5,
  iterationTimeout: 1800000,
  run: { simplifier: false },
  notifications: { sound: { enabled: DEFAULT_NOTIFICATIONS_CONFIG.sound.enabled } },
};
