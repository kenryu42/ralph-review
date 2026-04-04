import { afterEach, describe, expect, test } from "bun:test";
import { KeyEvent } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, createElement } from "react";
import { HistoryOverlay } from "@/lib/tui/components/HistoryOverlay";

describe("HistoryOverlay", () => {
  let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

  afterEach(async () => {
    if (testSetup) {
      await act(async () => {
        testSetup?.renderer.destroy();
      });
      testSetup = null;
    }
  });

  async function renderOverlay(
    props: Partial<Parameters<typeof HistoryOverlay>[0]> = {}
  ): Promise<Awaited<ReturnType<typeof testRender>>> {
    const defaultProps: Parameters<typeof HistoryOverlay>[0] = {
      onClose: () => {},
      ...props,
    };

    testSetup = await testRender(createElement(HistoryOverlay, defaultProps), {
      width: 120,
      height: 30,
    });

    await act(async () => {
      await testSetup?.renderOnce();
    });

    return testSetup;
  }

  test("renders the History pane title", async () => {
    const setup = await renderOverlay();
    const frame = setup.captureCharFrame();

    expect(frame).toContain("History");
  });

  test("shows loading state initially", async () => {
    const setup = await renderOverlay();
    const frame = setup.captureCharFrame();

    // Shows "Loading..." while fetching sessions from disk
    expect(frame).toContain("Loading...");
  });

  test("closes when Esc is pressed", async () => {
    let closeCount = 0;
    const setup = await renderOverlay({
      onClose: () => {
        closeCount += 1;
      },
    });

    await act(async () => {
      setup.renderer.keyInput.emit(
        "keypress",
        new KeyEvent({
          name: "escape",
          sequence: "\x1B",
          ctrl: false,
          shift: false,
          meta: false,
          option: false,
          eventType: "press",
          repeated: false,
          source: "raw",
          number: false,
          raw: "\x1B",
        })
      );
      await setup.renderOnce();
    });

    expect(closeCount).toBe(1);
  });

  test("closes when l is pressed", async () => {
    let closeCount = 0;
    const setup = await renderOverlay({
      onClose: () => {
        closeCount += 1;
      },
    });

    await act(async () => {
      await setup.mockInput.typeText("l");
      await setup.renderOnce();
    });

    expect(closeCount).toBe(1);
  });
});
