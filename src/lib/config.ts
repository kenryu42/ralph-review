/**
 * Configuration storage layer for ralph-review
 */

import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Config } from "./types";

// Default paths
const CONFIG_DIR = join(homedir(), ".config", "ralph-review");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");
export const LOGS_DIR = join(CONFIG_DIR, "logs");

/**
 * Ensure the config directory exists
 */
export async function ensureConfigDir(dir: string = CONFIG_DIR): Promise<void> {
  await mkdir(dir, { recursive: true });
}

/**
 * Save configuration to disk
 */
export async function saveConfig(config: Config, path: string = CONFIG_PATH): Promise<void> {
  // Ensure parent directory exists
  const parentDir = path.substring(0, path.lastIndexOf("/"));
  if (parentDir) {
    await mkdir(parentDir, { recursive: true });
  }

  await Bun.write(path, JSON.stringify(config, null, 2));
}

/**
 * Load configuration from disk
 * Returns null if file doesn't exist
 */
export async function loadConfig(path: string = CONFIG_PATH): Promise<Config | null> {
  const file = Bun.file(path);

  if (!(await file.exists())) {
    return null;
  }

  try {
    const content = await file.text();
    return JSON.parse(content) as Config;
  } catch {
    return null;
  }
}

/**
 * Check if configuration file exists
 */
export async function configExists(path: string = CONFIG_PATH): Promise<boolean> {
  return await Bun.file(path).exists();
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Partial<Config> = {
  maxIterations: 5,
  iterationTimeout: 1800000, // 30 minutes in ms
};
