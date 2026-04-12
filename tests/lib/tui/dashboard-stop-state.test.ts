import { describe, expect, test } from "bun:test";
import type { SessionState } from "@/lib/session-state";
import {
  createStoppingSessionState,
  type StoppingSessionState,
  settleStoppingSessionState,
  shouldClearStoppingSessionState,
  shouldSuppressLastSessionStats,
} from "@/lib/tui/dashboard/dashboard-stop-state";
import type { SessionStats } from "@/lib/types";

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

function createLastSessionStats(overrides: Partial<SessionStats> = {}): SessionStats {
  return {
    sessionPath: "/tmp/logs/session-1.jsonl",
    sessionName: "session-1.jsonl",
    sessionId: "session-1",
    timestamp: 1,
    status: "failed",
    totalFixes: 0,
    totalSkipped: 0,
    priorityCounts: { P0: 0, P1: 0, P2: 0, P3: 0 },
    iterations: 0,
    entries: [],
    reviewer: "codex",
    reviewerModel: "gpt-5.3-codex",
    reviewerDisplayName: "Codex",
    reviewerModelDisplayName: "GPT-5.3 Codex",
    fixer: "claude",
    fixerModel: "claude-opus-4-6",
    fixerDisplayName: "Claude",
    fixerModelDisplayName: "Claude Opus 4.6",
    ...overrides,
  };
}

describe("dashboard stop state", () => {
  test("suppresses the matching last session stats by session id", () => {
    const marker = createStoppingSessionState(
      createSession({
        sessionId: "session-1",
        sessionPath: "/tmp/logs/session-1.jsonl",
      }),
      1_000
    );

    expect(shouldSuppressLastSessionStats(marker, createLastSessionStats())).toBe(true);
  });

  test("suppresses the matching last session stats by session path when session id is missing", () => {
    const marker: StoppingSessionState = {
      sessionId: "session-1",
      sessionPath: "/tmp/logs/session-1.jsonl",
      phase: "settling",
      expiresAt: 2_000,
    };

    expect(
      shouldSuppressLastSessionStats(
        marker,
        createLastSessionStats({
          sessionId: undefined,
        })
      )
    ).toBe(true);
  });

  test("suppresses unrelated historical session stats while stop UI is active", () => {
    const marker = createStoppingSessionState(createSession(), 1_000);

    expect(
      shouldSuppressLastSessionStats(
        marker,
        createLastSessionStats({
          sessionId: "session-older",
          sessionPath: "/tmp/logs/session-older.jsonl",
        })
      )
    ).toBe(true);
  });

  test("keeps the stopping state while the same session is still the latest historical stats", () => {
    const marker = settleStoppingSessionState(
      createStoppingSessionState(createSession(), 1_000),
      1_500
    );

    expect(
      shouldClearStoppingSessionState({
        marker,
        currentSession: null,
        lastSessionStats: createLastSessionStats(),
        now: 1_100,
      })
    ).toBe(false);
  });

  test("keeps the stopping state while stop is still in flight even if history is empty", () => {
    const marker = createStoppingSessionState(createSession(), 1_000);

    expect(
      shouldClearStoppingSessionState({
        marker,
        currentSession: null,
        lastSessionStats: null,
        now: 1_100,
      })
    ).toBe(false);
  });

  test("keeps the settling state while history points at an older failed session", () => {
    const marker = settleStoppingSessionState(
      createStoppingSessionState(createSession(), 1_000),
      1_500
    );

    expect(
      shouldClearStoppingSessionState({
        marker,
        currentSession: null,
        lastSessionStats: createLastSessionStats({
          sessionId: "session-older",
          sessionPath: "/tmp/logs/session-older.jsonl",
        }),
        now: 1_600,
      })
    ).toBe(false);
  });

  test("clears the stopping state when another session becomes current", () => {
    const marker = settleStoppingSessionState(
      createStoppingSessionState(createSession(), 1_000),
      1_500
    );

    expect(
      shouldClearStoppingSessionState({
        marker,
        currentSession: createSession({
          sessionId: "session-2",
          sessionName: "rr-project-feature",
        }),
        lastSessionStats: createLastSessionStats(),
        now: 1_100,
      })
    ).toBe(true);
  });

  test("starts the settle timeout when stop completes", () => {
    const marker = settleStoppingSessionState(
      createStoppingSessionState(createSession(), 1_000),
      1_500
    );

    expect(
      shouldClearStoppingSessionState({
        marker,
        currentSession: null,
        lastSessionStats: null,
        now: 3_499,
      })
    ).toBe(false);
  });

  test("clears the stopping state when the safety timeout expires", () => {
    const marker = settleStoppingSessionState(
      createStoppingSessionState(createSession(), 1_000),
      1_500
    );

    expect(
      shouldClearStoppingSessionState({
        marker,
        currentSession: null,
        lastSessionStats: createLastSessionStats(),
        now: marker.expiresAt,
      })
    ).toBe(true);
  });
});
