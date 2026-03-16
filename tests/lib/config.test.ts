import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildConfigOverride,
  configExists,
  ensureConfigDir,
  getRepoConfigPath,
  loadConfig,
  loadConfigOverrideWithDiagnostics,
  loadConfigWithDiagnostics,
  loadEffectiveConfig,
  loadEffectiveConfigWithDiagnostics,
  parseConfig,
  parseConfigWithDiagnostics,
  resolveRepoConfigPath,
  saveConfig,
  saveConfigOverride,
} from "@/lib/config";
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

  function runGitIn(repoPath: string, args: string[]): void {
    const result = Bun.spawnSync(["git", ...args], {
      cwd: repoPath,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`);
    }
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

    test("saveConfigOverride derives parent directory from Windows-style separators", async () => {
      const previousCwd = process.cwd();
      process.chdir(tempDir);

      try {
        await saveConfigOverride({ maxIterations: 9 }, "repo\\.ralph-review\\config.json");
        const parent = await stat("repo\\.ralph-review");
        expect(parent.isDirectory()).toBe(true);
      } finally {
        process.chdir(previousCwd);
      }
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
        run: { simplifier: true, interactive: false },
      };

      await Bun.write(configPath, JSON.stringify(configWithRun, null, 2));
      const loaded = await loadConfig(configPath);
      expect(loaded?.run).toEqual({ simplifier: true, interactive: false });
    });

    test("loadConfig defaults run.interactive to true when omitted from existing config", async () => {
      const configPath = join(tempDir, "config.json");
      const configWithLegacyRun = {
        ...testConfig,
        run: { simplifier: true },
      };

      await Bun.write(configPath, JSON.stringify(configWithLegacyRun, null, 2));
      const loaded = await loadConfig(configPath);
      expect(loaded?.run).toEqual({ simplifier: true, interactive: true });
    });

    test("loadConfig rejects legacy run.watch settings", async () => {
      const configPath = join(tempDir, "config.json");
      const configWithLegacyRun = {
        ...testConfig,
        run: { simplifier: true, watch: false },
      };

      await Bun.write(configPath, JSON.stringify(configWithLegacyRun, null, 2));
      const loaded = await loadConfig(configPath);
      expect(loaded).toBeNull();
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
        run: { simplifier: "yes", interactive: true },
      };

      await Bun.write(configPath, JSON.stringify(configWithInvalidRun, null, 2));
      const loaded = await loadConfig(configPath);
      expect(loaded).toBeNull();
    });

    test("loadConfigWithDiagnostics reports invalid JSON syntax", async () => {
      const configPath = join(tempDir, "config.json");
      await Bun.write(configPath, "{ invalid json");

      const result = await loadConfigWithDiagnostics(configPath);
      expect(result.exists).toBe(true);
      expect(result.config).toBeNull();
      expect(result.errors[0]).toContain("Invalid JSON syntax:");
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

    test("parseConfigWithDiagnostics reports missing retry numeric fields", () => {
      const withPartialRetry = {
        ...createValidConfigInput(),
        retry: { baseDelayMs: 500 },
      };

      const result = parseConfigWithDiagnostics(withPartialRetry);
      expect(result.config).toBeNull();
      expect(result.errors).toContain("retry.maxRetries must be a number.");
      expect(result.errors).toContain("retry.maxDelayMs must be a number.");
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

    test("parseConfigWithDiagnostics reports notifications.sound when not an object", () => {
      const withInvalidNotifications = {
        ...createValidConfigInput(),
        notifications: { sound: true },
      };

      const result = parseConfigWithDiagnostics(withInvalidNotifications);
      expect(result.config).toBeNull();
      expect(result.errors).toContain("notifications.sound must be an object.");
    });

    test("parseConfig rejects run when not an object", () => {
      const withInvalidRun = {
        ...createValidConfigInput(),
        run: 1,
      };

      expect(parseConfig(withInvalidRun)).toBeNull();
    });

    test("parseConfig rejects run when interactive is not a boolean", () => {
      const withInvalidRun = {
        ...createValidConfigInput(),
        run: { simplifier: true, interactive: "yes" },
      };

      expect(parseConfig(withInvalidRun)).toBeNull();
    });

    test("parseConfig rejects run when legacy watch key is present", () => {
      const withLegacyRun = {
        ...createValidConfigInput(),
        run: { simplifier: true, watch: false },
      };

      expect(parseConfig(withLegacyRun)).toBeNull();
    });

    test("parseConfigWithDiagnostics reports unsupported run.watch and available run settings", () => {
      const withLegacyRun = {
        ...createValidConfigInput(),
        run: { simplifier: true, watch: false },
      };

      const result = parseConfigWithDiagnostics(withLegacyRun);
      expect(result.config).toBeNull();
      expect(result.errors).toContain(
        "run.watch is not supported. Available settings: run.simplifier, run.interactive."
      );
    });

    test("parseConfigWithDiagnostics reports multiple structural issues at once", () => {
      const invalidConfig = {
        ...createValidConfigInput(),
        reviewer: { agent: "wizard" },
        fixer: { agent: "claude", reasoning: "ultra" },
        run: { simplifier: "yes", watch: false },
      };

      const result = parseConfigWithDiagnostics(invalidConfig);
      expect(result.config).toBeNull();
      expect(result.errors).toContain(
        "reviewer.agent must be one of: codex, claude, opencode, droid, gemini, pi."
      );
      expect(result.errors).toContain(
        "fixer.reasoning must be one of: low, medium, high, xhigh, max."
      );
      expect(result.errors).toContain("run.simplifier must be a boolean.");
      expect(result.errors).toContain(
        "run.watch is not supported. Available settings: run.simplifier, run.interactive."
      );
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

    test("parseConfigWithDiagnostics reports defaultReview when not an object", () => {
      const withInvalidDefaultReview = {
        ...createValidConfigInput(),
        defaultReview: true,
      };

      const result = parseConfigWithDiagnostics(withInvalidDefaultReview);
      expect(result.config).toBeNull();
      expect(result.errors).toContain(
        'defaultReview must be an object with type "uncommitted" or "base".'
      );
    });

    test("parseConfigWithDiagnostics reports base defaultReview with a blank branch", () => {
      const withInvalidDefaultReview = {
        ...createValidConfigInput(),
        defaultReview: { type: "base", branch: "   " },
      };

      const result = parseConfigWithDiagnostics(withInvalidDefaultReview);
      expect(result.config).toBeNull();
      expect(result.errors).toContain(
        'defaultReview.branch must be a non-empty string when defaultReview.type is "base".'
      );
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

    test("parseConfigWithDiagnostics reports reviewer when not an object", () => {
      const withInvalidReviewer = {
        ...createValidConfigInput(),
        reviewer: true,
      };

      const result = parseConfigWithDiagnostics(withInvalidReviewer);
      expect(result.config).toBeNull();
      expect(result.errors).toContain("reviewer must be an object.");
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

    test("parseConfigWithDiagnostics reports pi reviewer missing model", () => {
      const withInvalidReviewer = {
        ...createValidConfigInput(),
        reviewer: { agent: "pi", provider: "google" },
      };

      const result = parseConfigWithDiagnostics(withInvalidReviewer);
      expect(result.config).toBeNull();
      expect(result.errors).toContain(
        'reviewer.model must be a string when reviewer.agent is "pi".'
      );
    });

    test("parseConfig accepts pi reviewer with provider and model", () => {
      const withPiReviewer = {
        ...createValidConfigInput(),
        reviewer: { agent: "pi", provider: "google", model: "gemini-2.5-pro" },
      };

      const parsed = parseConfig(withPiReviewer);
      expect(parsed).not.toBeNull();
      expect(parsed?.reviewer).toEqual({
        agent: "pi",
        provider: "google",
        model: "gemini-2.5-pro",
        reasoning: undefined,
      });
    });

    test("parseConfig accepts pi fixer with provider, model, and reasoning", () => {
      const withPiFixer = {
        ...createValidConfigInput(),
        fixer: {
          agent: "pi",
          provider: "google",
          model: "gemini-2.5-flash",
          reasoning: "medium",
        },
      };

      const parsed = parseConfig(withPiFixer);
      expect(parsed).not.toBeNull();
      expect(parsed?.fixer).toEqual({
        agent: "pi",
        provider: "google",
        model: "gemini-2.5-flash",
        reasoning: "medium",
      });
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

  describe("repo-local overrides", () => {
    test("resolveRepoConfigPath returns null when no repository root is found", async () => {
      const result = await resolveRepoConfigPath("/tmp/not-a-repo", {
        repositoryRootResolver: async () => undefined,
      });

      expect(result).toBeNull();
    });

    test("buildConfigOverride returns the full config when there is no global base", () => {
      expect(buildConfigOverride(null, testConfig)).toEqual(testConfig);
    });

    test("buildConfigOverride keeps only changed fields against a global base", () => {
      const base = {
        ...testConfig,
        run: { simplifier: false, interactive: true },
      };
      const effective: Config = {
        ...base,
        reviewer: { agent: "gemini", model: "gemini-3-pro-preview", reasoning: "max" },
        run: { simplifier: true, interactive: true },
        maxIterations: 12,
      };

      const override = buildConfigOverride(base, effective);

      expect(override).toEqual({
        reviewer: { agent: "gemini", model: "gemini-3-pro-preview", reasoning: "max" },
        run: { simplifier: true },
        maxIterations: 12,
      });
    });

    test("buildConfigOverride keeps role overrides granular against a global base", () => {
      const base: Config = {
        ...testConfig,
        reviewer: { agent: "codex", model: "gpt-5.3-codex", reasoning: "high" },
      };
      const effective: Config = {
        ...base,
        reviewer: { ...base.reviewer, reasoning: "low" },
      };

      expect(buildConfigOverride(base, effective)).toEqual({
        reviewer: { reasoning: "low" },
      });
    });

    test("buildConfigOverride captures whole-section and nested override differences", () => {
      const base: Config = {
        ...testConfig,
        "code-simplifier": { agent: "droid", model: "gpt-5.2-codex", reasoning: "low" },
        run: { simplifier: false, interactive: true },
        retry: { maxRetries: 1, baseDelayMs: 500, maxDelayMs: 1000 },
        defaultReview: { type: "uncommitted" },
        notifications: { sound: { enabled: false } },
      };
      const effective: Config = {
        ...base,
        fixer: { agent: "gemini", model: "gemini-3-pro-preview", reasoning: "max" },
        "code-simplifier": { agent: "codex", model: "gpt-5.4", reasoning: "high" },
        run: { simplifier: false, interactive: false },
        retry: { maxRetries: 3, baseDelayMs: 750, maxDelayMs: 4000 },
        iterationTimeout: 900000,
        defaultReview: { type: "base", branch: "main" },
        notifications: { sound: { enabled: true } },
      };

      expect(buildConfigOverride(base, effective)).toEqual({
        fixer: { agent: "gemini", model: "gemini-3-pro-preview", reasoning: "max" },
        "code-simplifier": { agent: "codex", model: "gpt-5.4", reasoning: "high" },
        run: { interactive: false },
        retry: { maxRetries: 3, baseDelayMs: 750, maxDelayMs: 4000 },
        iterationTimeout: 900000,
        defaultReview: { type: "base", branch: "main" },
        notifications: { sound: { enabled: true } },
      });
    });

    test("buildConfigOverride preserves explicit removal of inherited optional sections", () => {
      const base: Config = {
        ...testConfig,
        "code-simplifier": { agent: "droid", model: "gpt-5.2-codex", reasoning: "low" },
        run: { simplifier: false, interactive: true },
        retry: { maxRetries: 1, baseDelayMs: 500, maxDelayMs: 1000 },
      };
      const effective: Config = {
        ...testConfig,
        fixer: base.fixer,
        reviewer: base.reviewer,
      };

      expect(buildConfigOverride(base, effective)).toEqual({
        "code-simplifier": null,
        run: null,
        retry: null,
      });
    });

    test("loadConfigOverrideWithDiagnostics reads a valid partial repo-local override", async () => {
      const localPath = join(tempDir, "override.json");

      await Bun.write(
        localPath,
        JSON.stringify({
          $schema: "https://example.com/custom.schema.json",
          version: 99,
          run: { simplifier: true, interactive: false },
          retry: { maxRetries: 2, baseDelayMs: 750, maxDelayMs: 5000 },
          notifications: { sound: { enabled: true } },
          maxIterations: 8,
          iterationTimeout: 300000,
        })
      );

      const result = await loadConfigOverrideWithDiagnostics(localPath);

      expect(result).toEqual({
        exists: true,
        path: localPath,
        config: {
          $schema: CONFIG_SCHEMA_URI,
          version: CONFIG_VERSION,
          run: { simplifier: true, interactive: false },
          retry: { maxRetries: 2, baseDelayMs: 750, maxDelayMs: 5000 },
          notifications: { sound: { enabled: true } },
          maxIterations: 8,
          iterationTimeout: 300000,
        },
        errors: [],
      });
    });

    test("loadConfigOverrideWithDiagnostics reports invalid override structure", async () => {
      const localPath = join(tempDir, "invalid-override.json");
      await Bun.write(
        localPath,
        JSON.stringify({
          reviewer: true,
          defaultReview: "base",
          retry: { maxRetries: "3", jitter: true },
          notifications: { sound: { enabled: "yes", extra: true }, desktop: true },
          run: { simplifier: "yes", watch: false },
          maxIterations: "8",
          iterationTimeout: "300000",
        })
      );

      const result = await loadConfigOverrideWithDiagnostics(localPath);

      expect(result.exists).toBe(true);
      expect(result.path).toBe(localPath);
      expect(result.config).toBeNull();
      expect(result.errors).toContain("reviewer must be an object.");
      expect(result.errors).toContain(
        'defaultReview must be an object with type "uncommitted" or "base".'
      );
      expect(result.errors).toContain("retry.jitter is not supported.");
      expect(result.errors).toContain("retry.maxRetries must be a number.");
      expect(result.errors).toContain("notifications.desktop is not supported.");
      expect(result.errors).toContain("notifications.sound.extra is not supported.");
      expect(result.errors).toContain("notifications.sound.enabled must be a boolean.");
      expect(result.errors).toContain(
        "run.watch is not supported. Available settings: run.simplifier, run.interactive."
      );
      expect(result.errors).toContain("run.simplifier must be a boolean.");
      expect(result.errors).toContain("maxIterations must be a number.");
      expect(result.errors).toContain("iterationTimeout must be a number.");
    });

    test("loadConfigOverrideWithDiagnostics rejects unknown top-level override keys", async () => {
      const localPath = join(tempDir, "invalid-top-level-override.json");
      await Bun.write(
        localPath,
        JSON.stringify({
          maxIteratons: 8,
        })
      );

      const result = await loadConfigOverrideWithDiagnostics(localPath);

      expect(result.exists).toBe(true);
      expect(result.config).toBeNull();
      expect(result.errors).toContain(
        "maxIteratons is not supported. Available settings: reviewer, fixer, code-simplifier, defaultReview, retry, notifications, run, maxIterations, iterationTimeout."
      );
    });

    test("loadEffectiveConfigWithDiagnostics returns the global config when no local file exists", async () => {
      const globalPath = join(tempDir, "global-config.json");
      const repoPath = join(tempDir, "repo");
      const nestedPath = join(repoPath, "packages", "app");
      await ensureConfigDir(nestedPath);
      runGitIn(repoPath, ["init", "--initial-branch=main"]);
      await saveConfig(testConfig, globalPath);

      const result = await loadEffectiveConfigWithDiagnostics(nestedPath, { globalPath });

      expect(result.exists).toBe(true);
      expect(result.source).toBe("global");
      expect(result.config).toEqual(testConfig);
      expect(result.localPath?.endsWith("/repo/.ralph-review/config.json")).toBe(true);
      expect(result.repoRoot?.endsWith("/repo")).toBe(true);
    });

    test("loadEffectiveConfigWithDiagnostics returns a full repo-local config without a global base", async () => {
      const repoPath = join(tempDir, "repo");
      const nestedPath = join(repoPath, "apps", "web");
      const localPath = getRepoConfigPath(repoPath);
      await ensureConfigDir(nestedPath);
      runGitIn(repoPath, ["init", "--initial-branch=main"]);
      await saveConfigOverride(testConfig, localPath);

      const result = await loadEffectiveConfigWithDiagnostics(nestedPath, {
        globalPath: join(tempDir, "missing-global.json"),
      });

      expect(result.exists).toBe(true);
      expect(result.source).toBe("local");
      expect(result.config).toEqual(testConfig);
      expect(result.localPath?.endsWith("/repo/.ralph-review/config.json")).toBe(true);
    });

    test("loadEffectiveConfigWithDiagnostics merges repo-local overrides over the global config", async () => {
      const globalPath = join(tempDir, "global-config.json");
      const repoPath = join(tempDir, "repo");
      const nestedPath = join(repoPath, "packages", "app");
      const localPath = getRepoConfigPath(repoPath);
      const globalConfig: Config = {
        ...testConfig,
        run: { simplifier: false, interactive: true },
        notifications: { sound: { enabled: true } },
      };
      await ensureConfigDir(nestedPath);
      runGitIn(repoPath, ["init", "--initial-branch=main"]);
      await saveConfig(globalConfig, globalPath);
      await saveConfigOverride(
        {
          reviewer: { agent: "gemini", model: "gemini-3-pro-preview", reasoning: "max" },
          run: { simplifier: true },
          notifications: { sound: { enabled: false } },
          maxIterations: 3,
        },
        localPath
      );

      const result = await loadEffectiveConfigWithDiagnostics(nestedPath, { globalPath });

      expect(result.exists).toBe(true);
      expect(result.source).toBe("merged");
      expect(result.config).toEqual({
        ...globalConfig,
        reviewer: { agent: "gemini", model: "gemini-3-pro-preview", reasoning: "max" },
        run: { simplifier: true, interactive: true },
        notifications: { sound: { enabled: false } },
        maxIterations: 3,
      });
    });

    test("loadEffectiveConfigWithDiagnostics preserves inherited role fields for partial agent overrides", async () => {
      const globalPath = join(tempDir, "global-config.json");
      const repoPath = join(tempDir, "repo");
      const nestedPath = join(repoPath, "packages", "app");
      const localPath = getRepoConfigPath(repoPath);
      const globalConfig: Config = {
        ...testConfig,
        reviewer: { agent: "codex", model: "gpt-5.4", reasoning: "high" },
      };
      await ensureConfigDir(nestedPath);
      runGitIn(repoPath, ["init", "--initial-branch=main"]);
      await saveConfig(globalConfig, globalPath);
      await saveConfigOverride(
        {
          reviewer: { reasoning: "low" },
        },
        localPath
      );

      const result = await loadEffectiveConfigWithDiagnostics(nestedPath, { globalPath });

      expect(result.exists).toBe(true);
      expect(result.source).toBe("merged");
      expect(result.config?.reviewer).toEqual({
        agent: "codex",
        model: "gpt-5.4",
        reasoning: "low",
      });
    });

    test("loadEffectiveConfigWithDiagnostics removes inherited optional sections when override sets null", async () => {
      const globalPath = join(tempDir, "global-config.json");
      const repoPath = join(tempDir, "repo");
      const nestedPath = join(repoPath, "packages", "app");
      const localPath = getRepoConfigPath(repoPath);
      await ensureConfigDir(nestedPath);
      runGitIn(repoPath, ["init", "--initial-branch=main"]);
      await saveConfig(
        {
          ...testConfig,
          "code-simplifier": { agent: "droid", model: "gpt-5.2-codex", reasoning: "low" },
          run: { simplifier: false, interactive: true },
          retry: { maxRetries: 1, baseDelayMs: 500, maxDelayMs: 1000 },
        },
        globalPath
      );
      await Bun.write(
        localPath,
        JSON.stringify(
          {
            "code-simplifier": null,
            run: null,
            retry: null,
          },
          null,
          2
        )
      );

      const result = await loadEffectiveConfigWithDiagnostics(nestedPath, { globalPath });

      expect(result.exists).toBe(true);
      expect(result.config).toEqual(testConfig);
      expect(result.config?.["code-simplifier"]).toBeUndefined();
      expect(result.config?.run).toBeUndefined();
      expect(result.config?.retry).toBeUndefined();
    });

    test("loadEffectiveConfigWithDiagnostics deep-merges retry and run overrides", async () => {
      const globalPath = join(tempDir, "global-config.json");
      const repoPath = join(tempDir, "repo");
      const nestedPath = join(repoPath, "packages", "app");
      const localPath = getRepoConfigPath(repoPath);
      await ensureConfigDir(nestedPath);
      runGitIn(repoPath, ["init", "--initial-branch=main"]);
      await saveConfig(
        {
          ...testConfig,
          run: { simplifier: false, interactive: true },
          retry: { maxRetries: 1, baseDelayMs: 500, maxDelayMs: 1000 },
        },
        globalPath
      );
      await saveConfigOverride(
        {
          run: { interactive: false },
          retry: { baseDelayMs: 750, maxDelayMs: 4000 },
        },
        localPath
      );

      const result = await loadEffectiveConfigWithDiagnostics(nestedPath, { globalPath });

      expect(result.config?.run).toEqual({ simplifier: false, interactive: false });
      expect(result.config?.retry).toEqual({ maxRetries: 1, baseDelayMs: 750, maxDelayMs: 4000 });
    });

    test("loadEffectiveConfigWithDiagnostics resolves the repo-local path from the git top-level", async () => {
      const globalPath = join(tempDir, "global-config.json");
      const repoPath = join(tempDir, "repo");
      const nestedPath = join(repoPath, "packages", "cli", "src");
      const localPath = getRepoConfigPath(repoPath);
      await ensureConfigDir(nestedPath);
      runGitIn(repoPath, ["init", "--initial-branch=main"]);
      await saveConfig(testConfig, globalPath);
      await saveConfigOverride({ maxIterations: 9 }, localPath);

      const result = await loadEffectiveConfigWithDiagnostics(nestedPath, { globalPath });

      expect(result.config?.maxIterations).toBe(9);
      expect(result.localPath?.endsWith("/repo/.ralph-review/config.json")).toBe(true);
      expect(result.repoRoot?.endsWith("/repo")).toBe(true);
    });

    test("loadConfigOverrideWithDiagnostics reports invalid local JSON syntax", async () => {
      const repoPath = join(tempDir, "repo");
      const localPath = getRepoConfigPath(repoPath);
      await ensureConfigDir(join(repoPath, ".ralph-review"));
      await Bun.write(localPath, "{ invalid json");

      const result = await loadConfigOverrideWithDiagnostics(localPath);

      expect(result.exists).toBe(true);
      expect(result.config).toBeNull();
      expect(result.errors[0]).toContain("Invalid JSON syntax:");
    });

    test("loadEffectiveConfigWithDiagnostics fails loudly when the local override is invalid", async () => {
      const globalPath = join(tempDir, "global-config.json");
      const repoPath = join(tempDir, "repo");
      const nestedPath = join(repoPath, "packages", "app");
      const localPath = getRepoConfigPath(repoPath);
      await ensureConfigDir(nestedPath);
      runGitIn(repoPath, ["init", "--initial-branch=main"]);
      await saveConfig(testConfig, globalPath);
      await ensureConfigDir(join(repoPath, ".ralph-review"));
      await Bun.write(localPath, "{ invalid json");

      const result = await loadEffectiveConfigWithDiagnostics(nestedPath, { globalPath });

      expect(result.exists).toBe(true);
      expect(result.config).toBeNull();
      expect(result.errors.some((error) => error.includes(localPath))).toBe(true);
    });

    test("loadEffectiveConfigWithDiagnostics reports both global and local parse errors together", async () => {
      const globalPath = join(tempDir, "global-invalid.json");
      const repoPath = join(tempDir, "repo");
      const nestedPath = join(repoPath, "packages", "app");
      const localPath = getRepoConfigPath(repoPath);
      await ensureConfigDir(nestedPath);
      runGitIn(repoPath, ["init", "--initial-branch=main"]);
      await Bun.write(globalPath, "{ invalid global json");
      await ensureConfigDir(join(repoPath, ".ralph-review"));
      await Bun.write(localPath, "{ invalid local json");

      const result = await loadEffectiveConfigWithDiagnostics(nestedPath, { globalPath });

      expect(result.exists).toBe(true);
      expect(result.config).toBeNull();
      expect(result.globalErrors[0]).toContain("Invalid JSON syntax:");
      expect(result.localErrors[0]).toContain("Invalid JSON syntax:");
      expect(result.errors.some((error) => error.includes(localPath))).toBe(true);
      expect(result.errors.some((error) => error.includes(globalPath))).toBe(true);
    });

    test("loadEffectiveConfigWithDiagnostics rejects a valid local override that cannot produce a full config", async () => {
      const repoPath = join(tempDir, "repo");
      const nestedPath = join(repoPath, "packages", "app");
      const localPath = getRepoConfigPath(repoPath);
      await ensureConfigDir(nestedPath);
      runGitIn(repoPath, ["init", "--initial-branch=main"]);
      await saveConfigOverride({ maxIterations: 4 }, localPath);

      const result = await loadEffectiveConfigWithDiagnostics(nestedPath, {
        globalPath: join(tempDir, "missing-global.json"),
      });

      expect(result.exists).toBe(true);
      expect(result.config).toBeNull();
      expect(result.errors).toContain("Effective configuration is invalid.");
      expect(result.errors.some((error) => error.includes("reviewer must be an object."))).toBe(
        true
      );
      expect(result.errors.some((error) => error.includes(localPath))).toBe(true);
    });

    test("loadEffectiveConfigWithDiagnostics keeps a full repo-local config usable when the global file is invalid", async () => {
      const globalPath = join(tempDir, "global-invalid.json");
      const repoPath = join(tempDir, "repo");
      const nestedPath = join(repoPath, "packages", "app");
      const localPath = getRepoConfigPath(repoPath);
      await ensureConfigDir(nestedPath);
      runGitIn(repoPath, ["init", "--initial-branch=main"]);
      await Bun.write(globalPath, "{ invalid global json");
      await saveConfigOverride(testConfig, localPath);

      const result = await loadEffectiveConfigWithDiagnostics(nestedPath, { globalPath });

      expect(result.exists).toBe(true);
      expect(result.config).toEqual(testConfig);
      expect(result.errors[0]).toContain(`Invalid global config at ${globalPath}`);
      expect(result.globalErrors[0]).toContain("Invalid JSON syntax:");
      expect(result.localErrors).toEqual([]);
      expect(result.source).toBe("local");
    });

    test("loadEffectiveConfigWithDiagnostics reports invalid global config diagnostics", async () => {
      const globalPath = join(tempDir, "global-invalid.json");
      const projectPath = join(tempDir, "project");
      await ensureConfigDir(projectPath);
      await Bun.write(globalPath, "{ invalid json");

      const result = await loadEffectiveConfigWithDiagnostics(projectPath, {
        globalPath,
        repositoryRootResolver: async () => undefined,
      });

      expect(result.exists).toBe(true);
      expect(result.source).toBe("global");
      expect(result.config).toBeNull();
      expect(result.errors[0]).toContain(`Invalid global config at ${globalPath}`);
    });

    test("loadEffectiveConfigWithDiagnostics returns none when no global or repo-local config exists", async () => {
      const projectPath = join(tempDir, "project");
      const globalPath = join(tempDir, "missing-global.json");
      await ensureConfigDir(projectPath);

      const result = await loadEffectiveConfigWithDiagnostics(projectPath, {
        globalPath,
        repositoryRootResolver: async () => undefined,
      });

      expect(result).toEqual({
        exists: false,
        source: "none",
        config: null,
        errors: [],
        globalPath,
        localPath: null,
        repoRoot: null,
        globalExists: false,
        localExists: false,
        globalErrors: [],
        localErrors: [],
      });
    });

    test("loadEffectiveConfig returns the resolved effective config", async () => {
      const globalPath = join(tempDir, "global-config.json");
      const projectPath = join(tempDir, "project");
      await ensureConfigDir(projectPath);
      await saveConfig(testConfig, globalPath);

      const result = await loadEffectiveConfig(projectPath, {
        globalPath,
        repositoryRootResolver: async () => undefined,
      });

      expect(result).toEqual(testConfig);
    });

    test("loadEffectiveConfig returns null when no config can be resolved", async () => {
      const projectPath = join(tempDir, "project");
      await ensureConfigDir(projectPath);

      const result = await loadEffectiveConfig(projectPath, {
        globalPath: join(tempDir, "missing-global.json"),
        repositoryRootResolver: async () => undefined,
      });

      expect(result).toBeNull();
    });
  });
});
