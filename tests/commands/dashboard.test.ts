import { describe, expect, test } from "bun:test";
import {
  markRunningSessions,
  pruneUnknownEmptySessions,
  removeSession,
} from "@/commands/dashboard";
import type { ActiveSession } from "@/lib/lockfile";
import { getProjectName } from "@/lib/logger";
import type {
  DashboardData,
  FixEntry,
  IterationEntry,
  SessionStats,
  SystemEntry,
} from "@/lib/types";
import { buildFixSummary } from "../test-utils/fix-summary";

/**
 * Create a mock session stats for testing
 */
function createSessionStats(overrides: Partial<SessionStats> = {}): SessionStats {
  const defaults: SessionStats = {
    sessionPath: "/logs/test-project/2024-01-15T14-30-00.jsonl",
    sessionName: "2024-01-15T14-30-00.jsonl",
    timestamp: Date.now(),
    gitBranch: "main",
    status: "completed",
    totalFixes: 5,
    totalSkipped: 2,
    priorityCounts: { P0: 1, P1: 2, P2: 1, P3: 1 },
    iterations: 3,
    totalDuration: 15000,
    entries: [],
    reviewer: "claude",
    reviewerModel: "claude-sonnet-4-20250514",
    reviewerDisplayName: "Claude",
    reviewerModelDisplayName: "claude-sonnet-4-20250514",
    fixer: "claude",
    fixerModel: "claude-sonnet-4-20250514",
    fixerDisplayName: "Claude",
    fixerModelDisplayName: "claude-sonnet-4-20250514",
  };
  return { ...defaults, ...overrides };
}

/**
 * Create a system entry for testing
 */
function createSystemEntry(projectPath = "/work/test-project"): SystemEntry {
  return {
    type: "system",
    timestamp: Date.now(),
    projectPath,
    gitBranch: "main",
    reviewer: { agent: "claude", model: "claude-sonnet-4-20250514" },
    fixer: { agent: "codex" },
    maxIterations: 5,
  };
}

/**
 * Create an iteration entry with fixes for testing
 */
function createIterationEntry(fixes: FixEntry[]): IterationEntry {
  return {
    type: "iteration",
    timestamp: Date.now(),
    iteration: 1,
    duration: 5000,
    fixes: buildFixSummary({ decision: "APPLY_MOST", fixes }),
  };
}

function createDashboardData(projectPath: string, branch?: string): DashboardData {
  const projectName = getProjectName(projectPath);
  const emptyCounts = { P0: 0, P1: 0, P2: 0, P3: 0 };

  return {
    generatedAt: Date.now(),
    currentProject: projectName,
    globalStats: {
      totalFixes: 0,
      totalSkipped: 0,
      priorityCounts: emptyCounts,
      totalSessions: 1,
      averageIterations: 1,
      fixRate: 0,
    },
    projects: [
      {
        projectName,
        displayName: "project",
        totalFixes: 0,
        totalSkipped: 0,
        priorityCounts: emptyCounts,
        sessionCount: 1,
        averageIterations: 1,
        fixRate: 0,
        sessions: [
          {
            sessionPath: "/logs/session.jsonl",
            sessionName: "session.jsonl",
            timestamp: Date.now(),
            gitBranch: branch,
            status: "completed",
            totalFixes: 0,
            totalSkipped: 0,
            priorityCounts: emptyCounts,
            iterations: 1,
            entries: [],
            reviewer: "claude",
            reviewerModel: "claude-sonnet-4-20250514",
            reviewerDisplayName: "Claude",
            reviewerModelDisplayName: "claude-sonnet-4-20250514",
            fixer: "claude",
            fixerModel: "claude-sonnet-4-20250514",
            fixerDisplayName: "Claude",
            fixerModelDisplayName: "claude-sonnet-4-20250514",
          },
        ],
      },
    ],
    reviewerAgentStats: [],
    fixerAgentStats: [],
    reviewerModelStats: [],
    fixerModelStats: [],
  };
}

function createActiveSession(projectPath: string, branch: string): ActiveSession {
  return {
    schemaVersion: 2,
    sessionId: "active-session-id",
    sessionName: "rr-project-123",
    startTime: Date.now(),
    lastHeartbeat: Date.now(),
    pid: 12345,
    projectPath,
    branch,
    state: "running",
    mode: "background",
    lockPath: "/logs/lockfile.lock",
  };
}

