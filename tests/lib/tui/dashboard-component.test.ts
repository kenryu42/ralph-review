import { describe, expect, test } from "bun:test";
import { KeyEvent } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { testRender } from "@opentui/react/test-utils";
import { act, createElement } from "react";
import { CLI_PATH } from "@/lib/paths";
import type { StoredFinding } from "@/lib/review-workflow/findings/types";
import type { ActiveSession } from "@/lib/session-state";
import { DashboardOverlays } from "@/lib/tui/dashboard/DashboardOverlays";
import { createInitialWorkspaceState } from "@/lib/tui/workspace/use-workspace-state";
import type { WorkspaceState } from "@/lib/tui/workspace/workspace-types";
import type { Config } from "@/lib/types";
import { createConfig } from "../../helpers/diagnostics";
import { createActiveSession } from "../../helpers/tui";

const actualWorkspaceState = await import("@/lib/tui/workspace/use-workspace-state");

interface SpawnResult {
  exitCode: number;
  stderr?: string;
  stdout?: string;
}

interface DashboardHarnessOptions {
  workspaceState?: Partial<WorkspaceState>;
  config?: Config | null;
  spawnResult?: SpawnResult;
}

function createStoredFinding(id: `F${string}`, priority: StoredFinding["priority"] = "P0") {
  return {
    id,
    fingerprint: `fp-${id}`,
    title: `Finding ${id}`,
    body: `Body for ${id}`,
    priority,
    confidenceScore: 0.97,
    filePath: "src/config.ts",
    startLine: 10,
    endLine: 12,
  } satisfies StoredFinding;
}

function createLastSessionStats(
  overrides: Partial<NonNullable<WorkspaceState["lastSessionStats"]>> = {}
): NonNullable<WorkspaceState["lastSessionStats"]> {
  return {
    sessionId: "session-123",
    reviewOutcome: "findings-pending",
    sessionPath: "/tmp/logs/session-123.jsonl",
    sessionName: "session-123.jsonl",
    timestamp: Date.now(),
    status: "completed",
    totalFixes: 0,
    totalSkipped: 0,
    priorityCounts: { P0: 1, P1: 0, P2: 0, P3: 0 },
    iterations: 2,
    entries: [
      {
        type: "system",
        timestamp: Date.now(),
        projectPath: "/repo/project",
        reviewer: { agent: "claude" },
        fixer: { agent: "codex" },
        maxIterations: 5,
      },
    ],
    reviewer: "claude",
    reviewerModel: "sonnet-4",
    reviewerDisplayName: "claude",
    reviewerModelDisplayName: "sonnet-4",
    fixer: "codex",
    fixerModel: "gpt-5.3-codex",
    fixerDisplayName: "codex",
    fixerModelDisplayName: "gpt-5.3-codex",
    ...overrides,
  };
}

function createTextStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

const FakeDashboardOverlays: typeof DashboardOverlays = (props) => {
  useKeyboard((key) => {
    if (props.showRunOverlay && (key.name === "enter" || key.name === "return")) {
      props.onSubmitRunOverlay(["--uncommitted"]);
    }

    if (props.showFixFindings && (key.name === "enter" || key.name === "return")) {
      const args =
        props.pendingFixTarget?.commandScope === "visible"
          ? [
              "fix",
              "--session",
              props.pendingFixTarget.sessionId,
              ...props.pendingFixTarget.findings.flatMap((finding) => ["--id", finding.id]),
            ]
          : ["fix", "--session", props.pendingFixTarget?.sessionId ?? "session-123", "--all"];
      props.onSubmitFixOverlay(args);
    }
  });

  return createElement(
    "box",
    { flexDirection: "column" },
    props.showHelp ? createElement("text", { key: "help" }, "help overlay") : null,
    props.showRunOverlay ? createElement("text", { key: "run" }, "review overlay") : null,
    props.showFixFindings ? createElement("text", { key: "fix" }, "fix overlay") : null,
    props.showSession ? createElement("text", { key: "session" }, "session overlay") : null,
    props.showStopPicker ? createElement("text", { key: "stop" }, "stop picker") : null
  );
};

