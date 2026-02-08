import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getHtmlPath, getSummaryPath } from "@/lib/logger";
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

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ralph-server-test-"));
  });

  afterEach(async () => {
    if (server) {
      server.stop(true);
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