describe("dashboard markRunningSessions", () => {
  test("marks by sessionId before branch/project heuristics", () => {
    const projectPath = "/work/project-a";
    const data = createDashboardData(projectPath, "feature/x");
    const active = createActiveSession(projectPath, "main");
    if (data.projects[0]?.sessions[0]) {
      data.projects[0].sessions[0].sessionId = "active-session-id";
    }

    markRunningSessions(data, [active]);

    expect(data.projects[0]?.sessions[0]?.status).toBe("running");
  });

  test("does not fall back when both IDs exist and differ", () => {
    const projectPath = "/work/project-a";
    const data = createDashboardData(projectPath, "main");
    const active = createActiveSession(projectPath, "main");
    if (data.projects[0]?.sessions[0]) {
      data.projects[0].sessions[0].sessionId = "different-session-id";
    }

    markRunningSessions(data, [active]);

    expect(data.projects[0]?.sessions[0]?.status).toBe("completed");
  });

  test("marks the matching project and branch as running", () => {
    const projectPath = "/work/project-a";
    const data = createDashboardData(projectPath, "main");
    const active = createActiveSession(projectPath, "main");

    markRunningSessions(data, [active]);

    expect(data.projects[0]?.sessions[0]?.status).toBe("running");
  });

  test("treats default branch as undefined when matching sessions", () => {
    const projectPath = "/work/project-b";
    const data = createDashboardData(projectPath, undefined);
    const active = createActiveSession(projectPath, "default");

    markRunningSessions(data, [active]);

    expect(data.projects[0]?.sessions[0]?.status).toBe("running");
  });
});

describe("pruneUnknownEmptySessions", () => {
  test("removes unknown 0-iteration sessions and recomputes aggregates", () => {
    const projectPath = "/work/project-a";
    const projectName = getProjectName(projectPath);
    const emptyCounts = { P0: 0, P1: 0, P2: 0, P3: 0 };

    const unknownEmpty = createSessionStats({
      sessionPath: "/logs/project-a/empty.jsonl",
      sessionName: "empty.jsonl",
      gitBranch: "main",
      status: "unknown",
      totalFixes: 0,
      totalSkipped: 0,
      priorityCounts: emptyCounts,
      iterations: 0,
      entries: [createSystemEntry(projectPath)],
    });

    const completed = createSessionStats({
      sessionPath: "/logs/project-a/done.jsonl",
      sessionName: "done.jsonl",
      gitBranch: "main",
      status: "completed",
      totalFixes: 2,
      totalSkipped: 1,
      priorityCounts: { P0: 1, P1: 0, P2: 1, P3: 0 },
      iterations: 1,
      entries: [createSystemEntry(projectPath), createIterationEntry([])],
    });

    const data: DashboardData = {
      generatedAt: Date.now(),
      currentProject: projectName,
      globalStats: {
        totalFixes: 999,
        totalSkipped: 999,
        priorityCounts: { P0: 999, P1: 999, P2: 999, P3: 999 },
        totalSessions: 999,
        averageIterations: 0,
        fixRate: 0,
      },
      projects: [
        {
          projectName,
          displayName: "project-a",
          totalFixes: 999,
          totalSkipped: 999,
          priorityCounts: { P0: 999, P1: 999, P2: 999, P3: 999 },
          sessionCount: 2,
          averageIterations: 0,
          fixRate: 0,
          sessions: [unknownEmpty, completed],
        },
      ],
      reviewerAgentStats: [],
      fixerAgentStats: [],
      reviewerModelStats: [],
      fixerModelStats: [],
    };

    const removed = pruneUnknownEmptySessions(data);

    expect(removed).toHaveLength(1);
    expect(data.projects).toHaveLength(1);
    expect(data.projects[0]?.sessions).toHaveLength(1);
    expect(data.projects[0]?.sessionCount).toBe(1);
    expect(data.projects[0]?.averageIterations).toBe(1);
    expect(data.projects[0]?.totalFixes).toBe(2);
    expect(data.projects[0]?.totalSkipped).toBe(1);
    expect(data.projects[0]?.priorityCounts.P0).toBe(1);
    expect(data.projects[0]?.priorityCounts.P2).toBe(1);

    expect(data.globalStats.totalSessions).toBe(1);
    expect(data.globalStats.averageIterations).toBe(1);
  });

  test("keeps empty sessions once marked as running", () => {
    const projectPath = "/work/project-a";
    const projectName = getProjectName(projectPath);
    const emptyCounts = { P0: 0, P1: 0, P2: 0, P3: 0 };

    const unknownEmpty = createSessionStats({
      sessionPath: "/logs/project-a/empty.jsonl",
      sessionName: "empty.jsonl",
      gitBranch: "main",
      status: "unknown",
      totalFixes: 0,
      totalSkipped: 0,
      priorityCounts: emptyCounts,
      iterations: 0,
      entries: [createSystemEntry(projectPath)],
    });

    const data: DashboardData = {
      generatedAt: Date.now(),
      currentProject: projectName,
      globalStats: {
        totalFixes: 0,
        totalSkipped: 0,
        priorityCounts: emptyCounts,
        totalSessions: 1,
        averageIterations: 0,
        fixRate: 0,
      },
      projects: [
        {
          projectName,
          displayName: "project-a",
          totalFixes: 0,
          totalSkipped: 0,
          priorityCounts: emptyCounts,
          sessionCount: 1,
          averageIterations: 0,
          fixRate: 0,
          sessions: [unknownEmpty],
        },
      ],
      reviewerAgentStats: [],
      fixerAgentStats: [],
      reviewerModelStats: [],
      fixerModelStats: [],
    };

    const active = createActiveSession(projectPath, "main");
    markRunningSessions(data, [active]);

    const removed = pruneUnknownEmptySessions(data);

    expect(removed).toHaveLength(0);
    expect(data.projects[0]?.sessions).toHaveLength(1);
    expect(data.projects[0]?.sessions[0]?.status).toBe("running");
    expect(data.globalStats.totalSessions).toBe(1);
  });
});

