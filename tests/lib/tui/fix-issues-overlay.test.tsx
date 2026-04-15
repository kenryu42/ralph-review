import { afterEach, describe, expect, test } from "bun:test";
import { KeyEvent } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, createElement } from "react";
import { CLI_PATH } from "@/lib/paths";
import type { StoredFinding } from "@/lib/review-workflow/findings/types";
import { buildWrappedFindingRow, FixIssuesOverlay } from "@/lib/tui/sessions/fix/FixIssuesOverlay";
import { PRIORITY_COLORS } from "@/lib/tui/sessions/session-display";

function createStderrStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

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

describe("FixIssuesOverlay", () => {
  let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;
  const originalSpawn = Bun.spawn;

  afterEach(async () => {
    if (testSetup) {
      await act(async () => {
        testSetup?.renderer.destroy();
      });
      testSetup = null;
    }

    Bun.spawn = originalSpawn;
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

  async function renderOverlay(
    options: {
      width?: number;
      height?: number;
      findings?: Parameters<typeof FixIssuesOverlay>[0]["findings"];
    } = {}
  ) {
    let closeCount = 0;

    testSetup = await testRender(
      createElement(FixIssuesOverlay, {
        sessionId: "session-123",
        projectPath: "/repo/project",
        findings: options.findings ?? defaultFindings,
        onClose: () => {
          closeCount += 1;
        },
      }),
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
        "\r": "return",
        " ": "space",
        "/": "/",
      };

      await act(async () => {
        const keyName = sequenceMap[sequence];
        if (keyName && testSetup) {
          testSetup.renderer.keyInput.emit(
            "keypress",
            new KeyEvent({
              name: keyName,
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
        } else {
          testSetup?.renderer.keyInput.processInput(sequence);
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
    };
  }

  test("renders the command preview line above the action message without overlap", async () => {
    const overlay = await renderOverlay({ width: 100, height: 28 });
    const frame = await overlay.press("\u001B[C");

    expect(frame).toContain("rr fix");
    expect(frame).toContain("Select at least one priority");

    const commandLine = findTextLocation(frame, "rr fix");
    const actionMessage = findTextLocation(frame, "Select at least one priority");

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

  test("renders the compact modal with stacked selection and details", async () => {
    const overlay = await renderOverlay({ width: 96, height: 24 });
    const frame = overlay.frame();
    const selection = findTextLocation(frame, "Selection");
    const details = findTextLocation(frame, "Details");

    expect(frame).toContain("Fix Issues");
    expect(frame).toContain("3 pending");
    expect(frame).toContain("[←/→]");
    expect(frame).toContain("Scope");
    expect(details.y).toBeGreaterThan(selection.y);
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

  test("spawns rr fix --all by default and closes on success", async () => {
    const spawnCalls: Array<{ cmd: string[]; cwd: string | undefined }> = [];
    Bun.spawn = ((cmd: string[], options?: { cwd?: string }) => {
      spawnCalls.push({ cmd, cwd: options?.cwd });
      return {
        exited: Promise.resolve(0),
        stderr: createStderrStream(""),
      };
    }) as typeof Bun.spawn;

    const overlay = await renderOverlay();
    const frame = await overlay.press("\r");

    expect(frame).toContain("Fix Issues");
    expect(spawnCalls).toEqual([
      {
        cmd: [process.execPath, CLI_PATH, "fix", "--session", "session-123", "--all"],
        cwd: "/repo/project",
      },
    ]);
    expect(overlay.getCloseCount()).toBe(1);
  });

  test("switches to priority mode, updates the summary, and spawns repeated priority flags", async () => {
    const spawnCalls: Array<{ cmd: string[]; cwd: string | undefined }> = [];
    Bun.spawn = ((cmd: string[], options?: { cwd?: string }) => {
      spawnCalls.push({ cmd, cwd: options?.cwd });
      return {
        exited: Promise.resolve(0),
        stderr: createStderrStream(""),
      };
    }) as typeof Bun.spawn;

    const overlay = await renderOverlay();
    let frame = await overlay.press("\u001B[C");
    expect(frame).toContain("Select at least one priority");
    expect(frame).toContain("Selected 0 of 3");

    frame = await overlay.press(" ");
    expect(frame).toContain("Selected 1 of 3");
    expect(frame).toContain("--priority P0");

    await overlay.press("\u001B[B");
    frame = await overlay.press(" ");
    expect(frame).toContain("Selected 2 of 3");
    expect(frame).toContain("--priority P1");
    await overlay.press("\r");

    expect(spawnCalls).toEqual([
      {
        cmd: [
          process.execPath,
          CLI_PATH,
          "fix",
          "--session",
          "session-123",
          "--priority",
          "P0",
          "--priority",
          "P1",
        ],
        cwd: "/repo/project",
      },
    ]);
  });

  test("shows verbose issue details with stripped titles in issues mode", async () => {
    const overlay = await renderOverlay();
    await overlay.press("\u001B[C");
    const frame = await overlay.press("\u001B[C");

    expect(frame).toContain("Filter issues");
    expect(frame).toContain("[P0]");
    expect(frame).toContain("Race condition in worker shutdown");
    expect(frame).toContain("Shut down the worker before disposing shared resources.");
    expect(frame).not.toContain("[P0] [P0] Race condition in worker shutdown");
  });

  test("renders wrapped issue rows without location text in the selection pane", async () => {
    const overlay = await renderOverlay({ width: 120, height: 28 });
    await overlay.press("\u001B[C");
    const frame = await overlay.press("\u001B[C");

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

    const prioritySegment = row.lines
      .flatMap((line) => line.segments)
      .find((segment) => segment.text === "[P0]");

    expect(prioritySegment?.color).toBe(PRIORITY_COLORS.P0);
  });

  test("spawns rr fix with repeated id flags", async () => {
    const spawnCalls: Array<{ cmd: string[]; cwd: string | undefined }> = [];
    Bun.spawn = ((cmd: string[], options?: { cwd?: string }) => {
      spawnCalls.push({ cmd, cwd: options?.cwd });
      return {
        exited: Promise.resolve(0),
        stderr: createStderrStream(""),
      };
    }) as typeof Bun.spawn;

    const overlay = await renderOverlay();
    await overlay.press("\u001B[C");
    await overlay.press("\u001B[C");
    await overlay.press(" ");
    await overlay.press("\u001B[B");
    await overlay.press(" ");
    await overlay.press("\r");

    expect(spawnCalls).toEqual([
      {
        cmd: [
          process.execPath,
          CLI_PATH,
          "fix",
          "--session",
          "session-123",
          "--id",
          "F001",
          "--id",
          "F002",
        ],
        cwd: "/repo/project",
      },
    ]);
  });

  test("preserves hidden id selections across filtering and runs them after returning to the list", async () => {
    const spawnCalls: Array<{ cmd: string[]; cwd: string | undefined }> = [];
    Bun.spawn = ((cmd: string[], options?: { cwd?: string }) => {
      spawnCalls.push({ cmd, cwd: options?.cwd });
      return {
        exited: Promise.resolve(0),
        stderr: createStderrStream(""),
      };
    }) as typeof Bun.spawn;

    const overlay = await renderOverlay();
    await overlay.press("\u001B[C");
    await overlay.press("\u001B[C");
    await overlay.press(" ");

    let frame = await overlay.press("/");
    expect(frame).toContain("Filter issues");

    frame = await overlay.typeText("F002");
    expect(frame).toContain("F002");
    expect(frame).not.toContain("Race condition in worker shutdown");
    expect(frame).toContain("Selected 1 of 3");

    frame = await overlay.press("\r");
    expect(spawnCalls).toEqual([]);
    expect(frame).toContain("Selected 1 of 3");

    frame = await overlay.press("\r");
    expect(frame).toContain("Selected 1 of 3");
    expect(spawnCalls).toEqual([
      {
        cmd: [process.execPath, CLI_PATH, "fix", "--session", "session-123", "--id", "F001"],
        cwd: "/repo/project",
      },
    ]);
  });

  test("escape from filter focus returns to the list before closing the overlay", async () => {
    const overlay = await renderOverlay();
    await overlay.press("\u001B[C");
    await overlay.press("\u001B[C");

    let frame = await overlay.press("/");
    expect(frame).toContain("Filter issues");

    frame = await overlay.typeText("F002");
    expect(frame).toContain("F002");

    frame = await overlay.press("\u001B");
    expect(overlay.getCloseCount()).toBe(0);
    expect(frame).toContain("Selected 0 of 3");

    await overlay.press("\u001B");
    expect(overlay.getCloseCount()).toBe(1);
  });
});
