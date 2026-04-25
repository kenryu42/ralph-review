import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { KeyEvent } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, createElement } from "react";
import type { StoredFinding } from "@/lib/review-workflow/findings/types";
import { buildWrappedFindingRow, FixIssuesOverlay } from "@/lib/tui/sessions/fix/FixIssuesOverlay";
import { PRIORITY_COLORS } from "@/lib/tui/sessions/session-display";
import * as clipboard from "@/lib/tui/shared/clipboard";
import { TUI_COLORS } from "@/lib/tui/shared/colors";
import { SelectionCopyToastBoundary } from "@/lib/tui/shared/SelectionCopyToastBoundary";

function createFinding(
  id: `F${string}`,
  priority: "P0" | "P1" | "P2" | "P3",
  overrides: Partial<Parameters<typeof FixIssuesOverlay>[0]["findings"][number]> = {}
) {
  return {
    id,
    fingerprint: `fp-${id}`,
    title: `[${priority}] Finding ${id}`,
    body: `Body for ${id}`,
    priority,
    confidenceScore: 0.91,
    filePath: `src/file-${id}.ts`,
    startLine: 10,
    endLine: 12,
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

function expectedFindingMarkdown(findings: StoredFinding[]): string {
  return findings
    .map((finding) => {
      const locationKey =
        finding.locationKey ?? `${finding.filePath}:${finding.startLine}:${finding.endLine}`;

      return [
        `## ${finding.title}`,
        "",
        `**locationKey:** \`${locationKey}\``,
        "",
        "**body:**",
        "",
        finding.body,
      ].join("\n");
    })
    .join("\n\n");
}

describe("FixIssuesOverlay", () => {
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

  const defaultFindings = [
    createFinding("F001", "P0", {
      title: "[P0] [P0] Race condition in worker shutdown",
      body: "Shut down the worker before disposing shared resources.",
      filePath: "src/core/worker.ts",
      startLine: 10,
      endLine: 18,
    }),
    createFinding("F002", "P1", {
      title: "[P1] Null guard missing in overlay state",
      body: "Guard the overlay state before reading the pending target.",
      filePath: "src/lib/tui/dashboard/dashboard-state.ts",
      startLine: 44,
      endLine: 52,
    }),
    createFinding("F003", "P2", {
      title: "[P2] Stale session summary in footer",
      body: "Refresh the footer summary when the active session changes.",
      filePath: "src/lib/tui/dashboard/StatusBar.tsx",
      startLine: 61,
      endLine: 67,
    }),
  ];

  function defaultFindingAt(index: number): StoredFinding {
    const finding = defaultFindings[index];
    if (!finding) {
      throw new Error(`expected default finding at index ${index}`);
    }

    return finding;
  }

  async function renderOverlay(
    options: {
      width?: number;
      height?: number;
      findings?: Parameters<typeof FixIssuesOverlay>[0]["findings"];
      commandScope?: Parameters<typeof FixIssuesOverlay>[0]["commandScope"];
    } = {}
  ) {
    let closeCount = 0;
    const submitCalls: string[][] = [];

    const findings = options.findings ?? defaultFindings;

    testSetup = await testRender(
      createElement(
        SelectionCopyToastBoundary,
        null,
        createElement(FixIssuesOverlay, {
          sessionId: "session-123",
          projectPath: "/repo/project",
          findings,
          commandScope: options.commandScope,
          onSubmit: (args) => {
            submitCalls.push(args);
          },
          onClose: () => {
            closeCount += 1;
          },
        })
      ),
      {
        width: options.width ?? 120,
        height: options.height ?? 36,
      }
    );

    await act(async () => {
      await testSetup?.renderOnce();
    });

    async function press(sequence: string): Promise<string> {
      const sequenceMap: Record<string, string> = {
        "\u001B[A": "up",
        "\u001B[B": "down",
        "\u001B[C": "right",
        "\u001B[D": "left",
        "\u001B": "escape",
        "\t": "tab",
        "\r": "return",
        " ": "space",
        "/": "/",
      };

      await act(async () => {
        if (testSetup) {
          testSetup.renderer.keyInput.emit(
            "keypress",
            new KeyEvent({
              name: sequenceMap[sequence] ?? sequence,
              sequence,
              ctrl: false,
              shift: false,
              meta: false,
              option: false,
              eventType: "press",
              repeated: false,
              source: "raw",
              number: false,
              raw: sequence,
            })
          );
        }
      });

      await act(async () => {
        await Promise.resolve();
        await testSetup?.renderOnce();
      });

      await act(async () => {
        await Promise.resolve();
        await testSetup?.renderOnce();
      });

      if (!testSetup) {
        throw new Error("expected rendered overlay");
      }

      return testSetup.captureCharFrame();
    }

    async function typeText(value: string): Promise<string> {
      await act(async () => {
        await testSetup?.mockInput.typeText(value);
      });

      await act(async () => {
        await Promise.resolve();
        await testSetup?.renderOnce();
      });

      await act(async () => {
        await Promise.resolve();
        await testSetup?.renderOnce();
      });

      if (!testSetup) {
        throw new Error("expected rendered overlay");
      }

      return testSetup.captureCharFrame();
    }

    return {
      frame: () => testSetup?.captureCharFrame() ?? "",
      press,
      typeText,
      getCloseCount: () => closeCount,
      getSubmitCalls: () => submitCalls,
    };
  }

  async function moveDown(
    overlay: Awaited<ReturnType<typeof renderOverlay>>,
    count: number
  ): Promise<string> {
    let frame = overlay.frame();
    for (let index = 0; index < count; index += 1) {
      frame = await overlay.press("j");
    }

    return frame;
  }

  test("renders the command preview line above the action message without overlap", async () => {
    const overlay = await renderOverlay({ width: 100, height: 28 });
    const frame = overlay.frame();

    expect(frame).toContain("rr fix --session session-123 --all");
    expect(frame).toContain("Press Enter to run the selected fix batch.");

    const commandLine = findTextLocation(frame, "rr fix");
    const actionMessage = findTextLocation(frame, "Press Enter to run");

    expect(actionMessage.y).toBeGreaterThan(commandLine.y);
  });

  test("renders the wide modal with selection and details side by side", async () => {
    const overlay = await renderOverlay({ width: 120, height: 36 });
    const frame = overlay.frame();
    const selection = findTextLocation(frame, "Selection");
    const details = findTextLocation(frame, "Details");

    expect(frame).toContain("Fix Issues");
    expect(frame).toContain("3 pending");
    expect(frame).toContain("Selected 3 of 3");
    expect(frame).toContain("rr fix --session session-123 --all");
    expect(selection.y).toBe(details.y);
    expect(details.x).toBeGreaterThan(selection.x + 10);
  });

  test("renders the filter section above quick action in the selection pane", async () => {
    const overlay = await renderOverlay({ width: 120, height: 36 });
    const frame = overlay.frame();
    const filterSection = findTextLocation(frame, "Issue filter");
    const filterRow = findTextLocation(frame, "Type / to search");
    const quickAction = findTextLocation(frame, "Quick action");

    expect(filterSection.y).toBeLessThan(quickAction.y);
    expect(filterRow.y).toBeGreaterThan(filterSection.y);
  });

  test("renders the compact modal with stacked selection and details", async () => {
    const overlay = await renderOverlay({ width: 96, height: 24 });
    const frame = overlay.frame();
    const selection = findTextLocation(frame, "Selection");
    const details = findTextLocation(frame, "Details");

    expect(frame).toContain("Fix Issues");
    expect(frame).toContain("3 pending");
    expect(frame).toContain("[Tab]");
    expect(frame).not.toContain("[←/→]");
    expect(details.y).toBeGreaterThan(selection.y);
  });

  test("renders copy findings in the footer without move or filter helper text", async () => {
    const overlay = await renderOverlay();
    const frame = overlay.frame();

    expect(frame).toContain("[C]");
    expect(frame).toContain("Copy findings");
    expect(frame).not.toContain("[↑/↓ j/k]");
    expect(frame).not.toContain("Move");
    expect(frame).not.toContain("[/]");
    expect(frame).not.toContain("Filter");
  });

  test("copies all selected findings as markdown by default", async () => {
    const copySpy = spyOn(clipboard, "copyToClipboard").mockResolvedValue();
    const overlay = await renderOverlay();
    const frame = await overlay.press("c");

    expect(copySpy).toHaveBeenCalledWith(expectedFindingMarkdown(defaultFindings));
    expect(frame).toContain("Copied findings to clipboard.");
  });

  test("copies only priority-selected findings as markdown", async () => {
    const copySpy = spyOn(clipboard, "copyToClipboard").mockResolvedValue();
    const overlay = await renderOverlay();

    await overlay.press("j");
    const frame = await overlay.press(" ");
    expect(frame).toContain("--priority P0");

    await overlay.press("c");

    expect(copySpy).toHaveBeenCalledWith(expectedFindingMarkdown([defaultFindingAt(0)]));
  });

  test("copies only id-selected findings as markdown", async () => {
    const copySpy = spyOn(clipboard, "copyToClipboard").mockResolvedValue();
    const overlay = await renderOverlay();

    await moveDown(overlay, 5);
    await overlay.press(" ");
    await overlay.press("j");
    await overlay.press(" ");
    await overlay.press("c");

    expect(copySpy).toHaveBeenCalledWith(
      expectedFindingMarkdown([defaultFindingAt(0), defaultFindingAt(1)])
    );
  });

  test("uses stored locationKey when copying findings", async () => {
    const copySpy = spyOn(clipboard, "copyToClipboard").mockResolvedValue();
    const finding = createFinding("F004", "P1", {
      locationKey: "src/from-artifact.ts:100:120",
      title: "Stored location key finding",
      body: "Copy the persisted location key.",
      filePath: "src/fallback.ts",
      startLine: 1,
      endLine: 2,
    });
    const overlay = await renderOverlay({ findings: [finding] });

    await overlay.press("c");

    expect(copySpy).toHaveBeenCalledWith(expectedFindingMarkdown([finding]));
  });

  test("cycles focus between selection and details with Tab", async () => {
    const overlay = await renderOverlay();
    let frame = overlay.frame();

    expect(frame).toContain("Focus: Selection");

    frame = await overlay.press("\t");
    expect(frame).toContain("Focus: Details");

    frame = await overlay.press("\t");
    expect(frame).toContain("Focus: Selection");
  });

  test("renders the empty state when there are no findings", async () => {
    const overlay = await renderOverlay({ findings: [] });
    const frame = overlay.frame();

    expect(frame).toContain("Fix Issues");
    expect(frame).toContain("No pending findings.");
    expect(frame).toContain("[Esc]");
    expect(frame).toContain("Close");

    await overlay.press("\u001B");
    expect(overlay.getCloseCount()).toBe(1);
  });

  test("shows batch copy with correct pluralization in all mode", async () => {
    const singleFinding = defaultFindings[0];
    if (!singleFinding) {
      throw new Error("expected at least one default finding");
    }

    const overlay = await renderOverlay({ findings: [singleFinding] });
    const frame = overlay.frame();

    expect(frame).toContain("1 finding");
    expect(frame).not.toContain("1 findings");
  });

  test("submits rr fix --all by default and closes immediately", async () => {
    const overlay = await renderOverlay();
    const frame = await overlay.press("\r");

    expect(frame).toContain("Fix Issues");
    expect(overlay.getSubmitCalls()).toEqual([["fix", "--session", "session-123", "--all"]]);
    expect(overlay.getCloseCount()).toBe(1);
  });

  test("submits visible findings as repeated id flags in all mode", async () => {
    const overlay = await renderOverlay({ commandScope: "visible" });
    const frame = overlay.frame();

    expect(frame).toContain("rr fix --session session-123 --id F001 --id F002 --id F003");
    expect(frame).not.toContain("passed together via --all");

    await overlay.press("\r");

    expect(overlay.getSubmitCalls()).toEqual([
      ["fix", "--session", "session-123", "--id", "F001", "--id", "F002", "--id", "F003"],
    ]);
  });

  test("selects priorities and submits a csv --priority flag", async () => {
    const overlay = await renderOverlay();
    let frame = overlay.frame();
    expect(frame).toContain("Selected 3 of 3");
    expect(frame).toContain("rr fix --session session-123 --all");

    await overlay.press("j");
    frame = await overlay.press(" ");
    expect(frame).toContain("Selected 1 of 3");
    expect(frame).toContain("--priority P0");
    expect(frame).not.toContain("--all");

    await overlay.press("j");
    frame = await overlay.press(" ");
    expect(frame).toContain("Selected 2 of 3");
    expect(frame).toContain("--priority P0,P1");
    await overlay.press("\r");

    expect(overlay.getSubmitCalls()).toEqual([
      ["fix", "--session", "session-123", "--priority", "P0,P1"],
    ]);
  });

  test("submits visible priority matches as repeated id flags", async () => {
    const overlay = await renderOverlay({ commandScope: "visible" });

    await overlay.press("j");
    let frame = await overlay.press(" ");
    expect(frame).toContain("--id F001");
    expect(frame).not.toContain("--priority P0");

    await overlay.press("j");
    frame = await overlay.press(" ");
    expect(frame).toContain("--id F001 --id F002");
    await overlay.press("\r");

    expect(overlay.getSubmitCalls()).toEqual([
      ["fix", "--session", "session-123", "--id", "F001", "--id", "F002"],
    ]);
  });

  test("toggling a priority clears the all selection", async () => {
    const overlay = await renderOverlay();
    let frame = overlay.frame();
    expect(frame).toContain("[x] Fix all pending");

    await overlay.press("j");
    frame = await overlay.press(" ");

    expect(frame).toContain("[ ] Fix all pending");
    expect(frame).toContain("--priority P0");
    expect(frame).not.toContain("--all");
  });

  test("toggling an issue clears priority selections", async () => {
    const overlay = await renderOverlay();
    await overlay.press("j");
    await overlay.press(" ");
    let frame = overlay.frame();
    expect(frame).toContain("--priority P0");

    frame = await moveDown(overlay, 4);
    frame = await overlay.press(" ");

    expect(frame).toContain("--id F001");
    expect(frame).not.toContain("--priority");
  });

  test("supports j/k navigation across priorities", async () => {
    const overlay = await renderOverlay();
    await overlay.press("j");
    await overlay.press("j");
    await overlay.press(" ");
    await overlay.press("k");
    await overlay.press(" ");
    await overlay.press("\r");

    expect(overlay.getSubmitCalls()).toEqual([
      ["fix", "--session", "session-123", "--priority", "P0,P1"],
    ]);
  });

  test("shows verbose issue details when the cursor sits on an issue row", async () => {
    const overlay = await renderOverlay();
    const frame = await moveDown(overlay, 5);

    expect(frame).toContain("[P0]");
    expect(frame).toContain("Race condition in worker shutdown");
    expect(frame).toContain("Confidence");
    expect(frame).toContain("91%");
    expect(frame.indexOf("Race condition in worker shutdown")).toBeLessThan(
      frame.indexOf("Confidence")
    );
    expect(frame.indexOf("Confidence")).toBeLessThan(
      frame.indexOf("Shut down the worker before disposing shared resources.")
    );
    expect(frame).toContain("Shut down the worker before disposing shared resources.");
    expect(frame).not.toContain("[P0] [P0] Race condition in worker shutdown");
  });

  test("renders wrapped issue rows without location text in the selection pane", async () => {
    const overlay = await renderOverlay({ width: 120, height: 28 });
    const frame = await moveDown(overlay, 5);

    expect(frame).toContain("Race condition in");
    expect(frame).toContain("worker shutdown");
    expect(frame).toContain("Null guard missing");
    expect(frame).toContain("overlay state");
    expect(frame).toContain("Stale session");
    expect(frame).not.toContain("src/core/worker.ts:10-18");
  });

  test("builds wrapped issue rows with a priority-colored token", () => {
    const finding = createFinding("F001", "P0", {
      title: "[P0] [P0] Race condition in worker shutdown",
    }) as StoredFinding;

    const row = buildWrappedFindingRow(finding, {
      isSelected: false,
      contentWidth: 32,
    });

    const prioritySegments = row.lines[0]?.segments.slice(1, 4);

    expect(prioritySegments).toEqual([
      { text: "[", color: TUI_COLORS.text.dim },
      { text: "P0", color: PRIORITY_COLORS.P0 },
      { text: "]", color: TUI_COLORS.text.dim },
    ]);
  });

  test("submits rr fix with repeated id flags", async () => {
    const overlay = await renderOverlay();
    await moveDown(overlay, 5);
    await overlay.press(" ");
    await overlay.press("j");
    await overlay.press(" ");
    await overlay.press("\r");

    expect(overlay.getSubmitCalls()).toEqual([
      ["fix", "--session", "session-123", "--id", "F001", "--id", "F002"],
    ]);
  });

  test("submits rr fix with a csv priority flag", async () => {
    const overlay = await renderOverlay();

    await overlay.press("j");
    await overlay.press(" ");
    await overlay.press("j");
    await overlay.press(" ");
    await overlay.press("\r");

    expect(overlay.getSubmitCalls()).toEqual([
      ["fix", "--session", "session-123", "--priority", "P0,P1"],
    ]);
  });

  test("section headers are skipped during navigation", async () => {
    const overlay = await renderOverlay();
    await overlay.press("j");
    let frame = await overlay.press(" ");
    expect(frame).toContain("--priority P0");

    await overlay.press("j");
    await overlay.press("j");
    await overlay.press("j");
    await overlay.press("j");
    frame = await overlay.press(" ");

    expect(frame).toContain("--id F001");
    expect(frame).not.toContain("--priority");
  });

  test("slash jumps focus to the filter input from any list row", async () => {
    const overlay = await renderOverlay();
    await overlay.press("j");
    let frame = await overlay.press(" ");
    expect(frame).toContain("--priority P0");

    frame = await overlay.press("/");
    expect(frame).toContain("Filter the issue list");

    frame = await overlay.typeText("F002");
    expect(frame).toContain("F002");
    expect(frame).not.toContain("Race condition in worker shutdown");
  });

  test("typing j, k, and space in the filter does not change the current selection", async () => {
    const overlay = await renderOverlay();
    await overlay.press("j");
    let frame = await overlay.press(" ");
    expect(frame).toContain("--priority P0");
    expect(frame).toContain("Selected 1 of 3");

    frame = await overlay.press("/");
    expect(frame).toContain("Filter the issue list");

    frame = await overlay.typeText("j k ");
    expect(frame).toContain("j k ");
    expect(frame).toContain("--priority P0");
    expect(frame).toContain("Selected 1 of 3");
  });

  test("up and down stay in the filter instead of returning focus to the selection list", async () => {
    const overlay = await renderOverlay();
    let frame = await overlay.press("/");
    expect(frame).toContain("Filter the issue list");

    frame = await overlay.press("\u001B[B");
    expect(frame).toContain("Filter the issue list");

    frame = await overlay.press("\u001B[A");
    expect(frame).toContain("Filter the issue list");

    frame = await overlay.typeText("F002");
    expect(frame).toContain("F002");
    expect(frame).not.toContain("Race condition in worker shutdown");
  });

  test("filter focus clears the active row highlight until list focus returns", async () => {
    const overlay = await renderOverlay();
    let frame = await moveDown(overlay, 5);
    expect(frame).toContain("▶ [ ] F001");

    frame = await overlay.press("/");
    expect(frame).toContain("Filter the issue list");
    expect(frame).not.toContain("▶ [ ] F001");

    frame = await overlay.press("\u001B");
    expect(frame).toContain("▶ [ ] F001");
  });

  test("returns list focus to the first visible issue when filtering hides the active row", async () => {
    const overlay = await renderOverlay();
    let frame = await moveDown(overlay, 7);
    expect(frame).toContain("▶ [ ] F003");

    frame = await overlay.press("/");
    expect(frame).toContain("Filter the issue list");

    frame = await overlay.typeText("F001");
    expect(frame).toContain("F001");
    expect(frame).not.toContain("F003");

    frame = await overlay.press("\u001B");
    expect(frame).toContain("▶ [ ] F001");
    expect(frame).not.toContain("▶ [ ] F003");
  });

  test("returns from the filter to a visible issue row that can be toggled immediately", async () => {
    const overlay = await renderOverlay();
    await moveDown(overlay, 7);
    await overlay.press("/");
    await overlay.typeText("F001");

    let frame = await overlay.press("\u001B");
    expect(frame).toContain("▶ [ ] F001");

    frame = await overlay.press(" ");
    expect(frame).toContain("--id F001");

    await overlay.press("\r");
    expect(overlay.getSubmitCalls()).toEqual([["fix", "--session", "session-123", "--id", "F001"]]);
  });

  test("scrolls long details content when details pane is focused", async () => {
    const longBody = Array.from({ length: 40 }, (_, index) => `body line ${index + 1}`).join("\n");
    const longFinding = createFinding("F001", "P0", {
      body: longBody,
      title: "[P0] Long body scroll validation",
    });
    const overlay = await renderOverlay({
      findings: [longFinding],
      width: 120,
      height: 32,
    });
    let frame = await moveDown(overlay, 5);

    expect(frame).toContain("body line 1");
    expect(frame).not.toContain("body line 35");

    frame = await overlay.press("\t");
    expect(frame).toContain("Focus: Details");

    for (let index = 0; index < 40; index += 1) {
      frame = await overlay.press("\u001B[B");
    }

    expect(frame).toContain("body line 40");
  });

  test("preserves hidden id selections across filtering and submits them after returning to the list", async () => {
    const overlay = await renderOverlay();
    await moveDown(overlay, 5);
    await overlay.press(" ");

    let frame = await overlay.press("/");
    expect(frame).toContain("Filter the issue list");

    frame = await overlay.typeText("F002");
    expect(frame).toContain("F002");
    expect(frame).not.toContain("Race condition in worker shutdown");
    expect(frame).toContain("Selected 1 of 3");

    frame = await overlay.press("\r");
    expect(overlay.getSubmitCalls()).toEqual([]);
    expect(frame).toContain("Selected 1 of 3");

    frame = await overlay.press("\r");
    expect(frame).toContain("Selected 1 of 3");
    expect(overlay.getSubmitCalls()).toEqual([["fix", "--session", "session-123", "--id", "F001"]]);
  });

  test("escape from filter focus returns to the list before closing the overlay", async () => {
    const overlay = await renderOverlay();
    await overlay.press("/");
    let frame = overlay.frame();
    expect(frame).toContain("Filter the issue list");

    frame = await overlay.typeText("F002");
    expect(frame).toContain("F002");

    frame = await overlay.press("\u001B");
    expect(overlay.getCloseCount()).toBe(0);

    await overlay.press("\u001B");
    expect(overlay.getCloseCount()).toBe(1);
  });
});
