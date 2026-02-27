import { describe, expect, test } from "bun:test";
import { parseConfig } from "@/lib/config";
import { CONFIG_SCHEMA_URI, CONFIG_VERSION } from "@/lib/types";

interface JsonSchema {
  properties?: Record<string, unknown>;
  required?: unknown;
}

describe("config schema artifact", () => {
  test("contains canonical metadata fields and required config keys", async () => {
    const schemaText = await Bun.file("assets/ralph-review.schema.json").text();
    const schema = JSON.parse(schemaText) as JsonSchema;

    const properties = schema.properties ?? {};
    const required = Array.isArray(schema.required) ? schema.required : [];

    expect(properties.$schema).toBeDefined();
    expect(properties.version).toBeDefined();
    expect(properties.reviewer).toBeDefined();
    expect(properties.fixer).toBeDefined();
    expect(properties.defaultReview).toBeDefined();
    expect(properties.run).toBeDefined();
    expect(properties.notifications).toBeDefined();

    const schemaProperty = properties.$schema as Record<string, unknown>;
    expect(schemaProperty.const).toBe(CONFIG_SCHEMA_URI);

    const versionProperty = properties.version as Record<string, unknown>;
    expect(versionProperty.const).toBe(CONFIG_VERSION);

    expect(required).toContain("$schema");
    expect(required).toContain("version");
    expect(required).toContain("reviewer");
    expect(required).toContain("fixer");
    expect(required).toContain("maxIterations");
    expect(required).toContain("iterationTimeout");
    expect(required).toContain("defaultReview");
  });

  test("defines run shape with required simplifier and optional watch booleans", async () => {
    const schemaText = await Bun.file("assets/ralph-review.schema.json").text();
    const schema = JSON.parse(schemaText) as JsonSchema;
    const properties = schema.properties ?? {};
    const runProperty = properties.run as
      | { properties?: Record<string, unknown>; required?: unknown }
      | undefined;
    const runProperties = runProperty?.properties ?? {};
    const simplifierProperty = runProperties.simplifier as Record<string, unknown> | undefined;
    const watchProperty = runProperties.watch as Record<string, unknown> | undefined;
    const required = Array.isArray(runProperty?.required) ? runProperty.required : [];

    expect(simplifierProperty?.type).toBe("boolean");
    expect(watchProperty?.type).toBe("boolean");
    expect(required).toContain("simplifier");
    expect(required).not.toContain("watch");
  });

  test("includes every top-level key emitted by parseConfig", async () => {
    const candidate = {
      reviewer: { agent: "codex", model: "gpt-5.2-codex", reasoning: "medium" },
      fixer: { agent: "claude", model: "sonnet", reasoning: "high" },
      "code-simplifier": { agent: "gemini", model: "gemini-2.5-pro", reasoning: "low" },
      run: { simplifier: true, watch: false },
      maxIterations: 5,
      iterationTimeout: 1800000,
      retry: { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 30000 },
      defaultReview: { type: "base", branch: "main" },
      notifications: { sound: { enabled: true } },
    };

    const parsed = parseConfig(candidate);
    expect(parsed).not.toBeNull();

    const schemaText = await Bun.file("assets/ralph-review.schema.json").text();
    const schema = JSON.parse(schemaText) as JsonSchema;
    const properties = schema.properties ?? {};

    for (const key of Object.keys(parsed ?? {})) {
      expect(properties[key]).toBeDefined();
    }
  });

  test("matches biome formatting output", async () => {
    const schemaPath = "assets/ralph-review.schema.json";
    const localBiomeExecutable = `${process.cwd()}/node_modules/.bin/biome`;
    const biomeExecutable = (await Bun.file(localBiomeExecutable).exists())
      ? localBiomeExecutable
      : Bun.which("biome");

    expect(biomeExecutable).toBeString();
    if (!biomeExecutable) {
      throw new Error("biome executable is required for schema formatting checks");
    }

    const formatResult = Bun.spawnSync({
      cmd: [biomeExecutable, "ci", schemaPath],
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(formatResult.exitCode).toBe(0);
  });
});