async function mountDashboardHarness(options: DashboardHarnessOptions = {}) {
  const workspaceState = createInitialWorkspaceState({
    isLoading: false,
    config: options.config ?? createConfig(),
    ...options.workspaceState,
  });
  const stopCalls: ActiveSession[] = [];
  const spawnCalls: Array<{ cmd: string[]; cwd: string }> = [];

  const spawn = ((cmd: string[], spawnOptions?: { cwd?: string }) => {
    spawnCalls.push({
      cmd,
      cwd: spawnOptions?.cwd ?? "",
    });

    return {
      exited: Promise.resolve(options.spawnResult?.exitCode ?? 0),
      stdout: createTextStream(options.spawnResult?.stdout ?? ""),
      stderr: createTextStream(options.spawnResult?.stderr ?? ""),
    };
  }) as typeof Bun.spawn;

  const { Dashboard } = await import("@/lib/tui/dashboard/Dashboard");

  const testSetup = await testRender(
    createElement(Dashboard, {
      projectPath: "/repo/project",
      branch: "main",
      refreshInterval: 1_000,
      deps: {
        useWorkspaceState: () => workspaceState,
        DashboardOverlays: FakeDashboardOverlays,
        stopActiveSession: async (session: ActiveSession) => {
          stopCalls.push(session);
        },
        spawn,
      },
    }),
    {
      width: 120,
      height: 40,
    }
  );

  async function flush(cycles: number = 4) {
    for (let index = 0; index < cycles; index += 1) {
      await act(async () => {
        await Promise.resolve();
        await testSetup.renderOnce();
      });
    }
  }

  async function press(sequence: string, cycles: number = 2): Promise<string> {
    await act(async () => {
      const keyName =
        {
          "\u001B[A": "up",
          "\u001B[B": "down",
          "\u001B[C": "right",
          "\u001B[D": "left",
          "\u001B": "escape",
          "\t": "tab",
          "\r": "return",
          " ": "space",
        }[sequence] ?? sequence;

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
      await Promise.resolve();
      await testSetup.renderOnce();
    });
    await flush(cycles);
    return testSetup.captureCharFrame();
  }

  await flush();

  return {
    stopCalls,
    spawnCalls,
    press,
    destroy: async () => {
      await act(async () => {
        testSetup.renderer.destroy();
      });
    },
  };
}

async function withDashboardHarness(
  options: DashboardHarnessOptions,
  run: (harness: Awaited<ReturnType<typeof mountDashboardHarness>>) => Promise<void>
) {
  const harness = await mountDashboardHarness(options);
  try {
    await run(harness);
  } finally {
    await harness.destroy();
  }
}

async function expectFixOverlayForState(workspaceState: Partial<WorkspaceState>) {
  await withDashboardHarness({ workspaceState }, async (harness) => {
    const frame = await harness.press("f");
    expect(frame).toContain("fix overlay");
  });
}

