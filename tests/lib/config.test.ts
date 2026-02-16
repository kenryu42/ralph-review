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
    notifications: { sound: { enabled: false } },
  };

  function createValidConfigInput(): Record<string, unknown> {
    return structuredClone(testConfig) as unknown as Record<string, unknown>;
  }

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

    test("loadConfig accepts optional run settings", async () => {
      const configPath = join(tempDir, "config.json");
      const configWithRun = {
        ...testConfig,
        run: { simplifier: true },
      };

      await Bun.write(configPath, JSON.stringify(configWithRun, null, 2));
      const loaded = await loadConfig(configPath);
      expect(loaded?.run).toEqual({ simplifier: true });
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

    test("loadConfig rejects invalid run settings", async () => {
      const configPath = join(tempDir, "config.json");
      const configWithInvalidRun = {
        ...testConfig,
        run: { simplifier: "yes" },
      };

      await Bun.write(configPath, JSON.stringify(configWithInvalidRun, null, 2));
      const loaded = await loadConfig(configPath);
      expect(loaded).toBeNull();
    });

    test("parseConfig returns config for valid object", () => {
      const parsed = parseConfig(testConfig);
      expect(parsed).toEqual(testConfig);
    });

    test("parseConfig adds metadata when $schema and version are missing", () => {
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
      expect(parsed?.notifications.sound.enabled).toBe(true);
    });

    test("parseConfig defaults notifications when omitted", () => {
      const withoutNotifications = {
        ...testConfig,
      };
      delete (withoutNotifications as { notifications?: unknown }).notifications;

      const parsed = parseConfig(withoutNotifications);
      expect(parsed).not.toBeNull();
      expect(parsed?.notifications.sound.enabled).toBe(true);
    });

    test("parseConfig reads explicit notifications", () => {
      const withNotifications = {
        ...testConfig,
        notifications: { sound: { enabled: true } },
      };

      const parsed = parseConfig(withNotifications);
      expect(parsed).not.toBeNull();
      expect(parsed?.notifications.sound.enabled).toBe(true);
    });

    test("parseConfig ignores legacy verification settings", () => {
      const withLegacyVerification = {
        ...testConfig,
        verification: {
          commands: ["bun run check"],
          mode: "each-fixer-pass",
        },
      };

      const parsed = parseConfig(withLegacyVerification);
      expect(parsed).not.toBeNull();
      const parsedLegacy = parsed as unknown as { verification?: unknown };
      expect(parsedLegacy.verification).toBeUndefined();
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

    test("parseConfig returns null for non-object input", () => {
      expect(parseConfig(null)).toBeNull();
    });

    test("parseConfig reads explicit retry settings", () => {
      const withRetry = {
        ...createValidConfigInput(),
        retry: { maxRetries: 2, baseDelayMs: 500, maxDelayMs: 5000 },
      };

      const parsed = parseConfig(withRetry);
      expect(parsed).not.toBeNull();
      expect(parsed?.retry).toEqual({ maxRetries: 2, baseDelayMs: 500, maxDelayMs: 5000 });
    });

    test("parseConfig rejects retry when not an object", () => {
      const withInvalidRetry = {
        ...createValidConfigInput(),
        retry: true,
      };

      expect(parseConfig(withInvalidRetry)).toBeNull();
    });

    test("parseConfig rejects retry when numeric fields are invalid", () => {
      const withInvalidRetry = {
        ...createValidConfigInput(),
        retry: { maxRetries: 1, baseDelayMs: "1000", maxDelayMs: 5000 },
      };

      expect(parseConfig(withInvalidRetry)).toBeNull();
    });

    test("parseConfig rejects notifications when not an object", () => {
      const withInvalidNotifications = {
        ...createValidConfigInput(),
        notifications: "enabled",
      };

      expect(parseConfig(withInvalidNotifications)).toBeNull();
    });

    test("parseConfig rejects notifications when sound.enabled is not boolean", () => {
      const withInvalidNotifications = {
        ...createValidConfigInput(),
        notifications: { sound: { enabled: "true" } },
      };

      expect(parseConfig(withInvalidNotifications)).toBeNull();
    });

    test("parseConfig rejects run when not an object", () => {
      const withInvalidRun = {
        ...createValidConfigInput(),
        run: 1,
      };

      expect(parseConfig(withInvalidRun)).toBeNull();
    });

    test("parseConfig accepts defaultReview type base with a non-empty branch", () => {
      const withBaseReview = {
        ...createValidConfigInput(),
        defaultReview: { type: "base", branch: "main" },
      };

      const parsed = parseConfig(withBaseReview);
      expect(parsed).not.toBeNull();
      expect(parsed?.defaultReview).toEqual({ type: "base", branch: "main" });
    });

    test("parseConfig rejects defaultReview without a valid type", () => {
      const withInvalidDefaultReview = {
        ...createValidConfigInput(),
        defaultReview: { branch: "main" },
      };

      expect(parseConfig(withInvalidDefaultReview)).toBeNull();
    });

    test("parseConfig rejects defaultReview with unsupported type", () => {
      const withInvalidDefaultReview = {
        ...createValidConfigInput(),
        defaultReview: { type: "head" },
      };

      expect(parseConfig(withInvalidDefaultReview)).toBeNull();
    });

    test("parseConfig rejects reviewer with invalid agent type", () => {
      const withInvalidReviewer = {
        ...createValidConfigInput(),
        reviewer: { agent: "wizard" },
      };

      expect(parseConfig(withInvalidReviewer)).toBeNull();
    });

    test("parseConfig rejects fixer with invalid reasoning level", () => {
      const withInvalidFixer = {
        ...createValidConfigInput(),
        fixer: { agent: "claude", reasoning: "ultra" },
      };

      expect(parseConfig(withInvalidFixer)).toBeNull();
    });

    test("parseConfig rejects non-pi reviewer with provider", () => {
      const withInvalidReviewer = {
        ...createValidConfigInput(),
        reviewer: { agent: "codex", provider: "openai" },
      };

      expect(parseConfig(withInvalidReviewer)).toBeNull();
    });

    test("parseConfig rejects non-pi reviewer with non-string model", () => {
      const withInvalidReviewer = {
        ...createValidConfigInput(),
        reviewer: { agent: "codex", model: 123 },
      };

      expect(parseConfig(withInvalidReviewer)).toBeNull();
    });

    test("parseConfig rejects pi reviewer missing provider", () => {
      const withInvalidReviewer = {
        ...createValidConfigInput(),
        reviewer: { agent: "pi", model: "gemini-2.5-pro" },
      };

      expect(parseConfig(withInvalidReviewer)).toBeNull();
    });

    test("parseConfig rejects when required numeric fields are not numbers", () => {
      const withInvalidNumbers = {
        ...createValidConfigInput(),
        maxIterations: "10",
      };

      expect(parseConfig(withInvalidNumbers)).toBeNull();
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
