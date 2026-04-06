import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, createElement, type ReactNode } from "react";
import * as clipboard from "@/lib/tui/clipboard";
import { SelectionCopyToastBoundary } from "@/lib/tui/components/SelectionCopyToastBoundary";
import { SessionDetailPane } from "@/lib/tui/components/SessionListDetailPane";
import { StatusBar } from "@/lib/tui/components/StatusBar";
import type { SessionStats } from "@/lib/types";

function buildSessionStats(overrides: Partial<SessionStats> = {}): SessionStats {
  return {
    sessionPath: "/tmp/logs/test-session.jsonl",
    sessionName: "rr-test-abc",
    timestamp: Date.now(),
    status: "completed",
    totalFixes: 2,
    totalSkipped: 1,
    priorityCounts: { P0: 0, P1: 1, P2: 1, P3: 0 },
    iterations: 2,
    totalDuration: 154000,
    entries: [],
    reviewer: "claude",
    reviewerModel: "sonnet-4",
    reviewerReasoning: "high",
    reviewerDisplayName: "claude",
    reviewerModelDisplayName: "sonnet-4",
    fixer: "claude",
    fixerModel: "sonnet-4",
    fixerReasoning: "medium",
    fixerDisplayName: "claude",
    fixerModelDisplayName: "sonnet-4",
    ...overrides,
  };
}

function findTextLocation(frame: string, text: string): { x: number; y: number } {
  const lines = frame.split("\n");
  for (const [y, line] of lines.entries()) {
    const x = line.indexOf(text);
    if (x >= 0) {
      return { x, y };
    }
  }

  throw new Error(`Could not find "${text}" in frame:\n${frame}`);
}

describe("SelectionCopyToastBoundary", () => {
  let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

  afterEach(async () => {
    if (testSetup) {
      await act(async () => {
        testSetup?.renderer.destroy();
      });
      testSetup = null;
    }
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
    const setup = await renderBoundary(<text>Hello copied world</text>, {
      width: 40,
      height: 6,
    });

    await dragSelectVisibleText(setup, "Hello");

    expect(copySpy).toHaveBeenCalledWith("Hello");
    expect(setup.captureCharFrame()).toContain("Copied to clipboard");
    expect(setup.renderer.getSelection()).toBeNull();
  });

  test("ignores clicks that do not produce a text selection", async () => {
    const copySpy = spyOn(clipboard, "copyToClipboard").mockResolvedValue();
    const setup = await renderBoundary(<text>Hello copied world</text>, {
      width: 40,
      height: 6,
    });

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
    const setup = await renderBoundary(<text>Hello copied world</text>, {
      width: 40,
      height: 6,
    });

    await dragSelectVisibleText(setup, "Hello");

    expect(copySpy).toHaveBeenCalledWith("Hello");
    expect(setup.captureCharFrame()).toContain("Failed to copy to clipboard");
    expect(setup.renderer.getSelection()?.getSelectedText()).toBe("Hello");
  });

  test("copies text from a dashboard surface wrapped by the boundary", async () => {
    const copySpy = spyOn(clipboard, "copyToClipboard").mockResolvedValue();
    const setup = await renderBoundary(
      <StatusBar hasSession focusedPane="detail" outputVisible={false} stopPickerOpen={false} />,
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
    const setup = await renderBoundary(<SessionDetailPane stats={buildSessionStats()} />, {
      width: 100,
      height: 40,
    });

    await dragSelectVisibleText(setup, "Project:");

    expect(copySpy).toHaveBeenCalledWith("Project:");
    expect(setup.captureCharFrame()).toContain("Copied to clipboard");
  });
});
