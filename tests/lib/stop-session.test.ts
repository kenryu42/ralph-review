import { describe, expect, test } from "bun:test";
import type { ActiveSession, SessionState } from "@/lib/session-state";
import {
  STOP_SESSION_GRACE_PERIOD_MS,
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
});
