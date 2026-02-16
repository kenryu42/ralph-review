import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AGENTS } from "@/lib/agents/registry";
import { resolveAgentSettings, runAgent } from "@/lib/agents/runner";
import {
  type AgentSettings,
  CONFIG_SCHEMA_URI,
  CONFIG_VERSION,
  type Config,
  type ReviewOptions,
} from "@/lib/types";

const baseConfig: Config = {
  $schema: CONFIG_SCHEMA_URI,
  version: CONFIG_VERSION,
  reviewer: { agent: "codex", model: "gpt-5.2-codex", reasoning: "high" },
  fixer: { agent: "claude", model: "claude-sonnet-4-5", reasoning: "medium" },
  maxIterations: 5,
  iterationTimeout: 1800000,
  defaultReview: { type: "uncommitted" },
  notifications: { sound: { enabled: false } },
};

type AgentModule = (typeof AGENTS)["codex"];
type SpawnProcess = ReturnType<typeof Bun.spawn>;

let originalCodexModule: AgentModule;
let originalPiModule: (typeof AGENTS)["pi"];
let originalSpawn: typeof Bun.spawn;

function createTextStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function createErroringStream(delayMs: number): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      setTimeout(() => {
        controller.error(new Error("stream failure"));
      }, delayMs);
    },
  });
}

function createMockProcess(
  stdout: ReadableStream<Uint8Array> | null,
  stderr: ReadableStream<Uint8Array> | null,
  exited: Promise<number>
): SpawnProcess {
  return {
    stdout,
    stderr,
    exited,
  } as unknown as SpawnProcess;
}

