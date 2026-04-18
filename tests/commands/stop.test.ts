import { afterEach, describe, expect, mock, test } from "bun:test";
import type { PendingHandoffArtifact } from "@/lib/handoff";
import type { ActiveSession, SessionState } from "@/lib/session-state";
import type { SessionStats } from "@/lib/types";

const EXIT_PREFIX = "__FORCED_EXIT__:";

interface StopHarnessOptions {
  activeSessions?: ActiveSession[];
  tmuxSessions?: string[];
  fastTimeout?: boolean;
  hasStopCommandDef?: boolean;
  isTTY?: boolean;
  selectValues?: unknown[];
  readSessionState?: (projectPath: string, sessionId: string) => Promise<SessionState | null>;
  sessionExists?: (sessionName: string) => Promise<boolean>;
  computeSessionStats?: (sessionPath: string) => Promise<SessionStats>;
  readPendingHandoff?: (
    projectPath: string,
    sessionId: string
  ) => Promise<PendingHandoffArtifact | null>;
}

interface StopHarnessResult {
  listProjectActiveSessionsCalls: string[];
  computeSessionStatsCalls: string[];
  readPendingHandoffCalls: Array<{ projectPath: string; sessionId: string }>;
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

function createSessionStats(overrides: Partial<SessionStats> = {}): SessionStats {
  return {
    sessionPath: "/tmp/session.jsonl",
    sessionName: "session.jsonl",
    sessionId: "session-id",
    timestamp: 1,
    status: "completed",
    totalFixes: 0,
    totalSkipped: 0,
    priorityCounts: {
      P0: 0,
      P1: 0,
      P2: 0,
      P3: 0,
    },
    iterations: 1,
    entries: [],
    reviewer: "claude",
    reviewerModel: "mock-reviewer",
    reviewerDisplayName: "Claude",
    reviewerModelDisplayName: "Mock Reviewer",
    fixer: "claude",
    fixerModel: "mock-fixer",
    fixerDisplayName: "Claude",
    fixerModelDisplayName: "Mock Fixer",
    ...overrides,
  };
}

function createPendingHandoff(
  overrides: Partial<PendingHandoffArtifact> = {}
): PendingHandoffArtifact {
  const projectPath = process.cwd();
  return {
    sessionId: "session-id",
    projectPath,
    sourceRepoPath: projectPath,
    logPath: `${projectPath}/.ralph-review/logs/session.jsonl`,
    hiddenRef: "refs/ralph-review/sessions/session-id/final",
    patchPath: `${projectPath}/.ralph-review/handoffs/session-id.patch`,
    trackedRepoFingerprint: "fingerprint-1",
    commitSha: "commit-sha-1",
    state: "pending-apply",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

async function runStopWithHarness(
  args: string[],
  options: StopHarnessOptions = {}
): Promise<StopHarnessResult> {
  const actualSessionState = await import("@/lib/session-state");
  const actualLogger = await import("@/lib/logger");
  const actualHandoff = await import("@/lib/handoff");
  const actualTmux = await import("@/lib/tmux");
  const listProjectActiveSessionsCalls: string[] = [];
  const computeSessionStatsCalls: string[] = [];
  const readPendingHandoffCalls: Array<{ projectPath: string; sessionId: string }> = [];
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
  const readSessionState =
    options.readSessionState ??
    (async (projectPath: string, sessionId: string) => {
      return (
        activeSessions.find(
          (session) => session.projectPath === projectPath && session.sessionId === sessionId
        ) ?? null
      );
    });
  const sessionExists = options.sessionExists ?? (async (_sessionName: string) => true);
  const computeSessionStats =
    options.computeSessionStats ??
    (async (sessionPath: string) => {
      return createSessionStats({
        sessionPath,
        sessionName: sessionPath.split("/").at(-1) ?? "session.jsonl",
      });
    });
  const readPendingHandoff = options.readPendingHandoff ?? (async () => null);

  mock.module("@/lib/session-state", () => ({
    ...actualSessionState,
    createSessionId: () => "mock-session-id",
    listAllActiveSessions: async () => activeSessions,
    listProjectActiveSessions: async (_logsDir: string | undefined, projectPath: string) => {
      listProjectActiveSessionsCalls.push(projectPath);
      return activeSessions.filter((session) => session.projectPath === projectPath);
    },
    readSessionState: async (
      _logsDir: string | undefined,
      projectPath: string,
      sessionId: string
    ) => {
      return await readSessionState(projectPath, sessionId);
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

  mock.module("@/lib/logger", () => ({
    ...actualLogger,
    computeSessionStats: async (session: { path: string }) => {
      computeSessionStatsCalls.push(session.path);
      return await computeSessionStats(session.path);
    },
  }));

  mock.module("@/lib/handoff", () => ({
    ...actualHandoff,
    readPendingHandoff: async (
      _storageRoot: string | undefined,
      projectPath: string,
      sessionId: string
    ) => {
      readPendingHandoffCalls.push({ projectPath, sessionId });
      return await readPendingHandoff(projectPath, sessionId);
    },
  }));

  mock.module("@/lib/tmux", () => ({
    ...actualTmux,
    sessionExists: async (sessionName: string) => await sessionExists(sessionName),
    listRalphSessions: async () => tmuxSessions,
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
    computeSessionStatsCalls,
    readPendingHandoffCalls,
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

    expect([...result.sendInterruptCalls].sort()).toEqual(["rr-alpha", "rr-bravo", "rr-charlie"]);
    expect([...result.killSessionCalls].sort()).toEqual(["rr-alpha", "rr-bravo", "rr-charlie"]);
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

  test("stop --all lets interrupted sessions reach terminal state before skipping kill", async () => {
    const session = createActiveSession({
      sessionId: "session-a",
      sessionName: "rr-alpha",
      projectPath: "/repo/alpha",
    });
    const result = await runStopWithHarness(["--all"], {
      fastTimeout: true,
      activeSessions: [session],
      tmuxSessions: ["rr-alpha"],
      readSessionState: async () => ({ ...session, state: "interrupted" }),
      sessionExists: async () => true,
    });

    expect(result.steps).toEqual(["Stopping 1 session(s)..."]);
    expect(result.updateSessionStateCalls).toHaveLength(1);
    expect(result.sendInterruptCalls).toEqual(["rr-alpha"]);
    expect(result.killSessionCalls).toEqual([]);
    expect(result.removeSessionStateCalls).toEqual([
      { projectPath: "/repo/alpha", expectedSessionId: "session-a" },
    ]);
    expect(result.messages).toEqual(["  Stopped: rr-alpha"]);
    expect(result.successes).toEqual(["Stopped 1 session(s)."]);
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

  test("prints an auto-applied handoff note after stopping a session", async () => {
    const cwd = process.cwd();
    const sessionPath = `${cwd}/.ralph-review/logs/session.jsonl`;
    const result = await runStopWithHarness([], {
      fastTimeout: true,
      activeSessions: [
        createActiveSession({
          sessionId: "current-session-id",
          sessionName: "rr-current-session",
          projectPath: cwd,
          sessionPath,
        }),
      ],
      computeSessionStats: async (path) =>
        createSessionStats({
          sessionPath: path,
          sessionId: "current-session-id",
          handoffStatus: "applied-auto",
          commitSha: "commit-sha-1",
        }),
    });

    expect(result.computeSessionStatsCalls).toEqual([sessionPath]);
    expect(result.messages).toContain(
      "Handoff:\nApplied reviewed fixes to the working tree.\nCommit: commit-sha-1"
    );
  });

  test("prints manual handoff commands after stopping a session with pending fixes", async () => {
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
      readPendingHandoff: async () =>
        createPendingHandoff({
          sessionId: "current-session-id",
          projectPath: cwd,
          commitSha: "commit-sha-2",
        }),
    });

    expect(result.readPendingHandoffCalls).toEqual([
      { projectPath: cwd, sessionId: "current-session-id" },
    ]);
    expect(result.messages).toContain(
      "Handoff:\nReviewed fixes are ready to apply.\nCommit: commit-sha-2\nApply: rr apply --session current-session-id\nDiscard: rr discard --session current-session-id"
    );
  });

  test("prints project-qualified handoff commands for pending fixes when stopping all sessions", async () => {
    const otherProject = "/repo/other";
    const result = await runStopWithHarness(["--all"], {
      fastTimeout: true,
      activeSessions: [
        createActiveSession({
          sessionId: "session-a",
          sessionName: "rr-alpha",
          projectPath: otherProject,
        }),
      ],
      readPendingHandoff: async (projectPath, sessionId) =>
        projectPath === otherProject
          ? createPendingHandoff({
              sessionId,
              projectPath,
              sourceRepoPath: projectPath,
              logPath: `${projectPath}/.ralph-review/logs/${sessionId}.jsonl`,
              patchPath: `${projectPath}/.ralph-review/handoffs/${sessionId}.patch`,
              commitSha: "commit-sha-3",
            })
          : null,
    });

    expect(result.messages).toContain(
      "Handoff:\nReviewed fixes are ready to apply.\nCommit: commit-sha-3\nApply: cd /repo/other && rr apply --session session-a\nDiscard: cd /repo/other && rr discard --session session-a"
    );
  });

  test("does not print a handoff note when stopping a session without handoff state", async () => {
    const cwd = process.cwd();
    const sessionPath = `${cwd}/.ralph-review/logs/session-no-handoff.jsonl`;
    const result = await runStopWithHarness([], {
      fastTimeout: true,
      activeSessions: [
        createActiveSession({
          sessionId: "current-session-id",
          sessionName: "rr-current-session",
          projectPath: cwd,
          sessionPath,
        }),
      ],
      computeSessionStats: async (path) =>
        createSessionStats({
          sessionPath: path,
          sessionId: "current-session-id",
          handoffStatus: undefined,
          commitSha: undefined,
        }),
    });

    expect(result.computeSessionStatsCalls).toEqual([sessionPath]);
    expect(result.messages).toEqual([]);
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
