import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ActiveSession } from "@/lib/session-state";

const EXIT_PREFIX = "__FORCED_EXIT__:";

interface StopHarnessOptions {
  activeSessions?: ActiveSession[];
  tmuxSessions?: string[];
  fastTimeout?: boolean;
  hasStopCommandDef?: boolean;
  isTTY?: boolean;
  selectValues?: unknown[];
}

interface StopHarnessResult {
  listProjectActiveSessionsCalls: string[];
  updateSessionStateCalls: Array<{
    projectPath: string;
    updates: Record<string, unknown>;
    expectedSessionId?: string;
  }>;
  removeSessionStateCalls: Array<{ projectPath: string; expectedSessionId?: string }>;
  removeAllSessionStatesCalls: number;
  sendInterruptCalls: string[];
  killSessionCalls: string[];
  infos: string[];
  errors: string[];
  steps: string[];
  messages: string[];
  successes: string[];
  exitCode: number | undefined;
  selectMessages: string[];
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
    sessionStatePath: "/tmp/project.lock",
    ...overrides,
  };
}

async function runStopWithHarness(
  args: string[],
  options: StopHarnessOptions = {}
): Promise<StopHarnessResult> {
  const listProjectActiveSessionsCalls: string[] = [];
  const updateSessionStateCalls: Array<{
    projectPath: string;
    updates: Record<string, unknown>;
    expectedSessionId?: string;
  }> = [];
  const removeSessionStateCalls: Array<{ projectPath: string; expectedSessionId?: string }> = [];
  let removeAllSessionStatesCalls = 0;
  const sendInterruptCalls: string[] = [];
  const killSessionCalls: string[] = [];
  const infos: string[] = [];
  const errors: string[] = [];
  const steps: string[] = [];
  const messages: string[] = [];
  const successes: string[] = [];

  const activeSessions = options.activeSessions ?? [];
  const tmuxSessions = options.tmuxSessions ?? [];
  const hasStopCommandDef = options.hasStopCommandDef ?? true;
  const selectValues = [...(options.selectValues ?? [])];
  const selectMessages: string[] = [];

  mock.module("@/lib/session-state", () => ({
    SESSION_STATE_SCHEMA_VERSION: 2,
    HEARTBEAT_INTERVAL_MS: 5_000,
    RUNNING_STALE_AFTER_MS: 20_000,
    PENDING_STARTUP_TIMEOUT_MS: 45_000,
    STOPPING_STALE_AFTER_MS: 20_000,
    createSessionId: () => "mock-session-id",
    listAllActiveSessions: async () => activeSessions,
    listProjectActiveSessions: async (_logsDir: string | undefined, projectPath: string) => {
      listProjectActiveSessionsCalls.push(projectPath);
      return activeSessions.filter((session) => session.projectPath === projectPath);
    },
    removeAllSessionStates: async () => {
      removeAllSessionStatesCalls += 1;
    },
    removeSessionState: async (
      _logsDir: string | undefined,
      projectPath: string,
      _sessionId: string,
      sessionStateOptions?: { expectedSessionId?: string }
    ) => {
      removeSessionStateCalls.push({
        projectPath,
        expectedSessionId: sessionStateOptions?.expectedSessionId,
      });
      return true;
    },
    updateSessionState: async (
      _logsDir: string | undefined,
      projectPath: string,
      _sessionId: string,
      updates: Record<string, unknown>,
      sessionStateOptions?: { expectedSessionId?: string }
    ) => {
      updateSessionStateCalls.push({
        projectPath,
        updates,
        expectedSessionId: sessionStateOptions?.expectedSessionId,
      });
      return true;
    },
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

  mock.module("@clack/prompts", () => ({
    log: {
      info: (message: string) => {
        infos.push(message);
      },
      error: (message: string) => {
        errors.push(message);
      },
      step: (message: string) => {
        steps.push(message);
      },
      message: (message: string) => {
        messages.push(message);
      },
      success: (message: string) => {
        successes.push(message);
      },
    },
    select: async (input: { message: string }) => {
      selectMessages.push(input.message);
      return selectValues.shift();
    },
    isCancel: (value: unknown) => value === "__CANCEL__",
  }));

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
  const originalIsTTY = process.stdout.isTTY;
  process.exit = ((code?: number) => {
    throw new Error(`${EXIT_PREFIX}${code ?? 0}`);
  }) as typeof process.exit;
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: options.isTTY ?? true,
  });

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
    process.exit = originalExit;
    globalThis.setTimeout = originalSetTimeout;
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: originalIsTTY,
    });
  }

  return {
    listProjectActiveSessionsCalls,
    updateSessionStateCalls,
    removeSessionStateCalls,
    removeAllSessionStatesCalls,
    sendInterruptCalls,
    killSessionCalls,
    infos,
    errors,
    steps,
    messages,
    successes,
    exitCode,
    selectMessages,
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
    expect(result.listProjectActiveSessionsCalls).toEqual([]);
    expect(result.updateSessionStateCalls).toEqual([]);
    expect(result.removeSessionStateCalls).toEqual([]);
    expect(result.removeAllSessionStatesCalls).toBe(0);
    expect(result.sendInterruptCalls).toEqual([]);
    expect(result.killSessionCalls).toEqual([]);
  });

  test("stop --all reports empty state and clears session states when no sessions exist", async () => {
    const result = await runStopWithHarness(["--all"], {
      activeSessions: [],
      tmuxSessions: [],
    });

    expect(result.infos).toEqual(["No active review sessions."]);
    expect(result.removeAllSessionStatesCalls).toBe(1);
    expect(result.updateSessionStateCalls).toHaveLength(0);
    expect(result.sendInterruptCalls).toEqual([]);
    expect(result.killSessionCalls).toEqual([]);
    expect(result.removeSessionStateCalls).toEqual([]);
    expect(result.exitCode).toBeUndefined();
  });

  test("stop --all updates session states and stops deduplicated sessions", async () => {
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
    expect(result.updateSessionStateCalls).toHaveLength(2);
    expect(result.updateSessionStateCalls[0]?.projectPath).toBe("/repo/alpha");
    expect(result.updateSessionStateCalls[0]?.updates.state).toBe("stopping");
    expect(typeof result.updateSessionStateCalls[0]?.updates.lastHeartbeat).toBe("number");
    expect(result.updateSessionStateCalls[0]?.expectedSessionId).toBe("session-a");
    expect(result.updateSessionStateCalls[1]?.projectPath).toBe("/repo/bravo");
    expect(result.updateSessionStateCalls[1]?.updates.state).toBe("stopping");
    expect(typeof result.updateSessionStateCalls[1]?.updates.lastHeartbeat).toBe("number");
    expect(result.updateSessionStateCalls[1]?.expectedSessionId).toBe("session-b");

    expect(result.sendInterruptCalls).toEqual(["rr-bravo", "rr-charlie", "rr-alpha"]);
    expect(result.killSessionCalls).toEqual(["rr-bravo", "rr-charlie", "rr-alpha"]);
    expect(result.messages).toEqual([
      "  Stopped: rr-bravo",
      "  Stopped: rr-charlie",
      "  Stopped: rr-alpha",
    ]);

    expect(result.removeSessionStateCalls).toEqual([
      { projectPath: "/repo/alpha", expectedSessionId: "session-a" },
      { projectPath: "/repo/bravo", expectedSessionId: "session-b" },
    ]);
    expect(result.removeAllSessionStatesCalls).toBe(1);
    expect(result.successes).toEqual(["Stopped 3 session(s)."]);
    expect(result.exitCode).toBeUndefined();
  });

  test("stop without active session state shows empty state for current project", async () => {
    const result = await runStopWithHarness([], {
      activeSessions: [],
    });

    expect(result.infos).toEqual(["No active review session for current working directory."]);
    expect(result.messages).toEqual([]);
    expect(result.sendInterruptCalls).toEqual([]);
    expect(result.killSessionCalls).toEqual([]);
    expect(result.updateSessionStateCalls).toEqual([]);
    expect(result.exitCode).toBeUndefined();
  });

  test("stop without active session state shows hint when other sessions are running", async () => {
    const result = await runStopWithHarness([], {
      activeSessions: [
        createActiveSession({ sessionName: "rr-other", projectPath: "/repo/other" }),
      ],
    });

    expect(result.infos).toEqual(["No active review session for current working directory."]);
    expect(result.messages).toEqual([
      "\nThere are 1 other session(s) running.",
      'Use "rr stop --all" to stop all running review sessions, or "rr" to see details.',
    ]);
    expect(result.sendInterruptCalls).toEqual([]);
    expect(result.killSessionCalls).toEqual([]);
    expect(result.updateSessionStateCalls).toEqual([]);
    expect(result.exitCode).toBeUndefined();
  });

  test("stop without --all stops the current project session", async () => {
    const cwd = process.cwd();
    const result = await runStopWithHarness([], {
      fastTimeout: true,
      activeSessions: [
        createActiveSession({
          sessionId: "current-session-id",
          sessionName: "rr-current-session",
          projectPath: cwd,
        }),
      ],
    });

    expect(result.listProjectActiveSessionsCalls).toEqual([cwd]);
    expect(result.steps).toEqual(["Stopping session: rr-current-session"]);
    expect(result.updateSessionStateCalls).toHaveLength(1);
    expect(result.updateSessionStateCalls[0]?.projectPath).toBe(cwd);
    expect(result.updateSessionStateCalls[0]?.updates.state).toBe("stopping");
    expect(typeof result.updateSessionStateCalls[0]?.updates.lastHeartbeat).toBe("number");
    expect(result.updateSessionStateCalls[0]?.expectedSessionId).toBe("current-session-id");

    expect(result.sendInterruptCalls).toEqual(["rr-current-session"]);
    expect(result.killSessionCalls).toEqual(["rr-current-session"]);
    expect(result.removeSessionStateCalls).toEqual([
      { projectPath: cwd, expectedSessionId: "current-session-id" },
    ]);
    expect(result.successes).toEqual(["Review stopped."]);
    expect(result.exitCode).toBeUndefined();
  });

  test("stop with multiple current-project sessions prompts for a target and stops the selection", async () => {
    const cwd = process.cwd();
    const result = await runStopWithHarness([], {
      fastTimeout: true,
      activeSessions: [
        createActiveSession({
          sessionId: "session-older",
          sessionName: "rr-older",
          projectPath: cwd,
          startTime: 100,
        }),
        createActiveSession({
          sessionId: "session-newer",
          sessionName: "rr-newer",
          projectPath: cwd,
          startTime: 200,
        }),
      ],
      selectValues: ["session-newer"],
    });

    expect(result.selectMessages).toEqual(["Choose a review session to stop"]);
    expect(result.steps).toEqual(["Stopping session: rr-newer"]);
    expect(result.sendInterruptCalls).toEqual(["rr-newer"]);
    expect(result.killSessionCalls).toEqual(["rr-newer"]);
    expect(result.removeSessionStateCalls).toEqual([
      { projectPath: cwd, expectedSessionId: "session-newer" },
    ]);
    expect(result.successes).toEqual(["Review stopped."]);
  });

  test("stop with multiple current-project sessions in non-tty mode requires --session", async () => {
    const cwd = process.cwd();
    const result = await runStopWithHarness([], {
      isTTY: false,
      activeSessions: [
        createActiveSession({
          sessionId: "session-a",
          sessionName: "rr-a",
          projectPath: cwd,
          startTime: 100,
        }),
        createActiveSession({
          sessionId: "session-b",
          sessionName: "rr-b",
          projectPath: cwd,
          startTime: 200,
        }),
      ],
    });

    expect(result.errors).toEqual([
      "Multiple review sessions are running for this project. Re-run with --session <id|name>.",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.sendInterruptCalls).toEqual([]);
    expect(result.killSessionCalls).toEqual([]);
    expect(result.selectMessages).toEqual([]);
  });

  test("stop --session accepts a unique session id prefix within the current project", async () => {
    const cwd = process.cwd();
    const result = await runStopWithHarness(["--session", "session-be"], {
      fastTimeout: true,
      activeSessions: [
        createActiveSession({
          sessionId: "session-alpha",
          sessionName: "rr-alpha",
          projectPath: cwd,
          startTime: 100,
        }),
        createActiveSession({
          sessionId: "session-beta",
          sessionName: "rr-beta",
          projectPath: cwd,
          startTime: 200,
        }),
      ],
    });

    expect(result.steps).toEqual(["Stopping session: rr-beta"]);
    expect(result.sendInterruptCalls).toEqual(["rr-beta"]);
    expect(result.killSessionCalls).toEqual(["rr-beta"]);
    expect(result.removeSessionStateCalls).toEqual([
      { projectPath: cwd, expectedSessionId: "session-beta" },
    ]);
  });

  test("stop --session rejects ambiguous prefixes within the current project", async () => {
    const cwd = process.cwd();
    const result = await runStopWithHarness(["--session", "session-"], {
      activeSessions: [
        createActiveSession({
          sessionId: "session-alpha",
          sessionName: "rr-alpha",
          projectPath: cwd,
          startTime: 100,
        }),
        createActiveSession({
          sessionId: "session-beta",
          sessionName: "rr-beta",
          projectPath: cwd,
          startTime: 200,
        }),
      ],
    });

    expect(result.errors).toEqual([
      'Session selector "session-" is ambiguous for the current project.',
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.sendInterruptCalls).toEqual([]);
    expect(result.killSessionCalls).toEqual([]);
  });
});
