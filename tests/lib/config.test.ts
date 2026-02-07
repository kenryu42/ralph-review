import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configExists, ensureConfigDir, loadConfig, saveConfig } from "@/lib/config";
import type { Config } from "@/lib/types";

describe("config", () => {
  let tempDir: string;

  // Create a valid test config
  const testConfig: Config = {
    reviewer: { agent: "codex", model: "gpt-4", reasoning: "high" },
    fixer: { agent: "claude", reasoning: "medium" },
    maxIterations: 10,
    iterationTimeout: 600000,
    defaultReview: { type: "uncommitted" },
  };

  beforeEach(async () => {
    // Create temp directory for test isolation
    tempDir = await mkdtemp(join(tmpdir(), "ralph-review-test-"));
  });

  afterEach(async () => {
    // Clean up temp directory
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("ensureConfigDir", () => {
    test("creates config directory if not exists", async () => {
      const testDir = join(tempDir, "config");
      await ensureConfigDir(testDir);
      const _stat = await Bun.file(testDir).exists();
      // Directory should exist (we check by trying to write a file in it)
      const testFile = join(testDir, "test.txt");
      await Bun.write(testFile, "test");
      expect(await Bun.file(testFile).exists()).toBe(true);
    });

    test("does not error if directory already exists", async () => {
      const testDir = join(tempDir, "config");
      await ensureConfigDir(testDir);
      await ensureConfigDir(testDir); // Call again
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("saveConfig and loadConfig", () => {
    test("saveConfig creates JSON file", async () => {
      const configPath = join(tempDir, "config.json");
      await saveConfig(testConfig, configPath);
      expect(await Bun.file(configPath).exists()).toBe(true);
    });

    test("loadConfig returns saved config", async () => {
      const configPath = join(tempDir, "config.json");
      await saveConfig(testConfig, configPath);
      const loaded = await loadConfig(configPath);
      expect(loaded).toEqual(testConfig);
    });

    test("loadConfig returns null for missing file", async () => {
      const configPath = join(tempDir, "nonexistent.json");
      const loaded = await loadConfig(configPath);
      expect(loaded).toBeNull();
    });

    test("loadConfig returns null for legacy thinking keys", async () => {
      const configPath = join(tempDir, "config.json");
      const legacyConfig = {
        reviewer: { agent: "codex", model: "gpt-4", thinking: "high" },
        fixer: { agent: "claude", thinking: "medium" },
        maxIterations: 10,
        iterationTimeout: 600000,
        defaultReview: { type: "uncommitted" },
      };

      await Bun.write(configPath, JSON.stringify(legacyConfig, null, 2));
      const loaded = await loadConfig(configPath);
      expect(loaded).toBeNull();
    });
  });

  describe("configExists", () => {
    test("returns true when config file exists", async () => {
      const configPath = join(tempDir, "config.json");
      await saveConfig(testConfig, configPath);
      expect(await configExists(configPath)).toBe(true);
    });

    test("returns false when config file does not exist", async () => {
      const configPath = join(tempDir, "nonexistent.json");
      expect(await configExists(configPath)).toBe(false);
    });
  });
});
