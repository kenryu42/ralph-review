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
    watch: z.boolean().optional(),
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

function decodeOutput(output: Uint8Array): string {
  return new TextDecoder().decode(output).trim();
}

async function resolveBiomeExecutable(): Promise<string> {
  const localBiomeExecutable = resolve("node_modules/.bin/biome");
  if (await Bun.file(localBiomeExecutable).exists()) {
    return localBiomeExecutable;
  }

  const biomeExecutable = Bun.which("biome");
  if (!biomeExecutable) {
    throw new Error("biome executable is required to format schema output");
  }

  return biomeExecutable;
}

async function main(): Promise<void> {
  const schema = z.toJSONSchema(configSchema);
  const outputPath = resolve(SCHEMA_OUTPUT_PATH);
  const schemaText = `${JSON.stringify(schema, null, 2)}\n`;
  const biomeExecutable = await resolveBiomeExecutable();

  await mkdir(dirname(outputPath), { recursive: true });
  await Bun.write(outputPath, schemaText);

  const formatResult = Bun.spawnSync({
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

  console.log(`Generated schema: ${outputPath}`);
}

main().catch((error) => {
  console.error(`Failed to generate schema: ${error}`);
  process.exit(1);
});
