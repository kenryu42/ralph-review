import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as p from "@clack/prompts";
import { runLog } from "@/commands/log";
import { LOGS_DIR } from "@/lib/config";
import { getProjectName, getSummaryPath } from "@/lib/logger";
import type { FixEntry, IterationEntry, LogEntry, SessionEndEntry, SystemEntry } from "@/lib/types";
import { buildFixEntry, buildFixSummary, buildSkippedEntry } from "../test-utils/fix-summary";

const EXIT_PREFIX = "__FORCED_EXIT__:";

function createSystemEntry(projectPath: string): SystemEntry {
  return {
    type: "system",
    timestamp: Date.now(),
    sessionId: crypto.randomUUID(),
    projectPath,
    gitBranch: "main",
    reviewer: { agent: "claude", model: "claude-sonnet-4-20250514" },
    fixer: { agent: "codex" },
    maxIterations: 5,
  };
}

function createIterationEntry(
  iteration: number,
  fixes: FixEntry[] = [],
  skipped = [] as ReturnType<typeof buildSkippedEntry>[],
  rollback?: IterationEntry["rollback"]
): IterationEntry {
  return {
    type: "iteration",
    timestamp: Date.now(),
    iteration,
    duration: 5_000,
    fixes: buildFixSummary({
      decision: "APPLY_MOST",
      stop_iteration: iteration > 1,
      fixes,
      skipped,
    }),
    ...(rollback ? { rollback } : {}),
  };
}

function createSessionEndEntry(status: SessionEndEntry["status"] = "completed"): SessionEndEntry {
  return {
    type: "session_end",
    timestamp: Date.now(),
    status,
    reason: status === "completed" ? "done" : "failed",
    iterations: 2,
  };
}

async function writeLogEntries(logPath: string, entries: LogEntry[]): Promise<void> {
  const content = entries.map((entry) => JSON.stringify(entry)).join("\n");
  const withTrailingNewline = content.length > 0 ? `${content}\n` : "";
  await mkdir(dirname(logPath), { recursive: true });
  await Bun.write(logPath, withTrailingNewline);
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

interface CapturedClackLogs {
  info: string[];
  message: string[];
  success: string[];
}

async function captureClackLogs<T>(
  run: () => Promise<T>
): Promise<{ result: T; logs: CapturedClackLogs }> {
  const logs: CapturedClackLogs = {
    info: [],
    message: [],
    success: [],
  };
  const originalInfo = p.log.info;
  const originalMessage = p.log.message;
  const originalSuccess = p.log.success;

  p.log.info = ((message: string) => {
    logs.info.push(message);
  }) as typeof p.log.info;
  p.log.message = ((message: string) => {
    logs.message.push(message);
  }) as typeof p.log.message;
  p.log.success = ((message: string) => {
    logs.success.push(message);
  }) as typeof p.log.success;

  try {
    const result = await run();
    return { result, logs };
  } finally {
    p.log.info = originalInfo;
    p.log.message = originalMessage;
    p.log.success = originalSuccess;
  }
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

interface ProjectFixture {
  rootPath: string;
  projectPath: string;
  projectName: string;
  logPaths: string[];
}

async function createProjectFixture(): Promise<ProjectFixture> {
  const root = await mkdtemp(join(tmpdir(), "ralph-log-run-"));
  const projectPath = join(root, "project");
  await mkdir(projectPath, { recursive: true });
  const resolvedProjectPath = await realpath(projectPath);

  return {
    rootPath: root,
    projectPath: resolvedProjectPath,
    projectName: getProjectName(resolvedProjectPath),
    logPaths: [],
  };
}

async function cleanupProjectFixture(fixture: ProjectFixture): Promise<void> {
  const logsProjectDir = join(LOGS_DIR, fixture.projectName);
  const lockPath = join(LOGS_DIR, `${fixture.projectName}.lock`);

  await Promise.all(
    fixture.logPaths.flatMap((logPath) => [
      Bun.file(logPath)
        .delete()
        .catch(() => {}),
      Bun.file(getSummaryPath(logPath))
        .delete()
        .catch(() => {}),
    ])
  );
  await rm(logsProjectDir, { recursive: true, force: true });
  await Bun.file(lockPath)
    .delete()
    .catch(() => {});
  await rm(fixture.rootPath, { recursive: true, force: true });
}

async function withProjectCwd<T>(projectPath: string, run: () => Promise<T>): Promise<T> {
  const originalCwd = process.cwd();
  process.chdir(projectPath);
  try {
    return await run();
  } finally {
    process.chdir(originalCwd);
  }
}

const fixtures: ProjectFixture[] = [];

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    if (fixture) {
      await cleanupProjectFixture(fixture);
    }
  }
});

