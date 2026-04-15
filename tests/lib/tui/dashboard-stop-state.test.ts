import { describe, expect, test } from "bun:test";
import type { SessionState } from "@/lib/session-state";
import {
  createStoppingSessionState,
  type StoppingSessionState,
  settleStoppingSessionState,
  shouldClearStoppingSessionState,
  shouldSuppressLastSessionStats,
} from "@/lib/tui/dashboard/dashboard-stop-state";

function createSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    schemaVersion: 2,
    sessionId: "session-1",
    sessionName: "rr-project-main",
    startTime: 1,
    lastHeartbeat: 1,
    pid: 123,
    projectPath: "/repo/project",
    branch: "main",
    state: "running",
    mode: "background",
    ...overrides,
  };
}

describe("dashboard stop state", () => {
  test("suppresses last session stats while stop marker is active", () => {
    const marker = createStoppingSessionState(
      createSession({
        sessionId: "session-1",
        sessionPath: "/tmp/logs/session-1.jsonl",
      })
    );

    expect(shouldSuppressLastSessionStats(marker)).toBe(true);
  });

  test("suppresses last session stats for settling markers", () => {
    const marker: StoppingSessionState = {
      sessionId: "session-1",
      sessionPath: "/tmp/logs/session-1.jsonl",
      phase: "settling",
      expiresAt: 2_000,
    };

    expect(shouldSuppressLastSessionStats(marker)).toBe(true);
  });

  test("suppresses unrelated historical session stats while stop UI is active", () => {
    const marker = createStoppingSessionState(createSession());

    expect(shouldSuppressLastSessionStats(marker)).toBe(true);
  });

  test("keeps the stopping state while the same session is still the latest historical stats", () => {
    const marker = settleStoppingSessionState(createStoppingSessionState(createSession()), 1_500);

    expect(
      shouldClearStoppingSessionState({
        marker,
        currentSession: null,
        now: 1_100,
      })
    ).toBe(false);
  });

  test("keeps the stopping state while stop is still in flight even if history is empty", () => {
    const marker = createStoppingSessionState(createSession());

    expect(
      shouldClearStoppingSessionState({
        marker,
        currentSession: null,
        now: 1_100,
      })
    ).toBe(false);
  });

  test("keeps the settling state while history points at an older failed session", () => {
    const marker = settleStoppingSessionState(createStoppingSessionState(createSession()), 1_500);

    expect(
      shouldClearStoppingSessionState({
        marker,
        currentSession: null,
        now: 1_600,
      })
    ).toBe(false);
  });

  test("clears the stopping state when another session becomes current", () => {
    const marker = settleStoppingSessionState(createStoppingSessionState(createSession()), 1_500);

    expect(
      shouldClearStoppingSessionState({
        marker,
        currentSession: createSession({
          sessionId: "session-2",
          sessionName: "rr-project-feature",
        }),
        now: 1_100,
      })
    ).toBe(true);
  });

  test("starts the settle timeout when stop completes", () => {
    const marker = settleStoppingSessionState(createStoppingSessionState(createSession()), 1_500);

    expect(
      shouldClearStoppingSessionState({
        marker,
        currentSession: null,
        now: 3_499,
      })
    ).toBe(false);
  });

  test("clears the stopping state when the safety timeout expires", () => {
    const marker = settleStoppingSessionState(createStoppingSessionState(createSession()), 1_500);

    expect(
      shouldClearStoppingSessionState({
        marker,
        currentSession: null,
        now: marker.expiresAt,
      })
    ).toBe(true);
  });
});
