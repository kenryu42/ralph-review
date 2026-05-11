import { afterEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { SessionGroup } from "@/lib/tui/sessions/sidebar/SessionGroup";
import { SessionItem } from "@/lib/tui/sessions/sidebar/SessionItem";
import {
  createActiveSession,
  destroyTestRender,
  renderOnce,
  type TestRenderSetup,
} from "../../helpers/tui";

describe("SessionGroup and SessionItem", () => {
  let testSetup: TestRenderSetup | null = null;

  afterEach(async () => {
    await destroyTestRender(testSetup);
    testSetup = null;
  });

  async function renderFrame(node: ReturnType<typeof createElement>): Promise<string> {
    testSetup = await renderOnce(node, {
      width: 80,
      height: 20,
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
