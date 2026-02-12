import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configExists, ensureConfigDir, loadConfig, parseConfig, saveConfig } from "@/lib/config";
import { type AgentSettings, CONFIG_SCHEMA_URI, CONFIG_VERSION, type Config } from "@/lib/types";

describe("config", () => {
  let tempDir: string;

  // Create a valid test config
  const testConfig: Config = {
    $schema: CONFIG_SCHEMA_URI,
    version: CONFIG_VERSION,
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

    test("loadConfig normalizes metadata values", async () => {
      const configPath = join(tempDir, "config.json");
      const configWithWrongMetadata = {
        ...testConfig,
        $schema: "https://example.com/wrong.schema.json",
        version: 999,
      };

      await Bun.write(configPath, JSON.stringify(configWithWrongMetadata, null, 2));
      const loaded = await loadConfig(configPath);
      expect(loaded?.$schema).toBe(CONFIG_SCHEMA_URI);
      expect(loaded?.version).toBe(CONFIG_VERSION);
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

    test("loadConfig accepts optional code-simplifier agent settings", async () => {
      const configPath = join(tempDir, "config.json");
      const codeSimplifier: AgentSettings = {
        agent: "codex",
        model: "gpt-5.2-codex",
        reasoning: "high",
      };
      const configWithSimplifier = {
        ...testConfig,
        "code-simplifier": codeSimplifier,
      };

      await Bun.write(configPath, JSON.stringify(configWithSimplifier, null, 2));
      const loaded = await loadConfig(configPath);
      expect(loaded?.["code-simplifier"]).toEqual(codeSimplifier);
    });

    test("loadConfig rejects invalid code-simplifier settings", async () => {
      const configPath = join(tempDir, "config.json");
      const configWithInvalidSimplifier = {
        ...testConfig,
        "code-simplifier": {
          agent: "pi",
          model: "gemini-2.5-pro",
        },
      };

      await Bun.write(configPath, JSON.stringify(configWithInvalidSimplifier, null, 2));
      const loaded = await loadConfig(configPath);
      expect(loaded).toBeNull();
    });

    test("parseConfig returns config for valid object", () => {
      const parsed = parseConfig(testConfig);
      expect(parsed).toEqual(testConfig);
    });

    test("parseConfig adds metadata for legacy config missing metadata", () => {
      const legacyConfig = {
        reviewer: testConfig.reviewer,
        fixer: testConfig.fixer,
        maxIterations: testConfig.maxIterations,
        iterationTimeout: testConfig.iterationTimeout,
        defaultReview: testConfig.defaultReview,
      };

      const parsed = parseConfig(legacyConfig);
      expect(parsed).not.toBeNull();
      expect(parsed?.$schema).toBe(CONFIG_SCHEMA_URI);
      expect(parsed?.version).toBe(CONFIG_VERSION);
    });

    test("parseConfig normalizes incorrect metadata values", () => {
      const configWithWrongMetadata = {
        ...testConfig,
        $schema: "https://example.com/wrong.schema.json",
        version: 42,
      };

      const parsed = parseConfig(configWithWrongMetadata);
      expect(parsed).not.toBeNull();
      expect(parsed?.$schema).toBe(CONFIG_SCHEMA_URI);
      expect(parsed?.version).toBe(CONFIG_VERSION);
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