describe("removeSession", () => {
  test("removes session from correct project and recomputes aggregates", () => {
    const session1 = createSessionStats({
      sessionPath: "/logs/proj/session1.jsonl",
      totalFixes: 3,
      totalSkipped: 1,
      priorityCounts: { P0: 1, P1: 1, P2: 1, P3: 0 },
      iterations: 2,
    });
    const session2 = createSessionStats({
      sessionPath: "/logs/proj/session2.jsonl",
      totalFixes: 5,
      totalSkipped: 2,
      priorityCounts: { P0: 2, P1: 1, P2: 1, P3: 1 },
      iterations: 3,
    });

    const data: DashboardData = {
      generatedAt: Date.now(),
      globalStats: {
        totalFixes: 8,
        totalSkipped: 3,
        priorityCounts: { P0: 3, P1: 2, P2: 2, P3: 1 },
        totalSessions: 2,
        averageIterations: 2.5,
        fixRate: 8 / 11,
      },
      projects: [
        {
          projectName: "proj",
          displayName: "proj",
          totalFixes: 8,
          totalSkipped: 3,
          priorityCounts: { P0: 3, P1: 2, P2: 2, P3: 1 },
          sessionCount: 2,
          averageIterations: 2.5,
          fixRate: 8 / 11,
          sessions: [session1, session2],
        },
      ],
      reviewerAgentStats: [],
      fixerAgentStats: [],
      reviewerModelStats: [],
      fixerModelStats: [],
    };

    const result = removeSession(data, "/logs/proj/session1.jsonl");

    expect(result).toBe(true);
    expect(data.projects).toHaveLength(1);
    expect(data.projects[0]?.sessions).toHaveLength(1);
    expect(data.projects[0]?.sessionCount).toBe(1);
    expect(data.projects[0]?.totalFixes).toBe(5);
    expect(data.globalStats.totalFixes).toBe(5);
    expect(data.globalStats.totalSessions).toBe(1);
  });

  test("removes empty project after last session deleted", () => {
    const session = createSessionStats({
      sessionPath: "/logs/proj/only.jsonl",
      totalFixes: 1,
      totalSkipped: 0,
      priorityCounts: { P0: 0, P1: 1, P2: 0, P3: 0 },
      iterations: 1,
    });

    const data: DashboardData = {
      generatedAt: Date.now(),
      globalStats: {
        totalFixes: 1,
        totalSkipped: 0,
        priorityCounts: { P0: 0, P1: 1, P2: 0, P3: 0 },
        totalSessions: 1,
        averageIterations: 1,
        fixRate: 1,
      },
      projects: [
        {
          projectName: "proj",
          displayName: "proj",
          totalFixes: 1,
          totalSkipped: 0,
          priorityCounts: { P0: 0, P1: 1, P2: 0, P3: 0 },
          sessionCount: 1,
          averageIterations: 1,
          fixRate: 1,
          sessions: [session],
        },
      ],
      reviewerAgentStats: [],
      fixerAgentStats: [],
      reviewerModelStats: [],
      fixerModelStats: [],
    };

    const result = removeSession(data, "/logs/proj/only.jsonl");

    expect(result).toBe(true);
    expect(data.projects).toHaveLength(0);
    expect(data.globalStats.totalFixes).toBe(0);
    expect(data.globalStats.totalSessions).toBe(0);
  });

  test("returns false for unknown sessionPath", () => {
    const data: DashboardData = {
      generatedAt: Date.now(),
      globalStats: {
        totalFixes: 0,
        totalSkipped: 0,
        priorityCounts: { P0: 0, P1: 0, P2: 0, P3: 0 },
        totalSessions: 0,
        averageIterations: 0,
        fixRate: 0,
      },
      projects: [],
      reviewerAgentStats: [],
      fixerAgentStats: [],
      reviewerModelStats: [],
      fixerModelStats: [],
    };

    const result = removeSession(data, "/logs/nonexistent.jsonl");

    expect(result).toBe(false);
  });
});
