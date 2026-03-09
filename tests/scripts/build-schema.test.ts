import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildConfigJsonSchema,
  reportBuildSchemaError,
  runBuildSchema,
} from "../../scripts/build-schema";

interface JsonSchema {
  properties?: Record<string, unknown>;
}

describe("build-schema script", () => {
  test("emits run.interactive and not run.watch", () => {
    const schema = buildConfigJsonSchema() as JsonSchema;
    const runProperty = schema.properties?.run as
      | { properties?: Record<string, unknown> }
      | undefined;
    const runProperties = runProperty?.properties ?? {};

    expect(runProperties.interactive).toBeDefined();
    expect(runProperties.watch).toBeUndefined();
  });

  test("writes schema and formats it with the local biome executable when available", async () => {
    const writes: Array<{ path: string; text: string }> = [];
    const spawnCalls: string[][] = [];
    const logs: string[] = [];

    await runBuildSchema("/tmp/ralph-review.schema.json", {
      localBiomeExecutable: "/repo/node_modules/.bin/biome",
      fileExists: async () => true,
      mkdir: async () => {},
      write: async (path, text) => {
        writes.push({ path, text });
      },
      spawnSync: (options) => {
        spawnCalls.push(options.cmd);
        return {
          exitCode: 0,
          stderr: new Uint8Array(),
        };
      },
      log: (message) => {
        logs.push(message);
      },
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe("/tmp/ralph-review.schema.json");
    expect(writes[0]?.text).toContain('"interactive"');
    expect(writes[0]?.text).not.toContain('"watch"');
    expect(spawnCalls).toEqual([
      ["/repo/node_modules/.bin/biome", "format", "--write", "/tmp/ralph-review.schema.json"],
    ]);
    expect(logs).toEqual(["Generated schema: /tmp/ralph-review.schema.json"]);
  });

  test("falls back to Bun.which when the local biome executable is missing", async () => {
    const spawnCalls: string[][] = [];

    await runBuildSchema("/tmp/ralph-review.schema.json", {
      localBiomeExecutable: "/repo/node_modules/.bin/biome",
      fileExists: async () => false,
      which: () => "/usr/local/bin/biome",
      mkdir: async () => {},
      write: async () => {},
      spawnSync: (options) => {
        spawnCalls.push(options.cmd);
        return {
          exitCode: 0,
          stderr: new Uint8Array(),
        };
      },
      log: () => {},
    });

    expect(spawnCalls).toEqual([
      ["/usr/local/bin/biome", "format", "--write", "/tmp/ralph-review.schema.json"],
    ]);
  });

  test("throws a clear error when no biome executable is available", async () => {
    await expect(
      runBuildSchema("/tmp/ralph-review.schema.json", {
        localBiomeExecutable: "/repo/node_modules/.bin/biome",
        fileExists: async () => false,
        which: () => undefined,
      })
    ).rejects.toThrow("biome executable is required to format schema output");
  });

  test("throws biome stderr when formatting fails", async () => {
    await expect(
      runBuildSchema("/tmp/ralph-review.schema.json", {
        localBiomeExecutable: "/repo/node_modules/.bin/biome",
        fileExists: async () => true,
        mkdir: async () => {},
        write: async () => {},
        spawnSync: () => ({
          exitCode: 1,
          stderr: new TextEncoder().encode("format failed"),
        }),
        log: () => {},
      })
    ).rejects.toThrow("Biome failed to format schema (exit 1): format failed");
  });

  test("uses default dependencies to write a formatted schema file", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "build-schema-test-"));
    const outputPath = join(tempDir, "ralph-review.schema.json");
    const originalLog = console.log;
    const logs: string[] = [];

    console.log = ((message?: unknown) => {
      logs.push(String(message));
    }) as typeof console.log;

    try {
      await runBuildSchema(outputPath);

      const schemaText = await Bun.file(outputPath).text();
      expect(schemaText).toContain('"interactive"');
      expect(schemaText).not.toContain('"watch"');
      expect(logs).toContain(`Generated schema: ${outputPath}`);
    } finally {
      console.log = originalLog;
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("reports script errors and exits with code 1", () => {
    const errors: string[] = [];
    const exits: number[] = [];

    reportBuildSchemaError(new Error("boom"), {
      errorLog: (message) => {
        errors.push(message);
      },
      exit: (code) => {
        exits.push(code);
      },
    });

    expect(errors).toEqual(["Failed to generate schema: Error: boom"]);
    expect(exits).toEqual([1]);
  });
});
