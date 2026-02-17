import { afterEach, describe, expect, mock, test } from "bun:test";
import * as p from "@clack/prompts";
import type { ActiveSession, LockData } from "@/lib/lockfile";

const EXIT_PREFIX = "__FORCED_EXIT__:";

interface StopHarnessOptions {
  activeSessions?: ActiveSession[];
  tmuxSessions?: string[];
  lockData?: LockData | null;
  fastTimeout?: boolean;
  hasStopCommandDef?: boolean;
}

interface StopHarnessResult {
  readLockfileCalls: string[];
  updateLockfileCalls: Array<{
    projectPath: string;
    updates: Record<string, unknown>;
    expectedSessionId?: string;
  }>;
  removeLockfileCalls: Array<{ projectPath: string; expectedSessionId?: string }>;
  removeAllLockfilesCalls: number;
  sendInterruptCalls: string[];
  killSessionCalls: string[];
  infos: string[];
  errors: string[];
  steps: string[];
  messages: string[];
  successes: string[];
  exitCode: number | undefined;
}

function createActiveSession(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    schemaVersion: 2,
    sessionId: "session-id",
    sessionName: "rr-project-main",
    startTime: 1,
    lastHeartbeat: 1,
    pid: 123,
    projectPath: "/repo/project",
    branch: "main",
    state: "running",
    mode: "background",
    lockPath: "/tmp/project.lock",
    ...overrides,
  };
}

function createLockData(overrides: Partial<LockData> = {}): LockData {
  return {
    schemaVersion: 2,
    sessionId: "lock-session-id",
    sessionName: "rr-project-main",
    startTime: 1,
    lastHeartbeat: 1,
    pid: 123,
    projectPath: process.cwd(),
    branch: "main",
    state: "running",
    mode: "background",
    ...overrides,
  };
}

