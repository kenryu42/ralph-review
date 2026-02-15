import { describe, expect, test } from "bun:test";
import {
  markRunningSessions,
  pruneUnknownEmptySessions,
  removeSession,
  runDashboard,
  runOpenCommand,
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

function createEmptyDashboardData(): DashboardData {
  return {
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
}

interface DashboardRuntimeHarness {
  spinnerStarts: string[];
  spinnerStops: string[];
  infos: string[];
  messages: string[];
  successes: string[];
  openCalls: Array<{ command: string; target: string }>;
  deletedSessionPaths: string[];
  serverStartCount: number;
  overrides: Parameters<typeof runDashboard>[1];
}

function createDashboardRuntimeHarness(
  options: {
    data?: DashboardData;
    activeSessions?: ActiveSession[];
    platform?: NodeJS.Platform;
    runOpenError?: Error;
  } = {}
): DashboardRuntimeHarness {
  const spinnerStarts: string[] = [];
  const spinnerStops: string[] = [];
  const infos: string[] = [];
  const messages: string[] = [];
  const successes: string[] = [];
  const openCalls: Array<{ command: string; target: string }> = [];
  const deletedSessionPaths: string[] = [];
  let serverStartCount = 0;
  const data = options.data ?? createDashboardData("/work/project-a", "main");
  const activeSessions = options.activeSessions ?? [];

  const overrides: Parameters<typeof runDashboard>[1] = {
    cwd: "/work/project-a",
    buildDashboardData: async () => data,
    listAllActiveSessions: async () => activeSessions,
    deleteSessionFiles: async (sessionPath: string) => {
      deletedSessionPaths.push(sessionPath);
    },
    startDashboardServer: () => {
      serverStartCount += 1;
      return { port: 4321 };
    },
    platform: options.platform ?? "darwin",
    runOpen: async (command: "open" | "xdg-open" | "start", target: string) => {
      openCalls.push({ command, target });
      if (options.runOpenError) {
        throw options.runOpenError;
      }
    },
    spinner: {
      start: (message: string) => spinnerStarts.push(message),
      stop: (message: string) => spinnerStops.push(message),
    },
    log: {
      info: (message: string) => infos.push(message),
      message: (message: string) => messages.push(message),
      success: (message: string) => successes.push(message),
    },
    waitForever: Promise.resolve(),
  };

  return {
    spinnerStarts,
    spinnerStops,
    infos,
    messages,
    successes,
    openCalls,
    deletedSessionPaths,
    get serverStartCount() {
      return serverStartCount;
    },
    overrides,
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

  test("ignores active sessions for projects that are not in dashboard data", () => {
    const data = createDashboardData("/work/project-a", "main");
    const active = createActiveSession("/work/project-b", "main");

    markRunningSessions(data, [active]);

    expect(data.projects[0]?.sessions[0]?.status).toBe("completed");
  });
});

describe("runOpenCommand", () => {
  test("calls open handler for darwin command", async () => {
    const calls: string[] = [];

    await runOpenCommand("open", "http://127.0.0.1:4321", {
      open: async (filePath: string) => {
        calls.push(`open:${filePath}`);
      },
    });

    expect(calls).toEqual(["open:http://127.0.0.1:4321"]);
  });

  test("calls xdg-open handler for linux command", async () => {
    const calls: string[] = [];

    await runOpenCommand("xdg-open", "http://127.0.0.1:4321", {
      xdgOpen: async (filePath: string) => {
        calls.push(`xdg-open:${filePath}`);
      },
    });

    expect(calls).toEqual(["xdg-open:http://127.0.0.1:4321"]);
  });

  test("calls start handler for win32 command", async () => {
    const calls: string[] = [];

    await runOpenCommand("start", "http://127.0.0.1:4321", {
      start: async (filePath: string) => {
        calls.push(`start:${filePath}`);
      },
    });

    expect(calls).toEqual(["start:http://127.0.0.1:4321"]);
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

describe("runDashboard", () => {
  test("logs empty-state message and returns when no projects exist", async () => {
    const harness = createDashboardRuntimeHarness({
      data: createEmptyDashboardData(),
    });

    await runDashboard([], harness.overrides);

    expect(harness.spinnerStarts).toEqual(["Building dashboard..."]);
    expect(harness.spinnerStops).toEqual(["Done"]);
    expect(harness.infos).toContain("No review data found.");
    expect(harness.messages).toContain('Start a review with "rr run" first.');
    expect(harness.serverStartCount).toBe(0);
    expect(harness.openCalls).toHaveLength(0);
  });

  test("starts server and opens dashboard on darwin", async () => {
    const harness = createDashboardRuntimeHarness();

    await runDashboard([], harness.overrides);

    expect(harness.serverStartCount).toBe(1);
    expect(harness.spinnerStops).toEqual(["Dashboard ready"]);
    expect(harness.successes).toContain("Opening dashboard (0 issues resolved)");
    expect(harness.infos).toContain("http://127.0.0.1:4321");
    expect(harness.infos).toContain("Press Ctrl+C to stop the dashboard.");
    expect(harness.openCalls).toEqual([{ command: "open", target: "http://127.0.0.1:4321" }]);
  });

  test("deletes pruned unknown empty session files", async () => {
    const data = createDashboardData("/work/project-a", "main");
    const unknownEmpty = createSessionStats({
      sessionPath: "/logs/project-a/unknown-empty.jsonl",
      sessionName: "unknown-empty.jsonl",
      status: "unknown",
      iterations: 0,
      totalFixes: 0,
      totalSkipped: 0,
      priorityCounts: { P0: 0, P1: 0, P2: 0, P3: 0 },
      entries: [],
    });
    const existingSession = data.projects[0]?.sessions[0];
    if (data.projects[0] && existingSession) {
      data.projects[0].sessions = [unknownEmpty, existingSession];
    }
    const harness = createDashboardRuntimeHarness({ data });

    await runDashboard([], harness.overrides);

    expect(harness.deletedSessionPaths).toEqual(["/logs/project-a/unknown-empty.jsonl"]);
  });

  test("uses xdg-open on linux", async () => {
    const harness = createDashboardRuntimeHarness({
      platform: "linux",
    });

    await runDashboard([], harness.overrides);

    expect(harness.openCalls).toEqual([{ command: "xdg-open", target: "http://127.0.0.1:4321" }]);
  });

  test("uses start on win32", async () => {
    const harness = createDashboardRuntimeHarness({
      platform: "win32",
    });

    await runDashboard([], harness.overrides);

    expect(harness.openCalls).toEqual([{ command: "start", target: "http://127.0.0.1:4321" }]);
  });

  test("logs manual browser instruction on unsupported platform", async () => {
    const harness = createDashboardRuntimeHarness({
      platform: "sunos",
    });

    await runDashboard([], harness.overrides);

    expect(harness.openCalls).toHaveLength(0);
    expect(harness.infos).toContain("Open this file in your browser: http://127.0.0.1:4321");
  });

  test("logs manual browser instruction when browser open command fails", async () => {
    const harness = createDashboardRuntimeHarness({
      platform: "darwin",
      runOpenError: new Error("failed to open browser"),
    });

    await runDashboard([], harness.overrides);

    expect(harness.openCalls).toEqual([{ command: "open", target: "http://127.0.0.1:4321" }]);
    expect(harness.infos).toContain("Open this file in your browser: http://127.0.0.1:4321");
  });
});
