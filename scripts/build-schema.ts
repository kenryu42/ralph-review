#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import * as z from "zod";
import { CONFIG_SCHEMA_URI, CONFIG_VERSION } from "@/lib/types";

const SCHEMA_OUTPUT_PATH = "assets/ralph-review.schema.json";

const REASONING_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
const NON_PI_AGENTS = ["codex", "claude", "opencode", "droid", "gemini"] as const;

const reasoningSchema = z.enum(REASONING_LEVELS);

const piAgentSettingsSchema = z
  .object({
    agent: z.literal("pi"),
    provider: z.string().min(1),
    model: z.string().min(1),
    reasoning: reasoningSchema.optional(),
  })
  .strict();

const nonPiAgentSettingsSchema = z
  .object({
    agent: z.enum(NON_PI_AGENTS),
    model: z.string().optional(),
    reasoning: reasoningSchema.optional(),
  })
  .strict();

const agentSettingsSchema = z.discriminatedUnion("agent", [
  piAgentSettingsSchema,
  nonPiAgentSettingsSchema,
]);

const defaultReviewSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("uncommitted") }).strict(),
  z.object({ type: z.literal("base"), branch: z.string().trim().min(1) }).strict(),
]);

const retrySchema = z
  .object({
    maxRetries: z.int().min(0),
    baseDelayMs: z.int().positive(),
    maxDelayMs: z.int().positive(),
  })
  .strict();

const runSchema = z
  .object({
    simplifier: z.boolean(),
    interactive: z.boolean().optional(),
  })
  .strict();

const notificationsSchema = z
  .object({
    sound: z
      .object({
        enabled: z.boolean(),
      })
      .strict(),
  })
  .strict();

const configSchema = z
  .object({
    $schema: z.literal(CONFIG_SCHEMA_URI),
    version: z.literal(CONFIG_VERSION),
    reviewer: agentSettingsSchema,
    fixer: agentSettingsSchema,
    "code-simplifier": agentSettingsSchema.optional(),
    run: runSchema.optional(),
    maxIterations: z.int().positive(),
    iterationTimeout: z.int().positive(),
    retry: retrySchema.optional(),
    defaultReview: defaultReviewSchema,
    notifications: notificationsSchema.optional(),
  })
  .strict();

type SchemaWriter = (path: string, data: string) => Promise<unknown>;
type SchemaSpawner = (options: { cmd: string[]; stdout: "pipe"; stderr: "pipe" }) => {
  exitCode: number;
  stderr: Uint8Array;
};

interface BuildSchemaDeps {
  localBiomeExecutable: string;
  fileExists(path: string): Promise<boolean>;
  which(command: string): string | null | undefined;
  mkdir: typeof mkdir;
  write: SchemaWriter;
  spawnSync: SchemaSpawner;
  log(message: string): void;
}

interface BuildSchemaErrorDeps {
  errorLog(message: string): void;
  exit(code: number): void;
}

const DEFAULT_ERROR_DEPS: BuildSchemaErrorDeps = {
  errorLog: console.error.bind(console),
  exit: process.exit.bind(process),
};

const DEFAULT_DEPS: BuildSchemaDeps = {
  localBiomeExecutable: resolve("node_modules/.bin/biome"),
  fileExists: async (path) => await Bun.file(path).exists(),
  which: (command) => Bun.which(command),
  mkdir,
  write: async (path, data) => {
    await Bun.write(path, data);
  },
  spawnSync: (options) => Bun.spawnSync(options),
  log: (message) => {
    console.log(message);
  },
};

function decodeOutput(output: Uint8Array): string {
  return new TextDecoder().decode(output).trim();
}

async function resolveBiomeExecutable(deps: BuildSchemaDeps): Promise<string> {
  if (await deps.fileExists(deps.localBiomeExecutable)) {
    return deps.localBiomeExecutable;
  }

  const biomeExecutable = deps.which("biome");
  if (!biomeExecutable) {
    throw new Error("biome executable is required to format schema output");
  }

  return biomeExecutable;
}

export function buildConfigJsonSchema(): object {
  return z.toJSONSchema(configSchema);
}

export async function runBuildSchema(
  outputPath: string = resolve(SCHEMA_OUTPUT_PATH),
  overrides: Partial<BuildSchemaDeps> = {}
): Promise<void> {
  const deps: BuildSchemaDeps = { ...DEFAULT_DEPS, ...overrides };
  const schema = buildConfigJsonSchema();
  const schemaText = `${JSON.stringify(schema, null, 2)}\n`;
  const biomeExecutable = await resolveBiomeExecutable(deps);

  await deps.mkdir(dirname(outputPath), { recursive: true });
  await deps.write(outputPath, schemaText);

  const formatResult = deps.spawnSync({
    cmd: [biomeExecutable, "format", "--write", outputPath],
    stdout: "pipe",
    stderr: "pipe",
  });

  if (formatResult.exitCode !== 0) {
    throw new Error(
      `Biome failed to format schema (exit ${formatResult.exitCode}): ${decodeOutput(
        formatResult.stderr
      )}`
    );
  }

  deps.log(`Generated schema: ${outputPath}`);
}

export function reportBuildSchemaError(
  error: unknown,
  deps: BuildSchemaErrorDeps = DEFAULT_ERROR_DEPS
): void {
  deps.errorLog(`Failed to generate schema: ${error}`);
  deps.exit(1);
}

if (import.meta.main) {
  runBuildSchema().catch(reportBuildSchemaError);
}