async function runStopWithHarness(
  args: string[],
  options: StopHarnessOptions = {}
): Promise<StopHarnessResult> {
  const readLockfileCalls: string[] = [];
  const updateLockfileCalls: Array<{
    projectPath: string;
    updates: Record<string, unknown>;
    expectedSessionId?: string;
  }> = [];
  const removeLockfileCalls: Array<{ projectPath: string; expectedSessionId?: string }> = [];
  let removeAllLockfilesCalls = 0;
  const sendInterruptCalls: string[] = [];
  const killSessionCalls: string[] = [];
  const infos: string[] = [];
  const errors: string[] = [];
  const steps: string[] = [];
  const messages: string[] = [];
  const successes: string[] = [];

  const activeSessions = options.activeSessions ?? [];
  const tmuxSessions = options.tmuxSessions ?? [];
  const lockData = options.lockData ?? null;
  const hasStopCommandDef = options.hasStopCommandDef ?? true;

  mock.module("@/lib/lockfile", () => ({
    LOCK_SCHEMA_VERSION: 2,
    HEARTBEAT_INTERVAL_MS: 5_000,
    RUNNING_STALE_AFTER_MS: 20_000,
    PENDING_STARTUP_TIMEOUT_MS: 45_000,
    STOPPING_STALE_AFTER_MS: 20_000,
    createSessionId: () => "mock-session-id",
    getLockPath: (_logsDir: string | undefined, projectPath: string) => `${projectPath}.lock`,
    createLockfile: async () => {},
    listAllActiveSessions: async () => activeSessions,
    readLockfile: async (_logsDir: string | undefined, projectPath: string) => {
      readLockfileCalls.push(projectPath);
      return lockData;
    },
    removeAllLockfiles: async () => {
      removeAllLockfilesCalls += 1;
    },
    removeLockfile: async (
      _logsDir: string | undefined,
      projectPath: string,
      lockfileOptions?: { expectedSessionId?: string }
    ) => {
      removeLockfileCalls.push({
        projectPath,
        expectedSessionId: lockfileOptions?.expectedSessionId,
      });
      return true;
    },
    updateLockfile: async (
      _logsDir: string | undefined,
      projectPath: string,
      updates: Record<string, unknown>,
      lockfileOptions?: { expectedSessionId?: string }
    ) => {
      updateLockfileCalls.push({
        projectPath,
        updates,
        expectedSessionId: lockfileOptions?.expectedSessionId,
      });
      return true;
    },
    touchHeartbeat: async () => true,
    lockfileExists: async () => false,
    isProcessAlive: () => false,
    cleanupStaleLockfile: async () => false,
    hasActiveLockfile: async () => false,
  }));

  mock.module("@/lib/tmux", () => ({
    TMUX_CAPTURE_MIN_INTERVAL_MS: 250,
    TMUX_CAPTURE_MAX_INTERVAL_MS: 2_000,
    shouldCaptureTmux: () => false,
    computeNextTmuxCaptureInterval: () => 250,
    sanitizeBasename: (basename: string) => basename,
    isTmuxInstalled: () => true,
    isInsideTmux: () => false,
    generateSessionName: () => "rr-mock-session",
    sessionExists: async () => false,
    createSession: async () => {},
    listRalphSessions: async () => tmuxSessions,
    listSessions: async () => [],
    normalizeSessionOutput: (output: string) => output,
    getSessionOutput: async () => "",
    sendInterrupt: async (sessionName: string) => {
      sendInterruptCalls.push(sessionName);
    },
    killSession: async (sessionName: string) => {
      killSessionCalls.push(sessionName);
    },
  }));

  const originalInfo = p.log.info;
  const originalError = p.log.error;
  const originalStep = p.log.step;
  const originalMessage = p.log.message;
  const originalSuccess = p.log.success;
  p.log.info = ((message: string) => {
    infos.push(message);
  }) as typeof p.log.info;
  p.log.error = ((message: string) => {
    errors.push(message);
  }) as typeof p.log.error;
  p.log.step = ((message: string) => {
    steps.push(message);
  }) as typeof p.log.step;
  p.log.message = ((message: string) => {
    messages.push(message);
  }) as typeof p.log.message;
  p.log.success = ((message: string) => {
    successes.push(message);
  }) as typeof p.log.success;

  const originalSetTimeout = globalThis.setTimeout;
  if (options.fastTimeout) {
    globalThis.setTimeout = ((...timeoutArgs: Parameters<typeof setTimeout>) => {
      const [handler, _timeout, ...rest] = timeoutArgs;
      if (typeof handler === "function") {
        (handler as (...args: unknown[]) => void)(...rest);
      }
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
  }

  const originalExit = process.exit;
  process.exit = ((code?: number) => {
    throw new Error(`${EXIT_PREFIX}${code ?? 0}`);
  }) as typeof process.exit;

  const { runStop } = await import("@/commands/stop");
  let exitCode: number | undefined;

  try {
    if (hasStopCommandDef) {
      await runStop(args);
    } else {
      await runStop(args, {
        getCommandDef: () => undefined,
      });
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(EXIT_PREFIX)) {
      exitCode = Number.parseInt(error.message.slice(EXIT_PREFIX.length), 10);
    } else {
      throw error;
    }
  } finally {
    p.log.info = originalInfo;
    p.log.error = originalError;
    p.log.step = originalStep;
    p.log.message = originalMessage;
    p.log.success = originalSuccess;
    process.exit = originalExit;
    globalThis.setTimeout = originalSetTimeout;
  }

  return {
    readLockfileCalls,
    updateLockfileCalls,
    removeLockfileCalls,
    removeAllLockfilesCalls,
    sendInterruptCalls,
    killSessionCalls,
    infos,
    errors,
    steps,
    messages,
    successes,
    exitCode,
  };
}

describe("runStop", () => {
  afterEach(() => {
    mock.restore();
  });

  test("logs parser failures and exits", async () => {
    const result = await runStopWithHarness(["--unknown"]);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('stop: unknown option "--unknown"');
    expect(result.exitCode).toBe(1);
  });

  test("logs internal error and exits when stop command definition is missing", async () => {
    const result = await runStopWithHarness([], {
      hasStopCommandDef: false,
    });

    expect(result.errors).toEqual(["Internal error: stop command definition not found"]);
    expect(result.exitCode).toBe(1);
    expect(result.readLockfileCalls).toEqual([]);
    expect(result.updateLockfileCalls).toEqual([]);
    expect(result.removeLockfileCalls).toEqual([]);
    expect(result.removeAllLockfilesCalls).toBe(0);
    expect(result.sendInterruptCalls).toEqual([]);
    expect(result.killSessionCalls).toEqual([]);
  });

  test("stop --all reports empty state and clears lockfiles when no sessions exist", async () => {
    const result = await runStopWithHarness(["--all"], {
      activeSessions: [],
      tmuxSessions: [],
    });

    expect(result.infos).toEqual(["No active review sessions."]);
    expect(result.removeAllLockfilesCalls).toBe(1);
    expect(result.updateLockfileCalls).toHaveLength(0);
    expect(result.sendInterruptCalls).toEqual([]);
    expect(result.killSessionCalls).toEqual([]);
    expect(result.removeLockfileCalls).toEqual([]);
    expect(result.exitCode).toBeUndefined();
  });

  test("stop --all updates lockfiles and stops deduplicated sessions", async () => {
    const result = await runStopWithHarness(["--all"], {
      fastTimeout: true,
      activeSessions: [
        createActiveSession({
          sessionId: "session-a",
          sessionName: "rr-alpha",
          projectPath: "/repo/alpha",
        }),
        createActiveSession({
          sessionId: "session-b",
          sessionName: "rr-bravo",
          projectPath: "/repo/bravo",
        }),
      ],
      tmuxSessions: ["rr-bravo", "rr-charlie"],
    });

    expect(result.steps).toEqual(["Stopping 3 session(s)..."]);
    expect(result.updateLockfileCalls).toHaveLength(2);
    expect(result.updateLockfileCalls[0]?.projectPath).toBe("/repo/alpha");
    expect(result.updateLockfileCalls[0]?.updates.state).toBe("stopping");
    expect(typeof result.updateLockfileCalls[0]?.updates.lastHeartbeat).toBe("number");
    expect(result.updateLockfileCalls[0]?.expectedSessionId).toBe("session-a");
    expect(result.updateLockfileCalls[1]?.projectPath).toBe("/repo/bravo");
    expect(result.updateLockfileCalls[1]?.updates.state).toBe("stopping");
    expect(typeof result.updateLockfileCalls[1]?.updates.lastHeartbeat).toBe("number");
    expect(result.updateLockfileCalls[1]?.expectedSessionId).toBe("session-b");

    expect(result.sendInterruptCalls).toEqual(["rr-bravo", "rr-charlie", "rr-alpha"]);
    expect(result.killSessionCalls).toEqual(["rr-bravo", "rr-charlie", "rr-alpha"]);
    expect(result.messages).toEqual([
      "  Stopped: rr-bravo",
      "  Stopped: rr-charlie",
      "  Stopped: rr-alpha",
    ]);

    expect(result.removeLockfileCalls).toEqual([
      { projectPath: "/repo/alpha", expectedSessionId: "session-a" },
      { projectPath: "/repo/bravo", expectedSessionId: "session-b" },
    ]);
    expect(result.removeAllLockfilesCalls).toBe(1);
    expect(result.successes).toEqual(["Stopped 3 session(s)."]);
    expect(result.exitCode).toBeUndefined();
  });

  test("stop without active lockfile shows empty state for current project", async () => {
    const result = await runStopWithHarness([], {
      lockData: null,
      activeSessions: [],
    });

    expect(result.infos).toEqual(["No active review session for current working directory."]);
    expect(result.messages).toEqual([]);
    expect(result.sendInterruptCalls).toEqual([]);
    expect(result.killSessionCalls).toEqual([]);
    expect(result.updateLockfileCalls).toEqual([]);
    expect(result.exitCode).toBeUndefined();
  });

  test("stop without active lockfile shows hint when other sessions are running", async () => {
    const result = await runStopWithHarness([], {
      lockData: null,
      activeSessions: [createActiveSession({ sessionName: "rr-other" })],
    });

    expect(result.infos).toEqual(["No active review session for current working directory."]);
    expect(result.messages).toEqual([
      "\nThere are 1 other session(s) running.",
      'Use "rr stop --all" to stop all running review sessions, or "rr status" to see details.',
    ]);
    expect(result.sendInterruptCalls).toEqual([]);
    expect(result.killSessionCalls).toEqual([]);
    expect(result.updateLockfileCalls).toEqual([]);
    expect(result.exitCode).toBeUndefined();
  });

  test("stop without --all stops the current project session", async () => {
    const cwd = process.cwd();
    const result = await runStopWithHarness([], {
      fastTimeout: true,
      lockData: createLockData({
        sessionId: "current-session-id",
        sessionName: "rr-current-session",
      }),
    });

    expect(result.readLockfileCalls).toEqual([cwd]);
    expect(result.steps).toEqual(["Stopping session: rr-current-session"]);
    expect(result.updateLockfileCalls).toHaveLength(1);
    expect(result.updateLockfileCalls[0]?.projectPath).toBe(cwd);
    expect(result.updateLockfileCalls[0]?.updates.state).toBe("stopping");
    expect(typeof result.updateLockfileCalls[0]?.updates.lastHeartbeat).toBe("number");
    expect(result.updateLockfileCalls[0]?.expectedSessionId).toBe("current-session-id");

    expect(result.sendInterruptCalls).toEqual(["rr-current-session"]);
    expect(result.killSessionCalls).toEqual(["rr-current-session"]);
    expect(result.removeLockfileCalls).toEqual([
      { projectPath: cwd, expectedSessionId: "current-session-id" },
    ]);
    expect(result.successes).toEqual(["Review stopped."]);
    expect(result.exitCode).toBeUndefined();
  });
});
