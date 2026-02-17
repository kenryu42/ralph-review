import { describe, expect, spyOn, test } from "bun:test";
import * as cli from "@/cli";
import { runLog } from "@/commands/log";
import * as logger from "@/lib/logger";

const EXIT_PREFIX = "__FORCED_EXIT__:";

async function withMutedTerminalLogs<T>(run: () => Promise<T>): Promise<T> {
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

async function captureJsonOutput(run: () => Promise<void>): Promise<unknown[]> {
  const outputs: unknown[] = [];
  const originalConsoleLog = console.log;
  console.log = ((...args: unknown[]) => {
    if (args.length === 1 && typeof args[0] === "string") {
      outputs.push(JSON.parse(args[0]));
      return;
    }
    outputs.push(args);
  }) as typeof console.log;

  try {
    await run();
  } finally {
    console.log = originalConsoleLog;
  }

  return outputs;
}

async function captureExitCode(run: () => Promise<void>): Promise<number | undefined> {
  const originalExit = process.exit;
  process.exit = ((code?: number) => {
    throw new Error(`${EXIT_PREFIX}${code ?? 0}`);
  }) as typeof process.exit;

  try {
    await run();
    return undefined;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(EXIT_PREFIX)) {
      return Number.parseInt(error.message.slice(EXIT_PREFIX.length), 10);
    }
    throw error;
  } finally {
    process.exit = originalExit;
  }
}

describe("runLog guarded branches", () => {
  test("exits with code 1 when log command definition is unavailable", async () => {
    const commandDefSpy = spyOn(cli, "getCommandDef").mockImplementation(() => undefined);
    try {
      const exitCode = await withMutedTerminalLogs(() =>
        captureExitCode(async () => {
          await runLog([]);
        })
      );

      expect(exitCode).toBe(1);
    } finally {
      commandDefSpy.mockRestore();
    }
  });

  test("prints empty global JSON when no global log sessions are discovered", async () => {
    const listLogSessionsSpy = spyOn(logger, "listLogSessions").mockImplementation(async () => []);
    try {
      const outputs = await captureJsonOutput(async () => {
        await runLog(["--json", "--global"]);
      });

      expect(outputs).toEqual([{ sessions: [] }]);
    } finally {
      listLogSessionsSpy.mockRestore();
    }
  });
});
