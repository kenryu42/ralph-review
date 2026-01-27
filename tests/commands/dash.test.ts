import { describe, expect, test } from "bun:test";
import { markRunningSessions } from "@/commands/dash";
import type { ActiveSession } from "@/lib/lockfile";
import { getProjectName } from "@/lib/logger";
import type { DashboardData } from "@/lib/types";

function createDashboardData(projectPath: string, branch?: string): DashboardData {
  const projectName = getProjectName(projectPath);
  const emptyCounts = { P1: 0, P2: 0, P3: 0, P4: 0 };

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

describe("dash markRunningSessions", () => {
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
