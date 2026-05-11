import { afterEach, describe, expect, test } from "bun:test";
import { act, createElement } from "react";
import { StopSessionPickerOverlay } from "@/lib/tui/dashboard/StopSessionPickerOverlay";
import {
  createActiveSession,
  destroyTestRender,
  renderOnce,
  type TestRenderSetup,
} from "../../helpers/tui";

describe("StopSessionPickerOverlay", () => {
  let testSetup: TestRenderSetup | null = null;

  afterEach(async () => {
    await destroyTestRender(testSetup);
    testSetup = null;
  });

  async function renderPicker(
    props: Partial<Parameters<typeof StopSessionPickerOverlay>[0]> = {}
  ): Promise<TestRenderSetup> {
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

    testSetup = await renderOnce(
      createElement(StopSessionPickerOverlay, { ...defaultProps, ...props }),
      {
        width: 120,
        height: 30,
      }
    );

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