describe("runLog integration", () => {
  test("exits with code 1 on parse failure", async () => {
    const exitCode = await withMutedTerminalLogs(() =>
      captureExitCode(async () => {
        await runLog(["--last", "not-a-number"]);
      })
    );

    expect(exitCode).toBe(1);
  });

  test("exits with code 1 when --global is used without --json", async () => {
    const exitCode = await withMutedTerminalLogs(() =>
      captureExitCode(async () => {
        await runLog(["--global"]);
      })
    );

    expect(exitCode).toBe(1);
  });

  test("exits with code 1 when --last is zero", async () => {
    const exitCode = await withMutedTerminalLogs(() =>
      captureExitCode(async () => {
        await runLog(["--json", "--last", "0"]);
      })
    );

    expect(exitCode).toBe(1);
  });

  test("prints empty project JSON when no sessions exist", async () => {
    const fixture = await createProjectFixture();
    fixtures.push(fixture);

    const outputs = await withProjectCwd(fixture.projectPath, async () =>
      captureJsonOutput(async () => {
        await runLog(["--json"]);
      })
    );

    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toEqual({ project: fixture.projectName, sessions: [] });
  });

  test("prints terminal guidance when no sessions exist", async () => {
    const fixture = await createProjectFixture();
    fixtures.push(fixture);

    const { logs } = await withProjectCwd(fixture.projectPath, async () =>
      withMutedTerminalLogs(async () =>
        captureClackLogs(async () => {
          await runLog([]);
        })
      )
    );

    expect(logs.info).toContain("No review sessions found for current working directory.");
    expect(logs.message).toContain('Start a review with "rr run" first.');
  });

  test("prints empty project JSON when all discovered sessions are unknown and empty", async () => {
    const fixture = await createProjectFixture();
    fixtures.push(fixture);
    const logsProjectDir = join(LOGS_DIR, fixture.projectName);
    const unknownLog = join(logsProjectDir, "unknown.jsonl");
    fixture.logPaths.push(unknownLog);

    await writeLogEntries(unknownLog, []);

    const outputs = await withProjectCwd(fixture.projectPath, async () =>
      captureJsonOutput(async () => {
        await runLog(["--json"]);
      })
    );

    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toEqual({ project: fixture.projectName, sessions: [] });
  });

  test("prints terminal guidance when all discovered sessions are unknown and empty", async () => {
    const fixture = await createProjectFixture();
    fixtures.push(fixture);
    const logsProjectDir = join(LOGS_DIR, fixture.projectName);
    const unknownLog = join(logsProjectDir, "unknown.jsonl");
    fixture.logPaths.push(unknownLog);

    await writeLogEntries(unknownLog, []);

    const { logs } = await withProjectCwd(fixture.projectPath, async () =>
      withMutedTerminalLogs(async () =>
        captureClackLogs(async () => {
          await runLog([]);
        })
      )
    );

    expect(logs.info).toContain("No review sessions found for current working directory.");
    expect(logs.message).toContain('Start a review with "rr run" first.');
  });

  test("renders rollback summary when rollback attempts are recorded", async () => {
    const fixture = await createProjectFixture();
    fixtures.push(fixture);
    const logsProjectDir = join(LOGS_DIR, fixture.projectName);
    const rollbackLog = join(logsProjectDir, "rollback.jsonl");
    fixture.logPaths.push(rollbackLog);

    await writeLogEntries(rollbackLog, [
      createSystemEntry(fixture.projectPath),
      createIterationEntry(1, [], [], { attempted: true, success: false, reason: "test rollback" }),
      createSessionEndEntry("completed"),
    ]);

    const { logs } = await withProjectCwd(fixture.projectPath, async () =>
      withMutedTerminalLogs(async () =>
        captureClackLogs(async () => {
          await runLog([]);
        })
      )
    );

    expect(logs.message).toContain("Rollback: 1 attempts (1 failed)");
  });

  test("renders and outputs project JSON after filtering unknown-empty sessions", async () => {
    const fixture = await createProjectFixture();
    fixtures.push(fixture);
    const logsProjectDir = join(LOGS_DIR, fixture.projectName);

    const unknownLog = join(logsProjectDir, "unknown.jsonl");
    const richLog = join(logsProjectDir, "rich.jsonl");
    const cleanLog = join(logsProjectDir, "clean.jsonl");
    fixture.logPaths.push(unknownLog, richLog, cleanLog);

    await writeLogEntries(unknownLog, []);
    await writeLogEntries(richLog, [
      createSystemEntry(fixture.projectPath),
      createIterationEntry(
        1,
        [buildFixEntry({ id: 1, priority: "P0", title: "Critical fix", file: "src/rich.ts" })],
        [buildSkippedEntry({ id: 2, title: "Skipped issue", reason: "SKIP: pending input" })]
      ),
      createIterationEntry(2),
      createSessionEndEntry("completed"),
    ]);
    await writeLogEntries(cleanLog, [
      createSystemEntry(fixture.projectPath),
      createIterationEntry(1),
      createSessionEndEntry("completed"),
    ]);

    await withProjectCwd(fixture.projectPath, async () =>
      withMutedTerminalLogs(async () => {
        await runLog(["--last", "2"]);
      })
    );

    const outputs = await withProjectCwd(fixture.projectPath, async () =>
      captureJsonOutput(async () => {
        await runLog(["--json", "--last", "2"]);
      })
    );

    expect(outputs).toHaveLength(1);
    const payload = outputs[0] as { sessions: Array<{ status: string }> };
    expect(payload.sessions).toHaveLength(2);
    expect(payload.sessions.map((session) => session.status)).toEqual(["completed", "completed"]);
  });

  test("prints global JSON payload", async () => {
    const fixture = await createProjectFixture();
    fixtures.push(fixture);
    const logPath = join(LOGS_DIR, fixture.projectName, "global.jsonl");
    fixture.logPaths.push(logPath);

    await writeLogEntries(logPath, [
      createSystemEntry(fixture.projectPath),
      createIterationEntry(1, [buildFixEntry({ id: 10, title: "Global fix" })]),
      createSessionEndEntry("completed"),
    ]);

    const outputs = await captureJsonOutput(async () => {
      await runLog(["--json", "--global"]);
    });

    expect(outputs).toHaveLength(1);
    const payload = outputs[0] as { sessions: unknown[] };
    expect(Array.isArray(payload.sessions)).toBe(true);
    expect(payload.sessions.length).toBeGreaterThan(0);
  });
});
