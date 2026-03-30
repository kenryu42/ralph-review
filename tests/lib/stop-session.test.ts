import { describe, expect, test } from "bun:test";
import type { ActiveSession } from "@/lib/session-state";
import { STOP_SESSION_GRACE_PERIOD_MS, stopActiveSession } from "@/lib/stop-session";

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
  test("marks the session as stopping before interrupting, killing, and removing it", async () => {
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

    expect(steps).toEqual([
      "update",
      "interrupt:rr-project-main",
      `sleep:${STOP_SESSION_GRACE_PERIOD_MS}`,
      "kill:rr-project-main",
      "remove",
    ]);
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
});
