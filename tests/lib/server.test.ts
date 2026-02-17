import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as lockfile from "@/lib/lockfile";
import { createLockfile, removeLockfile } from "@/lib/lockfile";
import * as logger from "@/lib/logger";
import { getHtmlPath, getProjectName, getSummaryPath } from "@/lib/logger";
import { type DashboardServerEvent, startDashboardServer } from "@/lib/server";
import type { DashboardData, SessionStats } from "@/lib/types";

function createTestData(tempDir: string): DashboardData {
  const sessionPath = join(tempDir, "project", "session.jsonl");
  return {
    generatedAt: Date.now(),
    currentProject: "project",
    globalStats: {
      totalFixes: 3,
      totalSkipped: 1,
      priorityCounts: { P0: 1, P1: 1, P2: 1, P3: 0 },
      totalSessions: 1,
      averageIterations: 2,
      fixRate: 0.75,
    },
    projects: [
      {
        projectName: "project",
        displayName: "project",
        totalFixes: 3,
        totalSkipped: 1,
        priorityCounts: { P0: 1, P1: 1, P2: 1, P3: 0 },
        sessionCount: 1,
        averageIterations: 2,
        fixRate: 0.75,
        sessions: [
          {
            sessionPath,
            sessionName: "session.jsonl",
            timestamp: Date.now(),
            gitBranch: "main",
            status: "completed",
            totalFixes: 3,
            totalSkipped: 1,
            priorityCounts: { P0: 1, P1: 1, P2: 1, P3: 0 },
            iterations: 2,
            entries: [],
            reviewer: "claude",
            reviewerModel: "claude-sonnet-4",
            reviewerDisplayName: "Claude",
            reviewerModelDisplayName: "claude-sonnet-4",
            fixer: "claude",
            fixerModel: "claude-sonnet-4",
            fixerDisplayName: "Claude",
            fixerModelDisplayName: "claude-sonnet-4",
          } as SessionStats,
        ],
      },
    ],
    reviewerAgentStats: [],
    fixerAgentStats: [],
    reviewerModelStats: [],
    fixerModelStats: [],
  };
}

function createEventCollector(): {
  events: DashboardServerEvent[];
  onEvent: (event: DashboardServerEvent) => void;
} {
  const events: DashboardServerEvent[] = [];
  return {
    events,
    onEvent: (event) => {
      events.push(event);
    },
  };
}

