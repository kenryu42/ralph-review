import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as p from "@clack/prompts";
import { runLog } from "@/commands/log";
import { CONFIG_DIR } from "@/lib/config";
import {
  getProjectLogsDir,
  getProjectName,
  getProjectStorageDir,
  getSummaryPath,
} from "@/lib/logger";
import type { FixEntry, IterationEntry, LogEntry, SessionEndEntry, SystemEntry } from "@/lib/types";
import { captureExitCode, captureJsonOutput, withMutedTerminalLogs } from "../helpers/capture";
import { buildFixEntry, buildFixSummary, buildSkippedEntry } from "../test-utils/fix-summary";

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
  skipped = [] as ReturnType<typeof buildSkippedEntry>[]
): IterationEntry {
  return {
    type: "iteration",
    timestamp: Date.now(),
    iteration,
    duration: 5_000,
    fixes: buildFixSummary({
      decision: "APPLY_MOST",
      fixes,
      skipped,
    }),
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

interface CapturedClackLogs {
  info: string[];
  message: string[];
  success: string[];
  step: string[];
}

async function captureClackLogs<T>(
  run: () => Promise<T>
): Promise<{ result: T; logs: CapturedClackLogs }> {
  const logs: CapturedClackLogs = {
    info: [],
    message: [],
    success: [],
    step: [],
  };
  const originalInfo = p.log.info;
  const originalMessage = p.log.message;
  const originalSuccess = p.log.success;
  const originalStep = p.log.step;

  p.log.info = ((message: string) => {
    logs.info.push(message);
  }) as typeof p.log.info;
  p.log.message = ((message: string) => {
    logs.message.push(message);
  }) as typeof p.log.message;
  p.log.success = ((message: string) => {
    logs.success.push(message);
  }) as typeof p.log.success;
  p.log.step = ((message: string) => {
    logs.step.push(message);
  }) as typeof p.log.step;

  try {
    const result = await run();
    return { result, logs };
  } finally {
    p.log.info = originalInfo;
    p.log.message = originalMessage;
    p.log.success = originalSuccess;
    p.log.step = originalStep;
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

async function createTrackedProjectFixture() {
  const fixture = await createProjectFixture();
  fixtures.push(fixture);
  return fixture;
}

async function cleanupProjectFixture(fixture: ProjectFixture): Promise<void> {
  const projectStorageDir = getProjectStorageDir(CONFIG_DIR, fixture.projectPath);

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
  await rm(projectStorageDir, { recursive: true, force: true });
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

async function captureLogJsonForFixture(fixture: ProjectFixture) {
  return withProjectCwd(fixture.projectPath, async () =>
    captureJsonOutput(async () => {
      await runLog(["--json"]);
    })
  );
}

async function captureTerminalLogForFixture(fixture: ProjectFixture) {
  return withProjectCwd(fixture.projectPath, async () =>
    withMutedTerminalLogs(async () =>
      captureClackLogs(async () => {
        await runLog([]);
      })
    )
  );
}

async function writeUnknownLog(fixture: ProjectFixture) {
  const unknownLog = join(getProjectLogsDir(CONFIG_DIR, fixture.projectPath), "unknown.jsonl");
  fixture.logPaths.push(unknownLog);
  await writeLogEntries(unknownLog, []);
}

function expectNoSessionsGuidance(logs: CapturedClackLogs) {
  expect(logs.info).toContain("No review sessions found for current working directory.");
  expect(logs.message).toContain('Start a review with "rr run" first.');
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

  test.each([
    ["no sessions exist", false],
    ["all discovered sessions are unknown and empty", true],
  ])("prints empty project JSON when %s", async (_name, hasUnknownLog) => {
    const fixture = await createTrackedProjectFixture();
    if (hasUnknownLog) {
      await writeUnknownLog(fixture);
    }

    const outputs = await captureLogJsonForFixture(fixture);

    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toEqual({ project: fixture.projectName, sessions: [] });
  });

  test.each([
    ["no sessions exist", false],
    ["all discovered sessions are unknown and empty", true],
  ])("prints terminal guidance when %s", async (_name, hasUnknownLog) => {
    const fixture = await createTrackedProjectFixture();
    if (hasUnknownLog) {
      await writeUnknownLog(fixture);
    }

    const { logs } = await captureTerminalLogForFixture(fixture);

    expectNoSessionsGuidance(logs);
  });

  test("renders handoff summary when reviewed fixes are pending apply", async () => {
    const fixture = await createProjectFixture();
    fixtures.push(fixture);
    const logsProjectDir = getProjectLogsDir(CONFIG_DIR, fixture.projectPath);
    const handoffLog = join(logsProjectDir, "handoff.jsonl");
    fixture.logPaths.push(handoffLog);

    await writeLogEntries(handoffLog, [
      createSystemEntry(fixture.projectPath),
      createIterationEntry(1),
      {
        ...createSessionEndEntry("completed"),
        handoffStatus: "pending-apply",
        handoffUpdatedAt: 1_700_000_000_000,
        commitSha: "commit-sha-1",
      },
    ]);

    const { logs } = await captureTerminalLogForFixture(fixture);

    expect(logs.message).toContain("Handoff: pending-apply · commit-sha-1");
  });

  test("does not report findings-pending sessions as clean", async () => {
    const fixture = await createProjectFixture();
    fixtures.push(fixture);
    const logsProjectDir = getProjectLogsDir(CONFIG_DIR, fixture.projectPath);
    const pendingLog = join(logsProjectDir, "pending-findings.jsonl");
    fixture.logPaths.push(pendingLog);

    await writeLogEntries(pendingLog, [
      createSystemEntry(fixture.projectPath),
      {
        ...createSessionEndEntry("completed"),
        phase: "review",
        sessionStatus: "completed",
        reviewOutcome: "findings-pending",
        iterations: 1,
      },
    ]);

    const { logs } = await captureTerminalLogForFixture(fixture);

    expect(logs.message.some((entry) => entry.includes("Pending findings: run rr fix"))).toBe(true);
    expect(logs.success).not.toContain("No issues found - code is clean!");
  });

  test("renders and outputs project JSON after filtering unknown-empty sessions", async () => {
    const fixture = await createProjectFixture();
    fixtures.push(fixture);
    const logsProjectDir = getProjectLogsDir(CONFIG_DIR, fixture.projectPath);

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
    const logPath = join(getProjectLogsDir(CONFIG_DIR, fixture.projectPath), "global.jsonl");
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
