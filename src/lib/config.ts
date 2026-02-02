import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Config } from "./types";

const CONFIG_DIR = join(homedir(), ".config", "ralph-review");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");
export const LOGS_DIR = join(CONFIG_DIR, "logs");

export async function ensureConfigDir(dir: string = CONFIG_DIR): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function saveConfig(config: Config, path: string = CONFIG_PATH): Promise<void> {
  const parentDir = path.substring(0, path.lastIndexOf("/"));
  if (parentDir) {
    await mkdir(parentDir, { recursive: true });
  }

  await Bun.write(path, JSON.stringify(config, null, 2));
}

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

export async function configExists(path: string = CONFIG_PATH): Promise<boolean> {
  return await Bun.file(path).exists();
}

export const DEFAULT_CONFIG: Partial<Config> = {
  maxIterations: 5,
  iterationTimeout: 1800000,
};
