import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, createElement } from "react";
import { StatusBar } from "@/lib/tui/components/StatusBar";

describe("StatusBar", () => {
  let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

  afterEach(async () => {
    if (testSetup) {
      await act(async () => {
        testSetup?.renderer.destroy();
      });
      testSetup = null;
    }
  });

  async function renderFrame(
    props: Partial<Parameters<typeof StatusBar>[0]> = {}
  ): Promise<string> {
    const defaultProps: Parameters<typeof StatusBar>[0] = {
      hasSession: true,
      focusedPane: "detail",
      outputVisible: false,
      stopPickerOpen: false,
    };

    testSetup = await testRender(createElement(StatusBar, { ...defaultProps, ...props }), {
      width: 120,
      height: 4,
    });

    await act(async () => {
      await testSetup?.renderOnce();
    });

    return testSetup.captureCharFrame();
  }

  test("shows normal dashboard shortcuts when the stop picker is closed", async () => {
    const frame = await renderFrame({ stopPickerOpen: false });

    expect(frame).toContain("[s]");
    expect(frame).toContain("Stop Review");
    expect(frame).toContain("[Tab ←/→]");
    expect(frame).toContain("Switch");
  });

  test("shows picker-specific shortcuts when the stop picker is open", async () => {
    const frame = await renderFrame({ stopPickerOpen: true });

    expect(frame).toContain("[↑/↓]");
    expect(frame).toContain("Choose");
    expect(frame).toContain("[Enter]");
    expect(frame).toContain("Stop");
    expect(frame).toContain("[Esc]");
    expect(frame).toContain("Cancel");
    expect(frame).not.toContain("Switch");
  });
});
