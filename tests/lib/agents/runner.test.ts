import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AGENTS } from "@/lib/agents/registry";
import { resolveAgentSettings, runAgent } from "@/lib/agents/runner";
import { CONFIG_SCHEMA_URI, CONFIG_VERSION, type Config, type ReviewOptions } from "@/lib/types";
import { withMutedTerminalLogs } from "../../helpers/capture";
import { createErroringStream, createMockProcess, createTextStream } from "../../helpers/process";

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

let originalCodexModule: AgentModule;
let originalClaudeModule: (typeof AGENTS)["claude"];
let originalPiModule: (typeof AGENTS)["pi"];
let originalSpawn: typeof Bun.spawn;

function configureCodexAgent(command: string) {
  AGENTS.codex = {
    config: {
      command,
      buildArgs: () => [],
      buildEnv: () => ({ PATH: process.env.PATH ?? "" }),
    },
    usesJsonl: false,
    extractResult: (output) => output,
  };
}

beforeEach(() => {
  originalCodexModule = AGENTS.codex;
  originalClaudeModule = AGENTS.claude;
  originalPiModule = AGENTS.pi;
  originalSpawn = Bun.spawn;
});

afterEach(() => {
  AGENTS.codex = originalCodexModule;
  AGENTS.claude = originalClaudeModule;
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

    const result = await withMutedTerminalLogs(() =>
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
    const claudeReviewerConfig: Config = {
      ...baseConfig,
      reviewer: { agent: "claude", model: "claude-sonnet-4-5", reasoning: "medium" },
    };

    AGENTS.claude = {
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

    const result = await withMutedTerminalLogs(() => runAgent("reviewer", claudeReviewerConfig));

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

    const result = await withMutedTerminalLogs(() =>
      runAgent("reviewer", piConfig, "pi prompt", 5000)
    );

    expect(capturedProvider).toBe("openai");
    expect(result.success).toBe(true);
  });

  test("returns timeout result when stream processing fails after timeout abort", async () => {
    configureCodexAgent("mock-timeout-command");

    Bun.spawn = (() => {
      return createMockProcess(createErroringStream(20), null, Promise.resolve(0));
    }) as typeof Bun.spawn;

    const result = await withMutedTerminalLogs(() =>
      runAgent("reviewer", baseConfig, "slow prompt", 1)
    );

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(124);
    expect(result.output).toContain("[Timeout after 1ms]");
  });

  test("returns error output when spawn throws before timeout", async () => {
    configureCodexAgent("mock-error-command");

    Bun.spawn = (() => {
      throw new Error("spawn exploded");
    }) as typeof Bun.spawn;

    const result = await withMutedTerminalLogs(() =>
      runAgent("reviewer", baseConfig, "prompt", 5000)
    );

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("[Error: Error: spawn exploded]");
  });

  test("passes an explicit working directory to the spawned agent process", async () => {
    let spawnCwd: string | undefined;

    configureCodexAgent("mock-cwd-command");

    Bun.spawn = ((_command, options) => {
      spawnCwd = (options as { cwd?: string }).cwd;
      return createMockProcess(createTextStream("ok\n"), null, Promise.resolve(0));
    }) as typeof Bun.spawn;

    const result = await withMutedTerminalLogs(() =>
      runAgent("reviewer", baseConfig, "prompt", 5000, undefined, "/tmp/sandbox-repo")
    );

    expect(spawnCwd).toBe("/tmp/sandbox-repo");
    expect(result.success).toBe(true);
  });
});
