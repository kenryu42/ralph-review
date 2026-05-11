import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, createElement, type ReactNode } from "react";
import { StatusBar } from "@/lib/tui/dashboard/StatusBar";
import { SessionDetailPane } from "@/lib/tui/sessions/history/SessionListDetailPane";
import * as clipboard from "@/lib/tui/shared/clipboard";
import { SelectionCopyToastBoundary } from "@/lib/tui/shared/SelectionCopyToastBoundary";
import { createSessionStats, destroyTestRender, findTextLocation } from "../../helpers/tui";

describe("SelectionCopyToastBoundary", () => {
  let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

  afterEach(async () => {
    await destroyTestRender(testSetup);
    testSetup = null;
    mock.restore();
  });

  async function renderBoundary(
    child: ReactNode,
    options: { width?: number; height?: number } = {}
  ) {
    testSetup = await testRender(createElement(SelectionCopyToastBoundary, null, child), {
      width: options.width ?? 100,
      height: options.height ?? 30,
    });

    await act(async () => {
      await testSetup?.renderOnce();
    });

    return testSetup;
  }

  function renderHelloBoundary() {
    return renderBoundary(<text>Hello copied world</text>, {
      width: 40,
      height: 6,
    });
  }

  async function flushBoundaryEffects(
    setup: Awaited<ReturnType<typeof testRender>>
  ): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await setup.renderOnce();
    });
  }

  async function dragSelectVisibleText(
    setup: Awaited<ReturnType<typeof testRender>>,
    text: string
  ): Promise<void> {
    const frame = setup.captureCharFrame();
    const location = findTextLocation(frame, text);

    await act(async () => {
      await setup.mockMouse.drag(location.x, location.y, location.x + text.length, location.y);
      await setup.renderOnce();
    });

    await flushBoundaryEffects(setup);
  }

  test("copies the exact selected text, shows a success toast, and clears the selection", async () => {
    const copySpy = spyOn(clipboard, "copyToClipboard").mockResolvedValue();
    const setup = await renderHelloBoundary();

    await dragSelectVisibleText(setup, "Hello");

    expect(copySpy).toHaveBeenCalledWith("Hello");
    expect(setup.captureCharFrame()).toContain("Copied to clipboard");
    expect(setup.renderer.getSelection()).toBeNull();
  });

  test("ignores clicks that do not produce a text selection", async () => {
    const copySpy = spyOn(clipboard, "copyToClipboard").mockResolvedValue();
    const setup = await renderHelloBoundary();

    await act(async () => {
      await setup.mockMouse.click(20, 3);
      await setup.renderOnce();
    });

    await flushBoundaryEffects(setup);

    expect(copySpy).not.toHaveBeenCalled();
    expect(setup.captureCharFrame()).not.toContain("Copied to clipboard");
    expect(setup.captureCharFrame()).not.toContain("Failed to copy to clipboard");
  });

  test("shows an error toast and preserves the selection when clipboard copy fails", async () => {
    const copySpy = spyOn(clipboard, "copyToClipboard").mockRejectedValue(
      new Error("clipboard unavailable")
    );
    const setup = await renderHelloBoundary();

    await dragSelectVisibleText(setup, "Hello");

    expect(copySpy).toHaveBeenCalledWith("Hello");
    expect(setup.captureCharFrame()).toContain("Failed to copy to clipboard");
    expect(setup.renderer.getSelection()?.getSelectedText()).toBe("Hello");
  });

  test("copies text from a dashboard surface wrapped by the boundary", async () => {
    const copySpy = spyOn(clipboard, "copyToClipboard").mockResolvedValue();
    const setup = await renderBoundary(
      <StatusBar
        hasSession
        canFixPendingSession={false}
        focusedPane="detail"
        outputVisible={false}
        stopPickerOpen={false}
      />,
      {
        width: 120,
        height: 6,
      }
    );

    await dragSelectVisibleText(setup, "Quit");

    expect(copySpy).toHaveBeenCalledWith("Quit");
    expect(setup.captureCharFrame()).toContain("Copied to clipboard");
  });

  test("copies text from the session history detail pane when wrapped by the boundary", async () => {
    const copySpy = spyOn(clipboard, "copyToClipboard").mockResolvedValue();
    spyOn(globalThis, "setInterval").mockImplementation((() => 1) as unknown as typeof setInterval);
    const setup = await renderBoundary(<SessionDetailPane stats={createSessionStats()} />, {
      width: 100,
      height: 40,
    });

    await dragSelectVisibleText(setup, "Project:");

    expect(copySpy).toHaveBeenCalledWith("Project:");
    expect(setup.captureCharFrame()).toContain("Copied to clipboard");
  });
});
