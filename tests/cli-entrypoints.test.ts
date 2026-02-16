import { describe, expect, test } from "bun:test";
import { type CliDeps, runCli, runCliEntrypoint } from "@/cli";
import { CliError, type CommandDef } from "@/lib/cli-parser";

interface CliHarness {
  deps: Partial<CliDeps>;
  logs: string[];
  errors: string[];
  messages: string[];
  exits: number[];
  parseCalls: Array<{ command: string; argv: string[] }>;
  calls: string[];
}

function createCommandDef(name: string, aliases?: string[]): CommandDef {
  return { name, aliases, description: `${name} command` };
}

function createCliHarness(overrides: Partial<CliDeps> = {}): CliHarness {
  const logs: string[] = [];
  const errors: string[] = [];
  const messages: string[] = [];
  const exits: number[] = [];
  const parseCalls: Array<{ command: string; argv: string[] }> = [];
  const calls: string[] = [];

  const parseCommandStub: CliDeps["parseCommand"] = <T = Record<string, unknown>>(
    def: CommandDef,
    argv: string[]
  ) => {
    parseCalls.push({ command: def.name, argv: [...argv] });
    return { values: {} as T, positional: [] };
  };

  const deps: Partial<CliDeps> = {
    parseArgs: () => ({ command: "", args: [], showHelp: false, showVersion: false }),
    getVersion: () => "0.0.0-test",
    printUsage: () => "USAGE",
    printCommandHelp: () => undefined,
    getCommandDef: () => undefined,
    parseCommand: parseCommandStub,
    runInit: async () => {
      calls.push("init");
    },
    runConfig: async (argv) => {
      calls.push(`config:${argv.join(",")}`);
    },
    startReview: async (argv) => {
      calls.push(`run:${argv.join(",")}`);
    },
    runForeground: async (argv) => {
      calls.push(`_run-foreground:${argv?.join(",") ?? ""}`);
    },
    runStatus: async () => {
      calls.push("status");
    },
    runStop: async (argv) => {
      calls.push(`stop:${argv.join(",")}`);
    },
    runLog: async (argv) => {
      calls.push(`log:${argv.join(",")}`);
    },
    runDashboard: async (argv) => {
      calls.push(`dashboard:${argv.join(",")}`);
    },
    runDoctor: async (argv) => {
      calls.push(`doctor:${argv?.join(",") ?? ""}`);
    },
    runList: async () => {
      calls.push("list");
    },
    log: (message) => {
      logs.push(message);
    },
    logError: (message) => {
      errors.push(message);
    },
    logMessage: (message) => {
      messages.push(message);
    },
    exit: (code) => {
      exits.push(code);
    },
    ...overrides,
  };

  return {
    deps,
    logs,
    errors,
    messages,
    exits,
    parseCalls,
    calls,
  };
}

