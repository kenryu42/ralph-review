import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, createElement } from "react";
import type { ActiveSession } from "@/lib/session-state";
import { SessionGroup } from "@/lib/tui/components/SessionGroup";
import { SessionItem } from "@/lib/tui/components/SessionItem";

function createActiveSession(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    schemaVersion: 2,
    sessionId: "session-1",
    sessionName: "rr-project-main",
    startTime: Date.now() - 5_000,
    lastHeartbeat: Date.now(),
    pid: process.pid,
    projectPath: "/repo/project",
    branch: "main",
    state: "running",
    mode: "background",
    iteration: 1,
    currentAgent: "reviewer",
    sessionStatePath: "/tmp/rr-project-main.lock",
    sessionPath: "/tmp/logs/rr-project-main.jsonl",
    ...overrides,
  };
}

describe("SessionGroup and SessionItem", () => {
  let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

  afterEach(async () => {
    if (testSetup) {
      await act(async () => {
        testSetup?.renderer.destroy();
      });
      testSetup = null;
    }
  });

  async function renderFrame(node: ReturnType<typeof createElement>): Promise<string> {
    testSetup = await testRender(node, {
      width: 80,
      height: 20,
    });

    await act(async () => {
      await testSetup?.renderOnce();
    });

    return testSetup.captureCharFrame();
  }

  test("renders current-project groups with their sessions and counts", async () => {
    const runningSession = createActiveSession();
    const pendingSession = createActiveSession({
      sessionId: "session-2",
      sessionName: "rr-project-feature",
      state: "pending",
    });

    const frame = await renderFrame(
      createElement(SessionGroup, {
        group: {
          projectPath: "/repo/project",
          projectName: "repo-project",
          isCurrentProject: true,
          sessions: [runningSession, pendingSession],
        },
        selectedSessionId: runningSession.sessionId,
      })
    );

    expect(frame).toContain("◆");
    expect(frame).toContain("repo-project");
    expect(frame).toContain("(2)");
    expect(frame).toContain("rr-project-main");
    expect(frame).toContain("rr-project-feature");
    expect(frame).toContain("●");
    expect(frame).toContain("◌");
  });

  test("renders an empty non-current group with the fallback message", async () => {
    const frame = await renderFrame(
      createElement(SessionGroup, {
        group: {
          projectPath: "/repo/other",
          projectName: "repo-other",
          isCurrentProject: false,
          sessions: [],
        },
        selectedSessionId: null,
      })
    );

    expect(frame).toContain("○");
    expect(frame).toContain("repo-other");
    expect(frame).toContain("No active sessions");
  });

  test("renders status icons for completed and interrupted item states", async () => {
    const completedFrame = await renderFrame(
      createElement(SessionItem, {
        session: createActiveSession({
          sessionName: "rr-complete",
          state: "completed",
        }),
        isSelected: false,
      })
    );

    expect(completedFrame).toContain("rr-complete");
    expect(completedFrame).toContain("✓");

    const unknownFrame = await renderFrame(
      createElement(SessionItem, {
        session: createActiveSession({
          sessionId: "session-3",
          sessionName: "rr-interrupted",
          state: "interrupted",
        }),
        isSelected: false,
      })
    );

    expect(unknownFrame).toContain("rr-interrupted");
    expect(unknownFrame).toContain("⊘");
  });
});
