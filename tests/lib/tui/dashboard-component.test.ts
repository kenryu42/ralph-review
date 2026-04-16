import { afterEach, describe, expect, mock, test } from "bun:test";
import { useKeyboard } from "@opentui/react";
import { testRender } from "@opentui/react/test-utils";
import { act, createElement } from "react";
import { CLI_PATH } from "@/lib/paths";
import type { ActiveSession } from "@/lib/session-state";
import type { WorkspaceState } from "@/lib/tui/workspace/workspace-types";
import type { Config } from "@/lib/types";
import { createConfig } from "../../helpers/diagnostics";

interface SpawnResult {
  exitCode: number;
  stderr?: string;
}

interface DashboardHarnessOptions {
  workspaceState?: Partial<WorkspaceState>;
  config?: Config | null;
  spawnResult?: SpawnResult;
}

function createActiveSession(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    schemaVersion: 2,
    sessionId: "session-1",
    sessionName: "rr-project-main",
    startTime: Date.now() - 5_000,
    lastHeartbeat: Date.now(),
    pid: process.pid,
    projectPath: "/repo/project",
    branch: "main",
    state: "running",
    mode: "background",
    iteration: 1,
    currentAgent: "reviewer",
    sessionStatePath: "/tmp/rr-project-main.lock",
    sessionPath: "/tmp/logs/rr-project-main.jsonl",
    ...overrides,
  };
}

function createWorkspaceState(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  const next: WorkspaceState = {
    sessionGroups: [],
    allSessions: [],
    projectSessions: [],
    selectedSessionId: null,
    currentSession: null,
    logEntries: [],
    fixes: [],
    skipped: [],
    findings: [],
    storedFindings: [],
    selectedFindingIds: [],
    selectedFindings: [],
    fixResults: [],
    unresolvedSelectedFindings: [],
    auditRegressionFindings: [],
    iterationFixes: [],
    iterationSkipped: [],
    iterationFindings: [],
    latestReviewIteration: null,
    codexReviewText: null,
    tmuxOutput: "",
    elapsed: 0,
    maxIterations: 0,
    error: null,
    liveRefreshError: null,
    isLoading: false,
    lastSessionStats: null,
    projectStats: null,
    config: createConfig(),
    configWarning: null,
    isGitRepo: true,
    currentAgent: null,
    reviewOptions: undefined,
    outputVisible: false,
    ...overrides,
  };

  return {
    ...next,
    storedFindings: next.storedFindings ?? [],
    selectedFindingIds: next.selectedFindingIds ?? [],
    selectedFindings: next.selectedFindings ?? [],
    fixResults: next.fixResults ?? [],
    unresolvedSelectedFindings: next.unresolvedSelectedFindings ?? [],
    auditRegressionFindings: next.auditRegressionFindings ?? [],
  };
}

function createStderrStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

