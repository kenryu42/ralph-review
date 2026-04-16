import { describe, expect, test } from "bun:test";
import { getPendingFixTarget } from "@/lib/tui/dashboard/dashboard-fix-state";
import type { SessionStats, SystemEntry } from "@/lib/types";

function createSystemEntry(projectPath = "/repo/project"): SystemEntry {
  return {
    type: "system",
    timestamp: Date.now(),
    projectPath,
    reviewer: { agent: "claude" },
    fixer: { agent: "codex" },
    maxIterations: 5,
  };
}

function createSessionStats(overrides: Partial<SessionStats> = {}): SessionStats {
  return {
    sessionPath: "/tmp/logs/session-123.jsonl",
    sessionName: "session-123.jsonl",
    sessionId: "session-123",
    timestamp: Date.now(),
    status: "completed",
    sessionStatus: "completed",
    phase: "discovery",
    reviewOutcome: "findings-pending",
    totalFixes: 0,
    totalSkipped: 0,
    priorityCounts: { P0: 1, P1: 0, P2: 0, P3: 0 },
    iterations: 2,
    entries: [createSystemEntry()],
    reviewer: "claude",
    reviewerModel: "sonnet-4",
    reviewerDisplayName: "Claude",
    reviewerModelDisplayName: "sonnet-4",
    fixer: "codex",
    fixerModel: "gpt-5.3-codex",
    fixerDisplayName: "Codex",
    fixerModelDisplayName: "gpt-5.3-codex",
    ...overrides,
  };
}

function createFinding(id = "F001") {
  return {
    id: id as `F${string}`,
    fingerprint: `fp-${id}`,
    title: `Finding ${id}`,
    body: "Body",
    priority: "P0" as const,
    confidenceScore: 0.91,
    filePath: "src/file.ts",
    startLine: 10,
    endLine: 12,
  };
}

describe("dashboard fix state", () => {
  test("builds a pending fix target from the latest pending session", () => {
    const target = getPendingFixTarget(createSessionStats(), [createFinding()]);

    expect(target).toEqual({
      sessionId: "session-123",
      projectPath: "/repo/project",
      findings: [createFinding()],
    });
  });

  test("builds a pending fix target from a failed session with persisted findings", () => {
    const target = getPendingFixTarget(
      createSessionStats({
        status: "failed",
        sessionStatus: "failed",
        reviewOutcome: "incomplete",
      }),
      [createFinding()]
    );

    expect(target).toEqual({
      sessionId: "session-123",
      projectPath: "/repo/project",
      findings: [createFinding()],
    });
  });

  test("returns null when there is nothing actionable to fix", () => {
    expect(getPendingFixTarget(null, [createFinding()])).toBeNull();
    expect(
      getPendingFixTarget(
        createSessionStats({
          reviewOutcome: "clean",
        }),
        [createFinding()]
      )
    ).toBeNull();
    expect(getPendingFixTarget(createSessionStats(), [])).toBeNull();
    expect(
      getPendingFixTarget(
        createSessionStats({
          entries: [],
        }),
        [createFinding()]
      )
    ).toBeNull();
  });
});
