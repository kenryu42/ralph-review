import { afterEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { StatusBar } from "@/lib/tui/dashboard/StatusBar";
import { destroyTestRender, renderOnce, type TestRenderSetup } from "../../helpers/tui";

describe("StatusBar", () => {
  let testSetup: TestRenderSetup | null = null;

  afterEach(async () => {
    await destroyTestRender(testSetup);
    testSetup = null;
  });

  async function renderFrame(
    props: Partial<Parameters<typeof StatusBar>[0]> = {}
  ): Promise<string> {
    const defaultProps: Parameters<typeof StatusBar>[0] = {
      hasSession: true,
      canFixPendingSession: false,
      focusedPane: "detail",
      outputVisible: false,
      stopPickerOpen: false,
      liveRefreshError: null,
      configWarning: null,
    };

    testSetup = await renderOnce(createElement(StatusBar, { ...defaultProps, ...props }), {
      width: 120,
      height: 4,
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

  test("shows the fix shortcut only when findings are pending", async () => {
    const withFix = await renderFrame({ canFixPendingSession: true });
    expect(withFix).toContain("[f]");
    expect(withFix).toContain("Fix");

    const withoutFix = await renderFrame({ canFixPendingSession: false });
    expect(withoutFix).not.toContain("[f]");
    expect(withoutFix).not.toContain("Fix");
  });

  test("shows a live refresh warning when available", async () => {
    const frame = await renderFrame({ liveRefreshError: "tmux unavailable" });

    expect(frame).toContain("Live warning: tmux unavailable");
  });

  test("shows a config warning when available", async () => {
    const frame = await renderFrame({ configWarning: "Unable to load config: missing config" });

    expect(frame).toContain("Config warning: Unable to load config: missing");
  });
});