async function withMutedTerminalStreams<T>(run: () => Promise<T>): Promise<T> {
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;

  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;

  try {
    return await run();
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
}

beforeEach(() => {
  originalCodexModule = AGENTS.codex;
  originalPiModule = AGENTS.pi;
  originalSpawn = Bun.spawn;
});

afterEach(() => {
  AGENTS.codex = originalCodexModule;
  AGENTS.pi = originalPiModule;
  Bun.spawn = originalSpawn;
});

describe("resolveAgentSettings", () => {
  test("returns reviewer settings for reviewer role", () => {
    expect(resolveAgentSettings("reviewer", baseConfig)).toEqual(baseConfig.reviewer);
  });

  test("returns fixer settings for fixer role", () => {
    expect(resolveAgentSettings("fixer", baseConfig)).toEqual(baseConfig.fixer);
  });

  test("falls back to reviewer settings for simplifier when custom config is missing", () => {
    expect(resolveAgentSettings("code-simplifier", baseConfig)).toEqual(baseConfig.reviewer);
  });

  test("uses custom simplifier settings when configured", () => {
    const customSimplifier: AgentSettings = {
      agent: "droid",
      model: "gpt-5.2-codex",
      reasoning: "xhigh",
    };
    const configWithSimplifier: Config = {
      ...baseConfig,
      "code-simplifier": customSimplifier,
    };

    expect(resolveAgentSettings("code-simplifier", configWithSimplifier)).toEqual(customSimplifier);
  });
});

describe("runAgent", () => {
  test("returns success output and appends stderr block on zero exit code", async () => {
    let buildEnvReasoning: string | undefined;
    let spawnCommand: string[] = [];
    let spawnEnv: Record<string, string> | undefined;
    const reviewOptions: ReviewOptions = {
      baseBranch: "main",
      customInstructions: "check auth flows",
    };

    AGENTS.codex = {
      config: {
        command: "mock-codex-command",
        buildArgs: (role, prompt, model, options, provider, reasoning) => {
          expect(role).toBe("reviewer");
          expect(prompt).toBe("review prompt");
          expect(model).toBe("gpt-5.2-codex");
          expect(options).toEqual(reviewOptions);
          expect(provider).toBeUndefined();
          expect(reasoning).toBe("high");
          return ["--model", model ?? "missing"];
        },
        buildEnv: (reasoning) => {
          buildEnvReasoning = reasoning;
          return {
            PATH: process.env.PATH ?? "",
            TEST_ENV: "runner-success",
          };
        },
      },
      usesJsonl: false,
      extractResult: (output) => output,
    };

    Bun.spawn = ((command, options) => {
      spawnCommand = [...(command as string[])];
      spawnEnv = (options as { env?: Record<string, string> }).env;
      return createMockProcess(
        createTextStream("stdout line\n"),
        createTextStream("stderr line\n"),
        Promise.resolve(0)
      );
    }) as typeof Bun.spawn;

    const result = await withMutedTerminalStreams(() =>
      runAgent("reviewer", baseConfig, "review prompt", 5000, reviewOptions)
    );

    expect(buildEnvReasoning).toBe("high");
    expect(spawnCommand).toEqual(["mock-codex-command", "--model", "gpt-5.2-codex"]);
    expect(spawnEnv?.TEST_ENV).toBe("runner-success");
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("stdout line");
    expect(result.output).toContain("[stderr]");
    expect(result.output).toContain("stderr line");
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  test("uses default prompt and config iteration timeout when omitted", async () => {
    let capturedPrompt = "unexpected";

    AGENTS.codex = {
      config: {
        command: "mock-defaults-command",
        buildArgs: (_role, prompt) => {
          capturedPrompt = prompt;
          return [];
        },
        buildEnv: () => ({ PATH: process.env.PATH ?? "" }),
      },
      usesJsonl: false,
      extractResult: (output) => output,
    };

    Bun.spawn = (() => {
      return createMockProcess(createTextStream("ok\n"), null, Promise.resolve(0));
    }) as typeof Bun.spawn;

    const result = await withMutedTerminalStreams(() => runAgent("reviewer", baseConfig));

    expect(capturedPrompt).toBe("");
    expect(result.success).toBe(true);
    expect(result.output).toBe("ok\n");
  });

  test("forwards pi provider to buildArgs when selected agent is pi", async () => {
    let capturedProvider: string | undefined;
    const piConfig: Config = {
      ...baseConfig,
      reviewer: {
        agent: "pi",
        provider: "openai",
        model: "gpt-5.2-codex",
        reasoning: "xhigh",
      },
    };

    AGENTS.pi = {
      config: {
        command: "mock-pi-command",
        buildArgs: (_role, _prompt, _model, _reviewOptions, provider) => {
          capturedProvider = provider;
          return [];
        },
        buildEnv: () => ({ PATH: process.env.PATH ?? "" }),
      },
      usesJsonl: true,
      formatLine: (line) => line,
      extractResult: (output) => output,
    };

    Bun.spawn = (() => {
      return createMockProcess(createTextStream("pi output\n"), null, Promise.resolve(0));
    }) as typeof Bun.spawn;

    const result = await withMutedTerminalStreams(() =>
      runAgent("reviewer", piConfig, "pi prompt", 5000)
    );

    expect(capturedProvider).toBe("openai");
    expect(result.success).toBe(true);
  });

  test("returns timeout result when stream processing fails after timeout abort", async () => {
    AGENTS.codex = {
      config: {
        command: "mock-timeout-command",
        buildArgs: () => [],
        buildEnv: () => ({ PATH: process.env.PATH ?? "" }),
      },
      usesJsonl: false,
      extractResult: (output) => output,
    };

    Bun.spawn = (() => {
      return createMockProcess(createErroringStream(20), null, Promise.resolve(0));
    }) as typeof Bun.spawn;

    const result = await withMutedTerminalStreams(() =>
      runAgent("reviewer", baseConfig, "slow prompt", 1)
    );

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(124);
    expect(result.output).toContain("[Timeout after 1ms]");
  });

  test("returns error output when spawn throws before timeout", async () => {
    AGENTS.codex = {
      config: {
        command: "mock-error-command",
        buildArgs: () => [],
        buildEnv: () => ({ PATH: process.env.PATH ?? "" }),
      },
      usesJsonl: false,
      extractResult: (output) => output,
    };

    Bun.spawn = (() => {
      throw new Error("spawn exploded");
    }) as typeof Bun.spawn;

    const result = await withMutedTerminalStreams(() =>
      runAgent("reviewer", baseConfig, "prompt", 5000)
    );

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("[Error: Error: spawn exploded]");
  });
});