describe("cli entrypoints", () => {
  test("prints version and returns when --version is requested", async () => {
    const harness = createCliHarness({
      parseArgs: () => ({ command: "", args: [], showHelp: false, showVersion: true }),
      getVersion: () => "1.2.3",
    });

    await runCli([], harness.deps);

    expect(harness.logs).toEqual(["ralph-review v1.2.3"]);
    expect(harness.calls).toEqual([]);
    expect(harness.exits).toEqual([]);
  });

  test("prints usage when no command is provided", async () => {
    const harness = createCliHarness({
      parseArgs: () => ({ command: "", args: [], showHelp: false, showVersion: false }),
      printUsage: () => "USAGE",
    });

    await runCli([], harness.deps);

    expect(harness.logs).toEqual(["USAGE"]);
    expect(harness.exits).toEqual([]);
  });

  test("prints command help when --help is passed with a valid command", async () => {
    const harness = createCliHarness({
      parseArgs: () => ({ command: "run", args: [], showHelp: true, showVersion: false }),
      printCommandHelp: () => "RUN HELP",
    });

    await runCli([], harness.deps);

    expect(harness.logs).toEqual(["RUN HELP"]);
    expect(harness.exits).toEqual([]);
  });

  test("falls back to usage when help is requested for unknown command", async () => {
    const harness = createCliHarness({
      parseArgs: () => ({ command: "unknown", args: [], showHelp: true, showVersion: false }),
      printCommandHelp: () => undefined,
      printUsage: () => "USAGE",
    });

    await runCli([], harness.deps);

    expect(harness.logs).toEqual(["USAGE"]);
    expect(harness.exits).toEqual([]);
  });

  test("resolves aliases before validation and dispatch", async () => {
    const listDef = createCommandDef("list", ["ls"]);
    const harness = createCliHarness({
      parseArgs: () => ({ command: "ls", args: ["--json"], showHelp: false, showVersion: false }),
      getCommandDef: (name) => {
        if (name === "ls" || name === "list") return listDef;
        return undefined;
      },
    });

    await runCli([], harness.deps);

    expect(harness.parseCalls).toEqual([{ command: "list", argv: ["--json"] }]);
    expect(harness.calls).toEqual(["list"]);
    expect(harness.exits).toEqual([]);
  });

  test("dispatches all non-run command handlers", async () => {
    const scenarios = [
      { command: "init", args: [], expectedCall: "init" },
      { command: "_run-foreground", args: ["--max", "1"], expectedCall: "_run-foreground:--max,1" },
      { command: "status", args: [], expectedCall: "status" },
      { command: "stop", args: ["--all"], expectedCall: "stop:--all" },
      { command: "log", args: ["--json"], expectedCall: "log:--json" },
      {
        command: "dashboard",
        args: ["--host", "127.0.0.1"],
        expectedCall: "dashboard:--host,127.0.0.1",
      },
      { command: "doctor", args: ["--fix"], expectedCall: "doctor:--fix" },
    ] as const;

    const defs = new Map<string, CommandDef>(
      scenarios.map((scenario) => [scenario.command, createCommandDef(scenario.command)])
    );
    const harness = createCliHarness({
      getCommandDef: (name) => defs.get(name),
    });

    for (const scenario of scenarios) {
      await runCli([], {
        ...harness.deps,
        parseArgs: () => ({
          command: scenario.command,
          args: [...scenario.args],
          showHelp: false,
          showVersion: false,
        }),
      });
    }

    expect(harness.calls).toEqual(scenarios.map((scenario) => scenario.expectedCall));
    expect(harness.parseCalls.map((call) => call.command)).toEqual(
      scenarios.map((scenario) => scenario.command)
    );
    expect(harness.exits).toEqual([]);
  });

  test("skips strict argument parser for config command", async () => {
    const configDef = createCommandDef("config");
    const harness = createCliHarness({
      parseArgs: () => ({
        command: "config",
        args: ["set", "reviewer.agent", "codex"],
        showHelp: false,
        showVersion: false,
      }),
      getCommandDef: (name) => (name === "config" ? configDef : undefined),
    });

    await runCli([], harness.deps);

    expect(harness.parseCalls).toHaveLength(0);
    expect(harness.calls).toEqual(["config:set,reviewer.agent,codex"]);
    expect(harness.exits).toEqual([]);
  });

  test("formats CliError output and exits with status 1", async () => {
    const runDef = createCommandDef("run");
    const harness = createCliHarness({
      parseArgs: () => ({ command: "run", args: ["--bad"], showHelp: false, showVersion: false }),
      getCommandDef: (name) => (name === "run" ? runDef : undefined),
      parseCommand: () => {
        throw new CliError("run", "unknown_option", "--bad", ["--max"], "--max 5");
      },
    });

    await runCli([], harness.deps);

    expect(harness.errors).toEqual(['run: unknown option "--bad"']);
    expect(harness.messages).toContain('Did you mean "--max 5"?');
    expect(harness.messages).toContain("Valid options: --max");
    expect(harness.messages).toContain("Run: rr run --help");
    expect(harness.exits).toEqual([1]);
  });

  test("reports non-CliError parser failures and exits", async () => {
    const runDef = createCommandDef("run");
    const harness = createCliHarness({
      parseArgs: () => ({ command: "run", args: ["--bad"], showHelp: false, showVersion: false }),
      getCommandDef: (name) => (name === "run" ? runDef : undefined),
      parseCommand: () => {
        throw new Error("parser failed");
      },
    });

    await runCli([], harness.deps);

    expect(harness.errors).toEqual(["Error: parser failed"]);
    expect(harness.exits).toEqual([1]);
  });

  test("prints unknown command error, usage, and exits", async () => {
    const harness = createCliHarness({
      parseArgs: () => ({ command: "mystery", args: [], showHelp: false, showVersion: false }),
      printUsage: () => "USAGE",
      getCommandDef: () => undefined,
    });

    await runCli([], harness.deps);

    expect(harness.errors).toEqual(["Unknown command: mystery"]);
    expect(harness.logs).toEqual(["\nUSAGE"]);
    expect(harness.exits).toEqual([1]);
  });

  test("treats renamed logs command as unknown", async () => {
    const harness = createCliHarness({
      parseArgs: () => ({ command: "logs", args: [], showHelp: false, showVersion: false }),
      printUsage: () => "USAGE",
      getCommandDef: () => undefined,
    });

    await runCli([], harness.deps);

    expect(harness.errors).toEqual(["Unknown command: logs"]);
    expect(harness.logs).toEqual(["\nUSAGE"]);
    expect(harness.exits).toEqual([1]);
  });

  test("reports command execution failures and exits", async () => {
    const runDef = createCommandDef("run");
    const harness = createCliHarness({
      parseArgs: () => ({
        command: "run",
        args: ["--max", "2"],
        showHelp: false,
        showVersion: false,
      }),
      getCommandDef: (name) => (name === "run" ? runDef : undefined),
      startReview: async () => {
        throw new Error("kaboom");
      },
    });

    await runCli([], harness.deps);

    expect(harness.errors).toEqual(["Error: Error: kaboom"]);
    expect(harness.exits).toEqual([1]);
  });

  test("runCliEntrypoint reports fatal rejections and exits", async () => {
    const errors: string[] = [];
    const exits: number[] = [];

    runCliEntrypoint(() => Promise.reject(new Error("fatal")), {
      logError: (message) => {
        errors.push(message);
      },
      exit: (code) => {
        exits.push(code);
      },
    });

    await Bun.sleep(0);

    expect(errors).toEqual(["Fatal error: Error: fatal"]);
    expect(exits).toEqual([1]);
  });
});
