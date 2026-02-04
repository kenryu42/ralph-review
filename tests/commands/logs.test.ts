import { describe, expect, test } from "bun:test";
import {
  buildGlobalSessionsJson,
  buildProjectSessionsJson,
  buildSessionJson,
  formatDuration,
  formatPriorityCounts,
  formatStatus,
  markRunningSessions,
} from "@/commands/logs";
import type { ActiveSession } from "@/lib/lockfile";
import { getProjectName } from "@/lib/logger";
import type {
  DashboardData,
  FixEntry,
  IterationEntry,
  SessionStats,
  SystemEntry,
} from "@/lib/types";
import { buildFixEntry, buildFixSummary } from "../test-utils/fix-summary";

/**
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
      successRate: 100,
    },
    projects: [
      {
        projectName,
        displayName: "project",
        totalFixes: 0,
        totalSkipped: 0,
        priorityCounts: emptyCounts,
        sessionCount: 1,
        successCount: 1,
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
          },
        ],
      },
    ],
  };
}

function createActiveSession(projectPath: string, branch: string): ActiveSession {
  return {
    sessionName: "rr-project-123",
    startTime: Date.now(),
    pid: 12345,
    projectPath,
    branch,
    lockPath: "/logs/lockfile.lock",
  };
}

describe("logs markRunningSessions", () => {
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

describe("formatStatus", () => {
  test("returns checkmark for completed status", () => {
    expect(formatStatus("completed")).toBe("completed");
  });

  test("returns running indicator for running status", () => {
    expect(formatStatus("running")).toBe("running");
  });

  test("returns failed indicator for failed status", () => {
    expect(formatStatus("failed")).toBe("failed");
  });

  test("returns interrupted indicator for interrupted status", () => {
    expect(formatStatus("interrupted")).toBe("interrupted");
  });

  test("returns unknown for unknown status", () => {
    expect(formatStatus("unknown")).toBe("unknown");
  });
});

describe("formatPriorityCounts", () => {
  test("formats all priority counts", () => {
    const counts = { P0: 2, P1: 5, P2: 3, P3: 1 };
    const result = formatPriorityCounts(counts);
    expect(result).toBe("P0: 2  P1: 5  P2: 3  P3: 1");
  });

  test("formats zero counts", () => {
    const counts = { P0: 0, P1: 0, P2: 0, P3: 0 };
    const result = formatPriorityCounts(counts);
    expect(result).toBe("P0: 0  P1: 0  P2: 0  P3: 0");
  });
});

describe("formatDuration", () => {
  test("formats seconds only when under a minute", () => {
    expect(formatDuration(5000)).toBe("5s");
    expect(formatDuration(59000)).toBe("59s");
  });

  test("formats minutes and seconds", () => {
    expect(formatDuration(60000)).toBe("1m 0s");
    expect(formatDuration(90000)).toBe("1m 30s");
    expect(formatDuration(150000)).toBe("2m 30s");
  });

  test("formats hours minutes and seconds", () => {
    expect(formatDuration(3600000)).toBe("1h 0m 0s");
    expect(formatDuration(3661000)).toBe("1h 1m 1s");
    expect(formatDuration(7325000)).toBe("2h 2m 5s");
  });

  test("handles zero duration", () => {
    expect(formatDuration(0)).toBe("0s");
  });

  test("rounds down partial seconds", () => {
    expect(formatDuration(1500)).toBe("1s");
    expect(formatDuration(1999)).toBe("1s");
  });
});

describe("buildSessionJson", () => {
  test("builds correct JSON structure for session", () => {
    const fixes = [
      buildFixEntry({ id: 1, priority: "P0", title: "Critical fix", file: "src/file1.ts" }),
      buildFixEntry({ id: 2, priority: "P1", title: "High priority fix", file: "src/file2.ts" }),
    ];
    const skipped = [
      { id: 3, title: "Skipped item", priority: "P3" as const, reason: "Not applicable" },
    ];
    const session = createSessionStats({
      gitBranch: "feature/test",
      status: "completed",
      totalFixes: 2,
      totalSkipped: 1,
      priorityCounts: { P0: 1, P1: 1, P2: 0, P3: 0 },
      iterations: 2,
    });

    const result = buildSessionJson("test-project", session, fixes, skipped);

    expect(result.project).toBe("test-project");
    expect(result.branch).toBe("feature/test");
    expect(result.status).toBe("completed");
    expect(result.iterations).toBe(2);
    expect(result.summary.totalFixes).toBe(2);
    expect(result.summary.totalSkipped).toBe(1);
    expect(result.summary.priorityCounts.P0).toBe(1);
    expect(result.fixes).toHaveLength(2);
    expect(result.skipped).toHaveLength(1);
  });

  test("handles session with no branch", () => {
    const session = createSessionStats({ gitBranch: undefined });
    const result = buildSessionJson("project", session, [], []);
    expect(result.branch).toBeUndefined();
  });

  test("includes reviewer and fixer agent info from system entry", () => {
    const systemEntry = createSystemEntry();
    const session = createSessionStats({ entries: [systemEntry] });
    const result = buildSessionJson("project", session, [], []);

    expect(result.reviewer).toEqual({ agent: "claude", model: "claude-sonnet-4-20250514" });
    expect(result.fixer).toEqual({ agent: "codex" });
  });

  test("handles session without system entry", () => {
    const session = createSessionStats({ entries: [] });
    const result = buildSessionJson("project", session, [], []);

    expect(result.reviewer).toBeUndefined();
    expect(result.fixer).toBeUndefined();
  });

  test("includes duration in JSON output", () => {
    const session = createSessionStats({ totalDuration: 150000 });
    const result = buildSessionJson("project", session, [], []);
    expect(result.duration).toBe(150000);
  });

  test("omits duration when totalDuration is undefined", () => {
    const session = createSessionStats({ totalDuration: undefined });
    const result = buildSessionJson("project", session, [], []);
    expect(result.duration).toBeUndefined();
  });
});

describe("buildProjectSessionsJson", () => {
  test("wraps multiple sessions in project-scoped structure", () => {
    const session1 = createSessionStats({
      gitBranch: "main",
      totalFixes: 3,
      entries: [
        createSystemEntry(),
        createIterationEntry([buildFixEntry({ id: 1, priority: "P0", title: "Fix 1" })]),
      ],
    });
    const session2 = createSessionStats({
      gitBranch: "feature/x",
      totalFixes: 2,
      entries: [createSystemEntry()],
    });

    const result = buildProjectSessionsJson("test-project", [session1, session2]);

    expect(result.project).toBe("test-project");
    expect(result.sessions).toHaveLength(2);
    expect(result.sessions[0]?.branch).toBe("main");
    expect(result.sessions[1]?.branch).toBe("feature/x");
  });

  test("returns empty sessions array when no sessions", () => {
    const result = buildProjectSessionsJson("test-project", []);

    expect(result.project).toBe("test-project");
    expect(result.sessions).toHaveLength(0);
  });

  test("extracts fixes from iteration entries", () => {
    const fix = buildFixEntry({ id: 1, priority: "P0", title: "Critical fix" });
    const iterEntry = createIterationEntry([fix]);
    const session = createSessionStats({
      entries: [createSystemEntry(), iterEntry],
    });

    const result = buildProjectSessionsJson("project", [session]);

    expect(result.sessions[0]?.fixes).toHaveLength(1);
    expect(result.sessions[0]?.fixes[0]?.title).toBe("Critical fix");
  });
});

describe("buildGlobalSessionsJson", () => {
  test("wraps sessions from multiple projects", () => {
    const session1 = createSessionStats({
      entries: [createSystemEntry("/work/project-a")],
    });
    const session2 = createSessionStats({
      entries: [createSystemEntry("/work/project-b")],
    });

    const result = buildGlobalSessionsJson([session1, session2]);

    expect(result.sessions).toHaveLength(2);
    // Project names are derived from paths
    expect(result.sessions[0]?.project).toBe("work-project-a");
    expect(result.sessions[1]?.project).toBe("work-project-b");
  });

  test("returns empty sessions array when no sessions", () => {
    const result = buildGlobalSessionsJson([]);

    expect(result.sessions).toHaveLength(0);
  });

  test("uses unknown project when no system entry", () => {
    const session = createSessionStats({ entries: [] });

    const result = buildGlobalSessionsJson([session]);

    expect(result.sessions[0]?.project).toBe("unknown");
  });
});
