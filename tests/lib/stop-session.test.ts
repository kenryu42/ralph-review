import { describe, expect, test } from "bun:test";
import type { ActiveSession, SessionState } from "@/lib/session-state";
import {
  STOP_SESSION_GRACE_PERIOD_MS,
  STOP_SESSION_NO_SUCCESSFUL_ITERATION_GRACE_PERIOD_MS,
  STOP_SESSION_POLL_INTERVAL_MS,
  stopActiveSession,
} from "@/lib/stop-session";

function createActiveSession(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    schemaVersion: 2,
    sessionId: "session-123",
    sessionName: "rr-project-main",
    startTime: 1,
    lastHeartbeat: 1,
    pid: 123,
    projectPath: "/repo/project",
    branch: "main",
    state: "running",
    mode: "background",
    sessionStatePath: "/tmp/session-123.json",
    ...overrides,
  };
}

describe("stopActiveSession", () => {
  test("force kills the tmux session when it does not stop within the grace period", async () => {
    const session = createActiveSession();
    const steps: string[] = [];
    const now = 123_456_789;
    const originalNow = Date.now;
    const updateSessionStateCalls: Array<{
      projectPath: string;
      sessionId: string;
      updates: Record<string, unknown>;
      expectedSessionId?: string;
    }> = [];
    const removeSessionStateCalls: Array<{
      projectPath: string;
      sessionId: string;
      expectedSessionId?: string;
    }> = [];

    Date.now = () => now;

    try {
      await stopActiveSession(session, {
        updateSessionState: async (_storageRoot, projectPath, sessionId, updates, options) => {
          steps.push("update");
          updateSessionStateCalls.push({
            projectPath,
            sessionId,
            updates,
            expectedSessionId: options?.expectedSessionId,
          });
          return true;
        },
        sendInterrupt: async (sessionName) => {
          steps.push(`interrupt:${sessionName}`);
        },
        readSessionState: async (): Promise<SessionState> => session,
        sessionExists: async () => true,
        sleep: async (ms) => {
          steps.push(`sleep:${ms}`);
        },
        killSession: async (sessionName) => {
          steps.push(`kill:${sessionName}`);
        },
        removeSessionState: async (_storageRoot, projectPath, sessionId, options) => {
          steps.push("remove");
          removeSessionStateCalls.push({
            projectPath,
            sessionId,
            expectedSessionId: options?.expectedSessionId,
          });
          return true;
        },
      });
    } finally {
      Date.now = originalNow;
    }

    expect(steps[0]).toBe("update");
    expect(steps[1]).toBe("interrupt:rr-project-main");
    expect(steps.filter((step) => step === `sleep:${STOP_SESSION_POLL_INTERVAL_MS}`)).toHaveLength(
      Math.ceil(STOP_SESSION_GRACE_PERIOD_MS / STOP_SESSION_POLL_INTERVAL_MS)
    );
    expect(steps.at(-2)).toBe("kill:rr-project-main");
    expect(steps.at(-1)).toBe("remove");
    expect(updateSessionStateCalls).toEqual([
      {
        projectPath: "/repo/project",
        sessionId: "session-123",
        updates: {
          state: "stopping",
          lastHeartbeat: now,
        },
        expectedSessionId: "session-123",
      },
    ]);
    expect(removeSessionStateCalls).toEqual([
      {
        projectPath: "/repo/project",
        sessionId: "session-123",
        expectedSessionId: "session-123",
      },
    ]);
  });

  test("waits for terminal session state and skips force killing when cleanup completes", async () => {
    const session = createActiveSession();
    const steps: string[] = [];
    const sessionStates: Array<SessionState | null> = [
      session,
      { ...session, state: "interrupted" },
    ];

    await stopActiveSession(session, {
      updateSessionState: async () => true,
      sendInterrupt: async (sessionName) => {
        steps.push(`interrupt:${sessionName}`);
      },
      readSessionState: async () => sessionStates.shift() ?? null,
      sessionExists: async () => true,
      sleep: async (ms) => {
        steps.push(`sleep:${ms}`);
      },
      killSession: async (sessionName) => {
        steps.push(`kill:${sessionName}`);
      },
      removeSessionState: async () => {
        steps.push("remove");
        return true;
      },
    });

    expect(steps).toEqual([
      `interrupt:${session.sessionName}`,
      `sleep:${STOP_SESSION_POLL_INTERVAL_MS}`,
      "remove",
    ]);
    expect(steps).not.toContain(`kill:${session.sessionName}`);
  });

  test("force kills quickly and discards the worktree when no successful review iteration exists", async () => {
    const session = createActiveSession({
      sessionPath: "/tmp/session-123.jsonl",
      worktreeProjectPath: "/tmp/worktrees/session-123",
      worktreeBranch: "rr-worktree-session-123",
    });
    const steps: string[] = [];

    await stopActiveSession(session, {
      updateSessionState: async () => true,
      sendInterrupt: async (sessionName) => {
        steps.push(`interrupt:${sessionName}`);
      },
      readLog: async () => [],
      readSessionState: async (): Promise<SessionState> => session,
      sessionExists: async () => true,
      sleep: async (ms) => {
        steps.push(`sleep:${ms}`);
      },
      killSession: async (sessionName) => {
        steps.push(`kill:${sessionName}`);
      },
      discardSessionWorktree: (worktree) => {
        steps.push(`discard:${worktree.worktreeProjectPath}`);
      },
      resolveSourceRepoPath: () => "/repo/project",
      removeSessionState: async () => {
        steps.push("remove");
        return true;
      },
    });

    expect(steps[0]).toBe(`interrupt:${session.sessionName}`);
    expect(steps.filter((step) => step === `sleep:${STOP_SESSION_POLL_INTERVAL_MS}`)).toHaveLength(
      Math.ceil(
        STOP_SESSION_NO_SUCCESSFUL_ITERATION_GRACE_PERIOD_MS / STOP_SESSION_POLL_INTERVAL_MS
      )
    );
    expect(steps).toContain(`kill:${session.sessionName}`);
    expect(steps).toContain(`discard:${session.worktreeProjectPath}`);
    expect(steps.at(-1)).toBe("remove");
  });

  test("deletes session log artifacts after stopping when no iteration entry was ever recorded", async () => {
    const sessionPath = "/tmp/session-123.jsonl";
    const session = createActiveSession({
      sessionPath,
    });
    const deletedSessionPaths: string[] = [];

    await stopActiveSession(session, {
      updateSessionState: async () => true,
      sendInterrupt: async () => {},
      readLog: async () => [],
      readSessionState: async (): Promise<SessionState> => ({
        ...session,
        state: "interrupted",
      }),
      sessionExists: async () => false,
      killSession: async () => {},
      resolveSourceRepoPath: () => null,
      deleteSessionFiles: async (sessionPath) => {
        deletedSessionPaths.push(sessionPath);
      },
      removeSessionState: async () => true,
    });

    expect(deletedSessionPaths).toEqual([sessionPath]);
  });

  test("keeps session log artifacts when an iteration entry is recorded during shutdown", async () => {
    const session = createActiveSession({
      sessionPath: "/tmp/session-123.jsonl",
    });
    const deletedSessionPaths: string[] = [];
    let readLogCallCount = 0;

    await stopActiveSession(session, {
      updateSessionState: async () => true,
      sendInterrupt: async () => {},
      readLog: async () => {
        readLogCallCount += 1;
        if (readLogCallCount === 1) {
          return [];
        }

        return [
          {
            type: "iteration",
            timestamp: Date.now(),
            iteration: 1,
            error: {
              phase: "reviewer",
              message: "Interrupted by user",
            },
          },
        ];
      },
      readSessionState: async (): Promise<SessionState> => ({
        ...session,
        state: "interrupted",
      }),
      sessionExists: async () => false,
      killSession: async () => {},
      resolveSourceRepoPath: () => null,
      deleteSessionFiles: async (sessionPath) => {
        deletedSessionPaths.push(sessionPath);
      },
      removeSessionState: async () => true,
    });

    expect(deletedSessionPaths).toEqual([]);
  });

  test("keeps the worktree when a successful iteration is recorded during shutdown", async () => {
    const session = createActiveSession({
      sessionPath: "/tmp/session-123.jsonl",
      worktreeProjectPath: "/tmp/worktrees/session-123",
      worktreeBranch: "rr-worktree-session-123",
    });
    const discardedWorktreePaths: string[] = [];
    let readLogCallCount = 0;

    await stopActiveSession(session, {
      updateSessionState: async () => true,
      sendInterrupt: async () => {},
      readLog: async () => {
        readLogCallCount += 1;
        if (readLogCallCount === 1) {
          return [];
        }

        return [
          {
            type: "iteration",
            timestamp: Date.now(),
            iteration: 1,
            fixes: {
              decision: "NO_CHANGES_NEEDED",
              stop_iteration: true,
              fixes: [],
              skipped: [],
            },
          },
        ];
      },
      readSessionState: async (): Promise<SessionState> => ({
        ...session,
        state: "interrupted",
      }),
      sessionExists: async () => false,
      killSession: async () => {},
      discardSessionWorktree: (worktree) => {
        discardedWorktreePaths.push(worktree.worktreeProjectPath);
      },
      resolveSourceRepoPath: () => "/repo/project",
      removeSessionState: async () => true,
    });

    expect(discardedWorktreePaths).toEqual([]);
  });
});
