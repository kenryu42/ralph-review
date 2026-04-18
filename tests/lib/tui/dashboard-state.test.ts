import { describe, expect, test } from "bun:test";
import type { SessionState } from "@/lib/session-state";
import {
  getCurrentAgentFromSessionState,
  getLiveRefreshMeta,
  hasLiveMetaChanged,
  mergeHeavyRefreshState,
  mergeIncrementalLogEntries,
  selectLatestReviewFromEntries,
} from "@/lib/tui/workspace/workspace-refresh-utils";
import type { Finding, LogEntry } from "@/lib/types";

describe("getCurrentAgentFromSessionState", () => {
  const baseSessionState: SessionState = {
    schemaVersion: 2,
    sessionId: "session-1",
    sessionName: "rr-test-123",
    startTime: Date.now(),
    lastHeartbeat: Date.now(),
    pid: process.pid,
    projectPath: "/test/project",
    branch: "main",
    state: "running",
    mode: "background",
  };

  test("returns null when session state is null", () => {
    expect(getCurrentAgentFromSessionState(null)).toBeNull();
  });

  test("returns null when currentAgent is missing", () => {
    expect(getCurrentAgentFromSessionState(baseSessionState)).toBeNull();
  });

  test("returns reviewer when currentAgent is reviewer", () => {
    const data: SessionState = { ...baseSessionState, currentAgent: "reviewer" };
    expect(getCurrentAgentFromSessionState(data)).toBe("reviewer");
  });

  test("returns fixer when currentAgent is fixer", () => {
    const data: SessionState = { ...baseSessionState, currentAgent: "fixer" };
    expect(getCurrentAgentFromSessionState(data)).toBe("fixer");
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

  test("prefers the terminal session review when it is newer than iteration reviews", () => {
    const entries: LogEntry[] = [
      {
        type: "iteration",
        timestamp: 100,
        iteration: 1,
        review: {
          findings: [
            {
              title: "Earlier finding",
              body: "Found during the iteration review.",
              confidence_score: 0.8,
              priority: 2,
              code_location: {
                absolute_file_path: "/tmp/iteration.ts",
                line_range: { start: 12, end: 14 },
              },
            },
          ],
          overall_correctness: "patch is incorrect",
          overall_explanation: "An earlier issue remains.",
          overall_confidence_score: 0.8,
        },
      },
      {
        type: "session_end",
        timestamp: 200,
        status: "completed",
        reason: "Max iterations (1) reached - some issues may remain",
        iterations: 1,
        terminalReview: {
          findings: [
            {
              title: "Terminal finding",
              body: "Still present after the final reviewer classification.",
              confidence_score: 0.9,
              priority: 1,
              code_location: {
                absolute_file_path: "/tmp/terminal.ts",
                line_range: { start: 21, end: 23 },
              },
            },
          ],
          overall_correctness: "patch is incorrect",
          overall_explanation: "A finding remained after the terminal review.",
          overall_confidence_score: 0.9,
        },
      },
    ];

    const latestReview = selectLatestReviewFromEntries(entries);
    expect(latestReview.latestReviewIteration).toBeNull();
    expect(latestReview.iterationFindings).toHaveLength(1);
    expect(latestReview.iterationFindings[0]?.title).toBe("Terminal finding");
    expect(latestReview.codexReviewText).toBeNull();
  });
});

describe("mergeHeavyRefreshState", () => {
  const baseState = {
    sessions: [],
    projectSessions: [],
    currentSession: {
      schemaVersion: 2,
      sessionId: "rr-live-session",
      sessionName: "rr-live",
      startTime: 1000,
      lastHeartbeat: 1000,
      pid: 123,
      projectPath: "/test/project",
      branch: "main",
      state: "running",
      mode: "foreground",
      iteration: 2,
      currentAgent: "fixer",
    },
    logEntries: [],
    fixes: [],
    skipped: [],
    findings: [] as Finding[],
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
    liveRefreshError: null,
  };

  test("keeps live fields while applying heavy refresh fields", () => {
    const merged = mergeHeavyRefreshState(baseState, {
      sessions: [],
      projectSessions: [],
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

describe("mergeIncrementalLogEntries", () => {
  const systemEntry: LogEntry = {
    type: "system",
    timestamp: 100,
    projectPath: "/test/project",
    reviewer: { agent: "codex" },
    fixer: { agent: "claude" },
    maxIterations: 5,
  };
  const iterationEntry: LogEntry = {
    type: "iteration",
    timestamp: 200,
    iteration: 1,
  };

  test("replaces entries on reset mode", () => {
    const merged = mergeIncrementalLogEntries([iterationEntry], {
      mode: "reset",
      entries: [systemEntry],
      state: {
        logPath: "/tmp/session.jsonl",
        offsetBytes: 10,
        lastModified: 1,
        trailingPartialLine: "",
      },
    });

    expect(merged).toEqual([systemEntry]);
  });

  test("appends entries on incremental mode", () => {
    const merged = mergeIncrementalLogEntries([systemEntry], {
      mode: "incremental",
      entries: [iterationEntry],
      state: {
        logPath: "/tmp/session.jsonl",
        offsetBytes: 20,
        lastModified: 2,
        trailingPartialLine: "",
      },
    });

    expect(merged).toEqual([systemEntry, iterationEntry]);
  });

  test("keeps previous entries on unchanged mode", () => {
    const merged = mergeIncrementalLogEntries([systemEntry], {
      mode: "unchanged",
      entries: [],
      state: {
        logPath: "/tmp/session.jsonl",
        offsetBytes: 20,
        lastModified: 2,
        trailingPartialLine: "",
      },
    });

    expect(merged).toEqual([systemEntry]);
  });
});

describe("live metadata helpers", () => {
  const baseSessionState: SessionState = {
    schemaVersion: 2,
    sessionId: "session-1",
    sessionName: "rr-test-123",
    startTime: Date.now(),
    lastHeartbeat: Date.now(),
    pid: process.pid,
    projectPath: "/test/project",
    branch: "main",
    state: "running",
    mode: "background",
    iteration: 2,
    currentAgent: "fixer",
  };

  test("builds metadata shape from session state", () => {
    const meta = getLiveRefreshMeta(baseSessionState);
    expect(meta.sessionName).toBe("rr-test-123");
    expect(meta.state).toBe("running");
    expect(meta.iteration).toBe(2);
    expect(meta.currentAgent).toBe("fixer");
  });

  test("detects changed metadata fields", () => {
    const previous = getLiveRefreshMeta(baseSessionState);
    const next = getLiveRefreshMeta({
      ...baseSessionState,
      iteration: 3,
    });
    expect(hasLiveMetaChanged(previous, next)).toBe(true);
  });

  test("returns false for first metadata sample", () => {
    const next = getLiveRefreshMeta(baseSessionState);
    expect(hasLiveMetaChanged(null, next)).toBe(false);
  });
});
