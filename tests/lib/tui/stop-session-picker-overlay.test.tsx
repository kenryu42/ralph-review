import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, createElement } from "react";
import type { ActiveSession } from "@/lib/session-state";
import { StopSessionPickerOverlay } from "@/lib/tui/components/StopSessionPickerOverlay";

function createActiveSession(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    schemaVersion: 2,
    sessionId: "session-1",
    sessionName: "rr-project-main",
    startTime: 1,
    lastHeartbeat: 1,
    pid: 123,
    projectPath: "/repo/project",
    branch: "main",
    state: "running",
    mode: "background",
    sessionStatePath: "/tmp/session-1.json",
    ...overrides,
  };
}

describe("StopSessionPickerOverlay", () => {
  let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

  afterEach(async () => {
    if (testSetup) {
      await act(async () => {
        testSetup?.renderer.destroy();
      });
      testSetup = null;
    }
  });

  async function renderPicker(
    props: Partial<Parameters<typeof StopSessionPickerOverlay>[0]> = {}
  ): Promise<Awaited<ReturnType<typeof testRender>>> {
    const defaultProps: Parameters<typeof StopSessionPickerOverlay>[0] = {
      sessions: [
        createActiveSession({
          sessionId: "session-new",
          sessionName: "rr-new",
          worktreeBranch: "rr-worktree-session-new",
          startTime: 200,
        }),
        createActiveSession({
          sessionId: "session-old",
          sessionName: "rr-old",
          worktreeBranch: "rr-worktree-session-old",
          startTime: 100,
        }),
      ],
      onSelectSession: () => {},
      onClose: () => {},
    };

    testSetup = await testRender(
      createElement(StopSessionPickerOverlay, { ...defaultProps, ...props }),
      {
        width: 120,
        height: 30,
      }
    );

    await act(async () => {
      await testSetup?.renderOnce();
    });

    return testSetup;
  }

  test("renders the stop-session overlay with session details", async () => {
    const setup = await renderPicker();
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Stop Review Session");
    expect(frame).toContain("rr-new");
    expect(frame).toContain("rr-old");
    expect(frame).toContain("rr-worktree-session-new");
  });

  test("selects the highlighted session when enter is pressed", async () => {
    const selected: string[] = [];
    const setup = await renderPicker({
      onSelectSession: (session) => {
        selected.push(session.sessionId);
      },
    });

    await act(async () => {
      setup.mockInput.pressArrow("down");
      await setup.renderOnce();
      setup.mockInput.pressEnter();
      await setup.renderOnce();
    });

    expect(selected).toEqual(["session-old"]);
  });

  test("closes the overlay when q is pressed", async () => {
    let closeCount = 0;
    const selected: string[] = [];
    const setup = await renderPicker({
      onSelectSession: (session) => {
        selected.push(session.sessionId);
      },
      onClose: () => {
        closeCount += 1;
      },
    });

    await act(async () => {
      await setup.mockInput.typeText("q");
      await setup.renderOnce();
    });

    expect(closeCount).toBe(1);
    expect(selected).toEqual([]);
  });
});
