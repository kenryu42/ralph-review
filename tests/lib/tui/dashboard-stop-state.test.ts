import { describe, expect, test } from "bun:test";
import type { SessionState } from "@/lib/session-state";
import {
  createStoppingSessionState,
  type StoppingSessionState,
  shouldClearStoppingSessionState,
  shouldSuppressLastSessionStats,
} from "@/lib/tui/dashboard-stop-state";
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

  test("keeps the stopping state while the same session is still the latest historical stats", () => {
    const marker = createStoppingSessionState(createSession(), 1_000);

    expect(
      shouldClearStoppingSessionState({
        marker,
        currentSession: null,
        lastSessionStats: createLastSessionStats(),
        now: 1_100,
      })
    ).toBe(false);
  });

  test("clears the stopping state once the stopped session disappears from history", () => {
    const marker = createStoppingSessionState(createSession(), 1_000);

    expect(
      shouldClearStoppingSessionState({
        marker,
        currentSession: null,
        lastSessionStats: null,
        now: 1_100,
      })
    ).toBe(true);
  });

  test("clears the stopping state when another session becomes current", () => {
    const marker = createStoppingSessionState(createSession(), 1_000);

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

  test("clears the stopping state when the safety timeout expires", () => {
    const marker = createStoppingSessionState(createSession(), 1_000);

    expect(
      shouldClearStoppingSessionState({
        marker,
        currentSession: createSession(),
        lastSessionStats: createLastSessionStats(),
        now: marker.expiresAt,
      })
    ).toBe(true);
  });
});
