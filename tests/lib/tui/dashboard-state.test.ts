import { describe, expect, test } from "bun:test";
import type { LockData } from "@/lib/lockfile";
import type { DashboardState } from "@/lib/tui/types";
import {
  getCurrentAgentFromLockData,
  mergeHeavyDashboardState,
  selectLatestReviewFromEntries,
} from "@/lib/tui/use-dashboard-state";
import type { LogEntry } from "@/lib/types";

describe("getCurrentAgentFromLockData", () => {
  const baseLockData: LockData = {
    sessionName: "rr-test-123",
    startTime: Date.now(),
    pid: process.pid,
    projectPath: "/test/project",
    branch: "main",
  };

  test("returns null when lockData is null", () => {
    expect(getCurrentAgentFromLockData(null)).toBeNull();
  });

  test("returns null when currentAgent is missing", () => {
    expect(getCurrentAgentFromLockData(baseLockData)).toBeNull();
  });

  test("returns reviewer when currentAgent is reviewer", () => {
    const data: LockData = { ...baseLockData, currentAgent: "reviewer" };
    expect(getCurrentAgentFromLockData(data)).toBe("reviewer");
  });

  test("returns fixer when currentAgent is fixer", () => {
    const data: LockData = { ...baseLockData, currentAgent: "fixer" };
    expect(getCurrentAgentFromLockData(data)).toBe("fixer");
  });
});

describe("selectLatestReviewFromEntries", () => {
  test("returns latest review iteration and findings from review summaries", () => {
    const entries: LogEntry[] = [
      {
        type: "iteration",
        timestamp: 100,
        iteration: 1,
        review: {
          findings: [],
          overall_correctness: "patch is correct",
          overall_explanation: "all good",
          overall_confidence_score: 0.8,
        },
      },
      {
        type: "iteration",
        timestamp: 200,
        iteration: 2,
        review: {
          findings: [
            {
              title: "Fix null guard",
              body: "Missing null guard in status panel.",
              confidence_score: 0.9,
              priority: 1,
              code_location: {
                absolute_file_path: "/tmp/session.tsx",
                line_range: { start: 42, end: 44 },
              },
            },
          ],
          overall_correctness: "patch is incorrect",
          overall_explanation: "Null guard issue present.",
          overall_confidence_score: 0.9,
        },
      },
    ];

    const latestReview = selectLatestReviewFromEntries(entries);
    expect(latestReview.latestReviewIteration).toBe(2);
    expect(latestReview.iterationFindings).toHaveLength(1);
    expect(latestReview.iterationFindings[0]?.title).toBe("Fix null guard");
    expect(latestReview.codexReviewText).toBeNull();
  });

  test("tracks latest iteration when codex review text is present", () => {
    const entries: LogEntry[] = [
      {
        type: "iteration",
        timestamp: 100,
        iteration: 1,
        codexReview: { text: "First codex review output" },
      },
      {
        type: "iteration",
        timestamp: 150,
        iteration: 2,
        codexReview: { text: "Second codex review output" },
      },
    ];

    const latestReview = selectLatestReviewFromEntries(entries);
    expect(latestReview.latestReviewIteration).toBe(2);
    expect(latestReview.iterationFindings).toEqual([]);
    expect(latestReview.codexReviewText).toBe("Second codex review output");
  });
});

describe("mergeHeavyDashboardState", () => {
  const baseState: DashboardState = {
    sessions: [],
    currentSession: {
      sessionName: "rr-live",
      startTime: 1000,
      pid: 123,
      projectPath: "/test/project",
      branch: "main",
      iteration: 2,
      status: "running",
      currentAgent: "fixer",
    },
    logEntries: [],
    fixes: [],
    skipped: [],
    findings: [],
    iterationFixes: [],
    iterationSkipped: [],
    iterationFindings: [],
    latestReviewIteration: 1,
    codexReviewText: null,
    tmuxOutput: "new live tmux output",
    elapsed: 5000,
    maxIterations: 5,
    error: null,
    isLoading: true,
    lastSessionStats: null,
    projectStats: null,
    config: null,
    isGitRepo: true,
    currentAgent: "fixer",
    reviewOptions: undefined,
  };

  test("keeps live fields while applying heavy refresh fields", () => {
    const merged = mergeHeavyDashboardState(baseState, {
      sessions: [],
      logEntries: [],
      fixes: [],
      skipped: [],
      findings: [
        {
          title: "Fix null guard",
          body: "Missing null guard in status panel.",
          confidence_score: 0.9,
          priority: 1,
          code_location: {
            absolute_file_path: "/tmp/session.tsx",
            line_range: { start: 42, end: 44 },
          },
        },
      ],
      iterationFixes: [],
      iterationSkipped: [],
      iterationFindings: [],
      latestReviewIteration: 2,
      codexReviewText: null,
      maxIterations: 7,
      lastSessionStats: null,
      projectStats: null,
      config: null,
      isGitRepo: true,
      reviewOptions: undefined,
    });

    expect(merged.currentAgent).toBe("fixer");
    expect(merged.tmuxOutput).toBe("new live tmux output");
    expect(merged.currentSession?.currentAgent).toBe("fixer");
    expect(merged.elapsed).toBe(5000);
    expect(merged.latestReviewIteration).toBe(2);
    expect(merged.maxIterations).toBe(7);
    expect(merged.findings).toHaveLength(1);
    expect(merged.isLoading).toBe(false);
  });
});