describe("Dashboard component", () => {
  test("does not replace the workspace state module after mounting", async () => {
    const originalUseWorkspaceState = actualWorkspaceState.useWorkspaceState;

    await withDashboardHarness({}, async () => {});

    expect((await import("@/lib/tui/workspace/use-workspace-state")).useWorkspaceState).toBe(
      originalUseWorkspaceState
    );
  });

  test("renders the real help overlay through the default overlay wrapper", async () => {
    const testSetup = await testRender(
      createElement(DashboardOverlays, {
        showHelp: true,
        showRunOverlay: false,
        showFixFindings: false,
        showSession: false,
        showStopPicker: false,
        pendingFixTarget: null,
        canShowSession: true,
        projectPath: "/repo/project",
        sessions: [],
        onCloseHelp: () => {},
        onCloseRunOverlay: () => {},
        onSubmitRunOverlay: () => {},
        onCloseFixFindings: () => {},
        onSubmitFixOverlay: () => {},
        onCloseSession: () => {},
        onSelectStopSession: () => {},
        onCloseStopPicker: () => {},
      }),
      {
        width: 120,
        height: 40,
      }
    );

    try {
      await act(async () => {
        await testSetup.renderOnce();
      });

      expect(testSetup.captureCharFrame()).toContain("Keyboard Shortcuts");
    } finally {
      await act(async () => {
        testSetup.renderer.destroy();
      });
    }
  });

  test("opens review mode when idle and ignores the hotkey while a session is active", async () => {
    const idleHarness = await mountDashboardHarness();

    try {
      const idleFrame = await idleHarness.press("r");
      expect(idleFrame).toContain("review overlay");
    } finally {
      await idleHarness.destroy();
    }

    const runningSession = createActiveSession();
    const busyHarness = await mountDashboardHarness({
      workspaceState: {
        currentSession: runningSession,
        allSessions: [runningSession],
        projectSessions: [runningSession],
      },
    });

    try {
      const busyFrame = await busyHarness.press("r");
      expect(busyFrame).not.toContain("review overlay");
    } finally {
      await busyHarness.destroy();
    }
  });

  test("closes help first and delegates close keys to the session overlay", async () => {
    const harness = await mountDashboardHarness();

    try {
      const helpFrame = await harness.press("?");
      expect(helpFrame).toContain("help overlay");

      const closedHelpFrame = await harness.press("\u001B");
      expect(closedHelpFrame).not.toContain("help overlay");

      const sessionFrame = await harness.press("l");
      expect(sessionFrame).toContain("session overlay");

      const delegatedFrame = await harness.press("q");
      expect(delegatedFrame).toContain("session overlay");
    } finally {
      await harness.destroy();
    }
  });

  test("ignores workspace shortcuts while help is open", async () => {
    const harness = await mountDashboardHarness();

    try {
      const helpFrame = await harness.press("?");
      expect(helpFrame).toContain("help overlay");

      const gatedSessionFrame = await harness.press("l");
      expect(gatedSessionFrame).toContain("help overlay");
      expect(gatedSessionFrame).not.toContain("session overlay");
    } finally {
      await harness.destroy();
    }
  });

  test("stops the only active session immediately when s is pressed", async () => {
    const runningSession = createActiveSession();
    const harness = await mountDashboardHarness({
      workspaceState: {
        currentSession: runningSession,
        allSessions: [runningSession],
        projectSessions: [runningSession],
      },
    });

    try {
      const frame = await harness.press("s");
      expect(harness.stopCalls).toEqual([runningSession]);
      expect(frame).not.toContain("stop picker");
    } finally {
      await harness.destroy();
    }
  });

  test("opens the stop picker when multiple sessions are active", async () => {
    const firstSession = createActiveSession();
    const secondSession = createActiveSession({
      sessionId: "session-2",
      sessionName: "rr-project-feature",
      sessionStatePath: "/tmp/rr-project-feature.lock",
      sessionPath: "/tmp/logs/rr-project-feature.jsonl",
      worktreeBranch: "feature/test",
    });
    const harness = await mountDashboardHarness({
      workspaceState: {
        currentSession: firstSession,
        allSessions: [firstSession, secondSession],
        projectSessions: [firstSession, secondSession],
      },
    });

    try {
      const frame = await harness.press("s");
      expect(harness.stopCalls).toEqual([]);
      expect(frame).toContain("stop picker");
    } finally {
      await harness.destroy();
    }
  });

  test("surfaces run spawn failures as dashboard errors", async () => {
    const harness = await mountDashboardHarness({
      spawnResult: {
        exitCode: 1,
        stderr: "spawn failed",
      },
    });

    try {
      const overlayFrame = await harness.press("r");
      expect(overlayFrame).toContain("review overlay");

      const errorFrame = await harness.press("\r", 4);
      expect(harness.spawnCalls).toHaveLength(1);
      expect(errorFrame).toContain("Error: spawn failed");
    } finally {
      await harness.destroy();
    }
  });

  test("falls back to stdout when a failed spawn has no stderr output", async () => {
    const harness = await mountDashboardHarness({
      spawnResult: {
        exitCode: 1,
        stdout: "Findings artifact not found for session session-123",
      },
    });

    try {
      const overlayFrame = await harness.press("r");
      expect(overlayFrame).toContain("review overlay");

      const errorFrame = await harness.press("\r", 4);
      expect(errorFrame).toContain("Error: Findings artifact not found for session session-123");
    } finally {
      await harness.destroy();
    }
  });

  test("opens the dedicated fix overlay when pending findings are available", async () => {
    await expectFixOverlayForState({
      lastSessionStats: createLastSessionStats(),
      storedFindings: [createStoredFinding("F001")],
    });
  });

  test("opens the fix overlay for fixed-selected sessions with unselected findings", async () => {
    await withDashboardHarness(
      {
        workspaceState: {
          lastSessionStats: createLastSessionStats({ reviewOutcome: "fixed-selected" }),
          storedFindings: [createStoredFinding("F001"), createStoredFinding("F002", "P1")],
          unselectedFindings: [createStoredFinding("F002", "P1")],
        },
      },
      async (harness) => {
        const frame = await harness.press("f");
        expect(frame).toContain("fix overlay");
      }
    );
  });

  test("opens the fix overlay for incomplete sessions with unresolved selected findings", async () => {
    await withDashboardHarness(
      {
        workspaceState: {
          lastSessionStats: createLastSessionStats({ reviewOutcome: "incomplete" }),
          storedFindings: [createStoredFinding("F001"), createStoredFinding("F002", "P1")],
          unresolvedSelectedFindings: [createStoredFinding("F001")],
        },
      },
      async (harness) => {
        const frame = await harness.press("f");
        expect(frame).toContain("fix overlay");
      }
    );
  });

  test("submits remaining subset fixes with explicit id flags", async () => {
    const harness = await mountDashboardHarness({
      workspaceState: {
        lastSessionStats: createLastSessionStats({ reviewOutcome: "fixed-selected" }),
        storedFindings: [createStoredFinding("F001"), createStoredFinding("F002", "P1")],
        unselectedFindings: [createStoredFinding("F002", "P1")],
      },
    });

    try {
      const overlayFrame = await harness.press("f");
      expect(overlayFrame).toContain("fix overlay");

      await harness.press("\r", 4);

      expect(harness.spawnCalls).toEqual([
        {
          cmd: [process.execPath, CLI_PATH, "fix", "--session", "session-123", "--id", "F002"],
          cwd: "/repo/project",
        },
      ]);
    } finally {
      await harness.destroy();
    }
  });

  test("reopens the fix overlay after a failed session when findings are still available", async () => {
    await expectFixOverlayForState({
      lastSessionStats: createLastSessionStats({
        reviewOutcome: "incomplete",
        sessionStatus: "failed",
        status: "failed",
      }),
      storedFindings: [createStoredFinding("F001")],
    });
  });

  test("shows a fix startup banner while the fixer session is launching", async () => {
    const harness = await mountDashboardHarness({
      workspaceState: {
        lastSessionStats: createLastSessionStats(),
        storedFindings: [createStoredFinding("F001")],
      },
    });

    try {
      const overlayFrame = await harness.press("f");
      expect(overlayFrame).toContain("fix overlay");

      const startupFrame = await harness.press("\r", 4);
      expect(harness.spawnCalls).toEqual([
        {
          cmd: [process.execPath, CLI_PATH, "fix", "--session", "session-123", "--all"],
          cwd: "/repo/project",
        },
      ]);
      expect(startupFrame).toContain("Starting fix...");
    } finally {
      await harness.destroy();
    }
  });

  test("surfaces fix spawn failures as dashboard errors", async () => {
    const harness = await mountDashboardHarness({
      spawnResult: {
        exitCode: 1,
        stderr: "fix spawn failed",
      },
      workspaceState: {
        lastSessionStats: createLastSessionStats(),
        storedFindings: [createStoredFinding("F001")],
      },
    });

    try {
      const overlayFrame = await harness.press("f");
      expect(overlayFrame).toContain("fix overlay");

      const errorFrame = await harness.press("\r", 4);
      expect(errorFrame).toContain("Error: fix spawn failed");
    } finally {
      await harness.destroy();
    }
  });
});