async function mountDashboardHarness(options: DashboardHarnessOptions = {}) {
  const workspaceState = createWorkspaceState({
    config: options.config ?? createConfig(),
    ...options.workspaceState,
  });
  const stopCalls: ActiveSession[] = [];
  const spawnCalls: Array<{ cmd: string[]; cwd: string }> = [];
  const originalSpawn = Bun.spawn;

  Bun.spawn = ((cmd: string[], spawnOptions?: { cwd?: string }) => {
    spawnCalls.push({
      cmd,
      cwd: spawnOptions?.cwd ?? "",
    });

    return {
      exited: Promise.resolve(options.spawnResult?.exitCode ?? 0),
      stderr: createStderrStream(options.spawnResult?.stderr ?? ""),
    };
  }) as typeof Bun.spawn;

  mock.module("@/lib/tui/workspace/use-workspace-state", () => ({
    useWorkspaceState: () => workspaceState,
  }));

  mock.module("@/lib/stop-session", () => ({
    stopActiveSession: async (session: ActiveSession) => {
      stopCalls.push(session);
    },
  }));

  mock.module("@/lib/tui/dashboard/DashboardOverlays", () => ({
    DashboardOverlays: ({
      showHelp,
      showRunOverlay,
      showFixFindings,
      showSession,
      showStopPicker,
      pendingFixTarget,
      onSubmitRunOverlay,
      onSubmitFixOverlay,
    }: {
      showHelp: boolean;
      showRunOverlay: boolean;
      showFixFindings: boolean;
      showSession: boolean;
      showStopPicker: boolean;
      pendingFixTarget: { sessionId: string } | null;
      onSubmitRunOverlay: (args: string[]) => void;
      onSubmitFixOverlay: (args: string[]) => void;
    }) => {
      useKeyboard((key) => {
        if (showRunOverlay && (key.name === "enter" || key.name === "return")) {
          onSubmitRunOverlay(["--uncommitted"]);
        }

        if (showFixFindings && (key.name === "enter" || key.name === "return")) {
          onSubmitFixOverlay([
            "fix",
            "--session",
            pendingFixTarget?.sessionId ?? "session-123",
            "--all",
          ]);
        }
      });

      return createElement(
        "box",
        { flexDirection: "column" },
        showHelp ? createElement("text", { key: "help" }, "help overlay") : null,
        showRunOverlay ? createElement("text", { key: "run" }, "review overlay") : null,
        showFixFindings ? createElement("text", { key: "fix" }, "fix overlay") : null,
        showSession ? createElement("text", { key: "session" }, "session overlay") : null,
        showStopPicker ? createElement("text", { key: "stop" }, "stop picker") : null
      );
    },
  }));

  const { Dashboard } = await import("@/lib/tui/dashboard/Dashboard");

  const testSetup = await testRender(
    createElement(Dashboard, {
      projectPath: "/repo/project",
      branch: "main",
      refreshInterval: 1_000,
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
      testSetup.renderer.keyInput.processInput(sequence);
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
      Bun.spawn = originalSpawn;
    },
  };
}

afterEach(() => {
  mock.restore();
});

describe("Dashboard component", () => {
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

  test("opens the dedicated fix overlay when pending findings are available", async () => {
    const harness = await mountDashboardHarness({
      workspaceState: {
        lastSessionStats: {
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
        } as NonNullable<WorkspaceState["lastSessionStats"]>,
        storedFindings: [
          {
            id: "F001",
            fingerprint: "fp-1",
            title: "Guard missing config",
            body: "Null check is missing",
            priority: "P0",
            confidenceScore: 0.97,
            filePath: "src/config.ts",
            startLine: 10,
            endLine: 12,
          },
        ],
      },
    });

    try {
      const frame = await harness.press("f");
      expect(frame).toContain("fix overlay");
    } finally {
      await harness.destroy();
    }
  });

  test("reopens the fix overlay after a failed session when findings are still available", async () => {
    const harness = await mountDashboardHarness({
      workspaceState: {
        lastSessionStats: {
          sessionId: "session-123",
          reviewOutcome: "incomplete",
          sessionStatus: "failed",
          sessionPath: "/tmp/logs/session-123.jsonl",
          sessionName: "session-123.jsonl",
          timestamp: Date.now(),
          status: "failed",
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
        } as NonNullable<WorkspaceState["lastSessionStats"]>,
        storedFindings: [
          {
            id: "F001",
            fingerprint: "fp-1",
            title: "Guard missing config",
            body: "Null check is missing",
            priority: "P0",
            confidenceScore: 0.97,
            filePath: "src/config.ts",
            startLine: 10,
            endLine: 12,
          },
        ],
      },
    });

    try {
      const frame = await harness.press("f");
      expect(frame).toContain("fix overlay");
    } finally {
      await harness.destroy();
    }
  });

  test("shows a fix startup banner while the fixer session is launching", async () => {
    const harness = await mountDashboardHarness({
      workspaceState: {
        lastSessionStats: {
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
        } as NonNullable<WorkspaceState["lastSessionStats"]>,
        storedFindings: [
          {
            id: "F001",
            fingerprint: "fp-1",
            title: "Guard missing config",
            body: "Null check is missing",
            priority: "P0",
            confidenceScore: 0.97,
            filePath: "src/config.ts",
            startLine: 10,
            endLine: 12,
          },
        ],
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
        lastSessionStats: {
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
        } as NonNullable<WorkspaceState["lastSessionStats"]>,
        storedFindings: [
          {
            id: "F001",
            fingerprint: "fp-1",
            title: "Guard missing config",
            body: "Null check is missing",
            priority: "P0",
            confidenceScore: 0.97,
            filePath: "src/config.ts",
            startLine: 10,
            endLine: 12,
          },
        ],
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