describe("server", () => {
  let tempDir: string;
  let server: ReturnType<typeof Bun.serve>;
  let createdLocks: Array<{ projectPath: string; sessionId: string }>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ralph-server-test-"));
    createdLocks = [];
  });

  afterEach(async () => {
    if (server) {
      server.stop(true);
    }
    mock.restore();
    for (const lock of createdLocks) {
      await removeLockfile(tempDir, lock.projectPath, { expectedSessionId: lock.sessionId });
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  test("GET / returns 200 with text/html containing dashboard", async () => {
    const data = createTestData(tempDir);
    server = startDashboardServer({ data });

    const res = await fetch(`http://localhost:${server.port}/`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("<!DOCTYPE html>");
    expect(body).toContain("Ralph Review Dashboard");
  });

  test("DELETE /api/sessions with valid sessionPath returns 200 and updated data", async () => {
    const data = createTestData(tempDir);
    const sessionPath = data.projects[0]?.sessions[0]?.sessionPath ?? "";
    const { events, onEvent } = createEventCollector();

    // Create the session files so they can be deleted
    await Bun.write(sessionPath, '{"type":"system"}\n', { createPath: true });
    await Bun.write(getHtmlPath(sessionPath), "<html></html>", { createPath: true });
    await Bun.write(getSummaryPath(sessionPath), "{}", { createPath: true });

    server = startDashboardServer({ data, onEvent });

    const res = await fetch(`http://localhost:${server.port}/api/sessions`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionPath }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as DashboardData;
    expect(body.globalStats.totalSessions).toBe(0);
    expect(body.projects).toHaveLength(0);

    // Files should be deleted
    expect(await Bun.file(sessionPath).exists()).toBe(false);
    expect(await Bun.file(getHtmlPath(sessionPath)).exists()).toBe(false);
    expect(await Bun.file(getSummaryPath(sessionPath)).exists()).toBe(false);

    expect(events.map((event) => event.event)).toEqual([
      "session_delete_requested",
      "session_delete_success",
    ]);
    const successEvent = events[1];
    expect(successEvent?.status).toBe(200);
    expect(successEvent?.sessionPath).toBe(sessionPath);
  });

  test("DELETE /api/sessions with unknown sessionPath returns 404", async () => {
    const data = createTestData(tempDir);
    const { events, onEvent } = createEventCollector();
    const missingPath = "/nonexistent/session.jsonl";
    server = startDashboardServer({ data, onEvent });

    const res = await fetch(`http://localhost:${server.port}/api/sessions`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionPath: missingPath }),
    });

    expect(res.status).toBe(404);
    expect(events.map((event) => event.event)).toEqual([
      "session_delete_requested",
      "session_delete_not_found",
    ]);
    expect(events[1]?.status).toBe(404);
    expect(events[1]?.sessionPath).toBe(missingPath);
    expect(events[1]?.reason).toBe("session_not_found");
  });

  test("DELETE /api/sessions returns 409 when the target sessionId is actively running", async () => {
    const data = createTestData(tempDir);
    const session = data.projects[0]?.sessions[0];
    const sessionPath = session?.sessionPath ?? "";
    const runningSessionId = "running-session-id";
    const activeProjectPath = join(tempDir, "active-project");
    if (session) {
      session.status = "running";
      session.sessionId = runningSessionId;
    }

    await createLockfile(tempDir, activeProjectPath, "rr-running-session", {
      branch: "main",
      sessionId: runningSessionId,
      state: "running",
      mode: "background",
      lastHeartbeat: Date.now(),
      pid: process.pid,
    });
    createdLocks.push({ projectPath: activeProjectPath, sessionId: runningSessionId });

    const { events, onEvent } = createEventCollector();
    server = startDashboardServer({ data, onEvent, logsDir: tempDir });

    const res = await fetch(`http://localhost:${server.port}/api/sessions`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionPath }),
    });

    expect(res.status).toBe(409);
    expect(await res.text()).toContain("Cannot delete a running session");

    expect(events.map((event) => event.event)).toEqual([
      "session_delete_requested",
      "session_delete_running_conflict",
    ]);
    expect(events[1]?.status).toBe(409);
    expect(events[1]?.sessionPath).toBe(sessionPath);
    expect(events[1]?.reason).toBe("running_session");
  });

  test("DELETE /api/sessions returns 409 when project and branch match an active session", async () => {
    const data = createTestData(tempDir);
    const project = data.projects[0];
    const session = project?.sessions[0];
    const sessionPath = session?.sessionPath ?? "";
    const runningSessionId = "running-branch-session-id";
    const activeProjectPath = join(tempDir, "active-project");
    if (project && session) {
      project.projectName = getProjectName(activeProjectPath);
      session.status = "running";
      session.sessionId = undefined;
      session.gitBranch = "main";
    }

    await createLockfile(tempDir, activeProjectPath, "rr-running-session", {
      branch: "main",
      sessionId: runningSessionId,
      state: "running",
      mode: "background",
      lastHeartbeat: Date.now(),
      pid: process.pid,
    });
    createdLocks.push({ projectPath: activeProjectPath, sessionId: runningSessionId });

    const { events, onEvent } = createEventCollector();
    server = startDashboardServer({ data, onEvent, logsDir: tempDir });

    const res = await fetch(`http://localhost:${server.port}/api/sessions`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionPath }),
    });

    expect(res.status).toBe(409);
    expect(await res.text()).toContain("Cannot delete a running session");
    expect(events.map((event) => event.event)).toEqual([
      "session_delete_requested",
      "session_delete_running_conflict",
    ]);
    expect(events[1]?.status).toBe(409);
    expect(events[1]?.details?.projectName).toBe(project?.projectName);
    expect(events[1]?.details?.gitBranch).toBe("main");
  });

  test("DELETE /api/sessions deletes a non-terminal session when no active lock exists", async () => {
    const data = createTestData(tempDir);
    const session = data.projects[0]?.sessions[0];
    const sessionPath = session?.sessionPath ?? "";
    const { events, onEvent } = createEventCollector();
    if (session) {
      session.status = "running";
      session.sessionId = undefined;
    }

    await Bun.write(sessionPath, '{"type":"system"}\n', { createPath: true });
    await Bun.write(getHtmlPath(sessionPath), "<html></html>", { createPath: true });
    await Bun.write(getSummaryPath(sessionPath), "{}", { createPath: true });

    server = startDashboardServer({ data, onEvent });

    const res = await fetch(`http://localhost:${server.port}/api/sessions`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionPath }),
    });

    expect(res.status).toBe(200);
    expect(events.map((event) => event.event)).toEqual([
      "session_delete_requested",
      "session_delete_success",
    ]);
  });

  test("DELETE /api/sessions with missing body returns 400", async () => {
    const data = createTestData(tempDir);
    const { events, onEvent } = createEventCollector();
    server = startDashboardServer({ data, onEvent });

    const res = await fetch(`http://localhost:${server.port}/api/sessions`, {
      method: "DELETE",
    });

    expect(res.status).toBe(400);
    expect(events.map((event) => event.event)).toEqual([
      "session_delete_requested",
      "session_delete_invalid_json",
    ]);
    expect(events[1]?.status).toBe(400);
    expect(events[1]?.reason).toBe("invalid_json");
  });

  test("DELETE /api/sessions with missing sessionPath field returns 400", async () => {
    const data = createTestData(tempDir);
    const { events, onEvent } = createEventCollector();
    server = startDashboardServer({ data, onEvent });

    const res = await fetch(`http://localhost:${server.port}/api/sessions`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    expect(events.map((event) => event.event)).toEqual([
      "session_delete_requested",
      "session_delete_missing_session_path",
    ]);
    expect(events[1]?.status).toBe(400);
    expect(events[1]?.reason).toBe("missing_session_path");
  });

  test("DELETE /api/sessions uses default JSON event sink when onEvent is absent", async () => {
    const data = createTestData(tempDir);
    const originalLog = console.log;
    const emitted: string[] = [];
    console.log = ((...args: unknown[]) => {
      emitted.push(args.map(String).join(" "));
    }) as typeof console.log;
    try {
      server = startDashboardServer({ data });

      const res = await fetch(`http://localhost:${server.port}/api/sessions`, {
        method: "DELETE",
      });

      expect(res.status).toBe(400);
    } finally {
      console.log = originalLog;
    }

    const events = emitted.flatMap((entry) => {
      try {
        const parsed = JSON.parse(entry) as DashboardServerEvent;
        return parsed.source === "dashboard-server" ? [parsed] : [];
      } catch {
        return [];
      }
    });
    expect(events[0]?.event).toBe("session_delete_requested");
    expect(events[1]?.event).toBe("session_delete_invalid_json");
  });

  test("DELETE /api/sessions keeps request handling resilient when onEvent throws", async () => {
    const data = createTestData(tempDir);
    const originalError = console.error;
    const errors: string[] = [];
    console.error = ((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    }) as typeof console.error;
    try {
      server = startDashboardServer({
        data,
        onEvent: () => {
          throw "sink-failure";
        },
      });

      const res = await fetch(`http://localhost:${server.port}/api/sessions`, {
        method: "DELETE",
      });

      expect(res.status).toBe(400);
    } finally {
      console.error = originalError;
    }

    expect(errors.some((line) => line.includes("failed to emit log event: sink-failure"))).toBe(
      true
    );
  });

  test("DELETE /api/sessions returns 500 when deleting session files fails", async () => {
    spyOn(logger, "deleteSessionFiles").mockImplementation(async () => {
      throw new Error("disk failure");
    });
    const data = createTestData(tempDir);
    const sessionPath = data.projects[0]?.sessions[0]?.sessionPath ?? "";
    const { events, onEvent } = createEventCollector();
    server = startDashboardServer({ data, onEvent });

    const res = await fetch(`http://localhost:${server.port}/api/sessions`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionPath }),
    });

    expect(res.status).toBe(500);
    expect(await res.text()).toContain("Failed to delete session files");
    expect(events.map((event) => event.event)).toEqual([
      "session_delete_requested",
      "session_delete_delete_files_failed",
    ]);
    expect(events[1]?.status).toBe("error");
    expect(events[1]?.reason).toBe("delete_session_files_failed");
    expect(events[1]?.details?.message).toBe("disk failure");
  });

  test("DELETE /api/sessions returns 500 when lockfile lookup throws a non-Error", async () => {
    spyOn(lockfile, "listAllActiveSessions").mockImplementation(async () => {
      throw "lockfile exploded";
    });
    const data = createTestData(tempDir);
    const sessionPath = data.projects[0]?.sessions[0]?.sessionPath ?? "";
    const { events, onEvent } = createEventCollector();
    server = startDashboardServer({ data, onEvent });

    const res = await fetch(`http://localhost:${server.port}/api/sessions`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionPath }),
    });

    expect(res.status).toBe(500);
    expect(await res.text()).toContain("Internal server error");
    expect(events.map((event) => event.event)).toEqual([
      "session_delete_requested",
      "session_delete_unhandled_error",
    ]);
    expect(events[1]?.status).toBe(500);
    expect(events[1]?.sessionPath).toBe(sessionPath);
    expect(events[1]?.reason).toBe("unexpected_error");
    expect(events[1]?.details?.message).toBe("lockfile exploded");
  });

  test("GET /api/sessions returns 405", async () => {
    const data = createTestData(tempDir);
    server = startDashboardServer({ data });

    const res = await fetch(`http://localhost:${server.port}/api/sessions`);

    expect(res.status).toBe(405);
  });

  test("GET /unknown returns 404", async () => {
    const data = createTestData(tempDir);
    server = startDashboardServer({ data });

    const res = await fetch(`http://localhost:${server.port}/unknown`);

    expect(res.status).toBe(404);
  });
});
