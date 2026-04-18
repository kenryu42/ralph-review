import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { KeyEvent } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, createElement } from "react";
import type { LogSession } from "@/lib/logger";
import * as logger from "@/lib/logger";
import type { ActiveSession } from "@/lib/session-state";
import * as sessionState from "@/lib/session-state";
import { SessionDetailPane } from "@/lib/tui/sessions/history/SessionListDetailPane";
import { SessionOverlay } from "@/lib/tui/sessions/history/SessionListOverlay";
import type { IterationEntry, SessionEndEntry, SessionStats, SystemEntry } from "@/lib/types";
import { buildFixEntry, buildSkippedEntry } from "../../test-utils/fix-summary";

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

function buildSystemEntry(overrides: Partial<SystemEntry> = {}): SystemEntry {
  return {
    type: "system",
    timestamp: Date.now(),
    projectPath: "/test/project",
    reviewer: { agent: "claude", model: "sonnet-4" },
    fixer: { agent: "claude", model: "sonnet-4" },
    maxIterations: 3,
    ...overrides,
  };
}

function buildIterationEntry(overrides: Partial<IterationEntry> = {}): IterationEntry {
  return {
    type: "iteration",
    timestamp: Date.now(),
    iteration: 1,
    duration: 45000,
    ...overrides,
  };
}

function buildSessionEndEntry(overrides: Partial<SessionEndEntry> = {}): SessionEndEntry {
  return {
    type: "session_end",
    timestamp: Date.now(),
    status: "completed",
    reason: "All issues resolved",
    iterations: 2,
    ...overrides,
  };
}

function buildLogSession(overrides: Partial<LogSession> = {}): LogSession {
  return {
    path: "/tmp/logs/2026-04-10_main.jsonl",
    name: "2026-04-10_main.jsonl",
    projectName: "project-12345678",
    timestamp: Date.now(),
    ...overrides,
  };
}

function buildActiveSession(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    schemaVersion: 2,
    sessionId: "session-1",
    sessionName: "rr-project-main",
    startTime: 1,
    lastHeartbeat: 1,
    pid: 123,
    projectPath: "/repo/project",
    branch: "main",
    state: "running",
    mode: "background",
    sessionStatePath: "/tmp/session-1.json",
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });

  return {
    promise,
    resolve: (value: T) => {
      resolve?.(value);
    },
  };
}

describe("SessionOverlay", () => {
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

  async function renderOverlay(
    props: Partial<Parameters<typeof SessionOverlay>[0]> = {},
    options: {
      sessions?: Promise<LogSession[]>;
      stats?: Promise<SessionStats>;
    } = {}
  ): Promise<Awaited<ReturnType<typeof testRender>>> {
    const {
      sessions = new Promise<LogSession[]>(() => {}),
      stats = Promise.resolve(buildSessionStats()),
    } = options;

    spyOn(logger, "listLogSessions").mockImplementation(() => sessions);
    spyOn(logger, "computeSessionStats").mockImplementation(() => stats);

    const defaultProps: Parameters<typeof SessionOverlay>[0] = {
      onClose: () => {},
      ...props,
    };

    testSetup = await testRender(createElement(SessionOverlay, defaultProps), {
      width: 120,
      height: 30,
    });

    await act(async () => {
      await testSetup?.renderOnce();
    });

    return testSetup;
  }

  test("renders the Logs pane title", async () => {
    const setup = await renderOverlay();
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Logs");
  });

  test("shows loading state initially", async () => {
    const setup = await renderOverlay();
    const frame = setup.captureCharFrame();

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

  function emitKey(setup: Awaited<ReturnType<typeof testRender>>, name: string) {
    setup.renderer.keyInput.emit(
      "keypress",
      new KeyEvent({
        name,
        sequence: name,
        ctrl: false,
        shift: false,
        meta: false,
        option: false,
        eventType: "press",
        repeated: false,
        source: "raw",
        number: false,
        raw: name,
      })
    );
  }

  async function pressKeyAndRender(setup: Awaited<ReturnType<typeof testRender>>, name: string) {
    await act(async () => {
      emitKey(setup, name);
    });
    await act(async () => {
      await setup.renderOnce();
    });
  }

  async function settleOverlay(setup: Awaited<ReturnType<typeof testRender>>) {
    await act(async () => {
      await Promise.resolve();
      await setup.renderOnce();
      await Promise.resolve();
      await setup.renderOnce();
    });
  }

  test("? toggles help overlay", async () => {
    const setup = await renderOverlay();

    // Help should not be visible initially
    let frame = setup.captureCharFrame();
    expect(frame).not.toContain("Keyboard Shortcuts");

    // Press ? to show help
    await pressKeyAndRender(setup, "?");

    frame = setup.captureCharFrame();
    expect(frame).toContain("Keyboard Shortcuts");
    expect(frame).toContain("Switch pane focus");
    expect(frame).toContain("Navigate / Scroll");
    expect(frame).toContain("Delete selected log");
    expect(frame).toContain("Toggle help");
    expect(frame).not.toContain("Close logs view");

    // Press ? again to hide help
    await pressKeyAndRender(setup, "?");

    frame = setup.captureCharFrame();
    expect(frame).not.toContain("Keyboard Shortcuts");
  });

  test("Esc closes help first, not the overlay", async () => {
    let closeCount = 0;
    const setup = await renderOverlay({
      onClose: () => {
        closeCount += 1;
      },
    });

    // Open help
    await pressKeyAndRender(setup, "?");

    let frame = setup.captureCharFrame();
    expect(frame).toContain("Keyboard Shortcuts");

    // Press Esc — should close help, not overlay
    await pressKeyAndRender(setup, "escape");

    expect(closeCount).toBe(0);
    frame = setup.captureCharFrame();
    expect(frame).not.toContain("Keyboard Shortcuts");
  });

  test("status bar shows shortcuts and initial focus label", async () => {
    const setup = await renderOverlay();
    const frame = setup.captureCharFrame();

    expect(frame).toContain("[d] Delete");
    expect(frame).toContain("[h] Help");
    expect(frame).toContain("Focus: List");
  });

  test("Tab cycles focus between list and detail", async () => {
    const setup = await renderOverlay();

    let frame = setup.captureCharFrame();
    expect(frame).toContain("Focus: List");

    // Tab to detail
    await pressKeyAndRender(setup, "tab");
    frame = setup.captureCharFrame();
    expect(frame).toContain("Focus: Detail");

    // Tab back to list
    await pressKeyAndRender(setup, "tab");
    frame = setup.captureCharFrame();
    expect(frame).toContain("Focus: List");
  });

  test("Tab is ignored while help is showing", async () => {
    const setup = await renderOverlay();

    // Open help
    await pressKeyAndRender(setup, "?");
    let frame = setup.captureCharFrame();
    expect(frame).toContain("Keyboard Shortcuts");
    expect(frame).toContain("Focus: List");

    // Tab should not cycle focus while help is open
    await pressKeyAndRender(setup, "tab");
    frame = setup.captureCharFrame();
    expect(frame).toContain("Focus: List");
  });

  test("l is ignored while help is showing", async () => {
    let closeCount = 0;
    const setup = await renderOverlay({
      onClose: () => {
        closeCount += 1;
      },
    });

    // Open help
    await pressKeyAndRender(setup, "?");

    // Press l — should NOT close overlay
    await pressKeyAndRender(setup, "l");

    expect(closeCount).toBe(0);

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Keyboard Shortcuts");
  });

  test("d opens delete confirmation overlay", async () => {
    const session = buildLogSession({
      path: "/tmp/logs/session-a.jsonl",
      name: "session-a.jsonl",
    });
    const sessionsDeferred = createDeferred<LogSession[]>();
    const statsDeferred = createDeferred<SessionStats>();
    const setup = await renderOverlay(
      {},
      {
        sessions: sessionsDeferred.promise,
        stats: statsDeferred.promise,
      }
    );

    await act(async () => {
      sessionsDeferred.resolve([session]);
      statsDeferred.resolve(buildSessionStats({ sessionPath: session.path }));
      await setup.renderOnce();
      await Promise.resolve();
      await setup.renderOnce();
    });

    await pressKeyAndRender(setup, "d");

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Delete Session Log");
    expect(frame).toContain("This cannot be undone");
  });

  test("Esc closes delete confirmation first, not the overlay", async () => {
    let closeCount = 0;
    const session = buildLogSession({
      path: "/tmp/logs/session-a.jsonl",
      name: "session-a.jsonl",
    });
    const sessionsDeferred = createDeferred<LogSession[]>();
    const statsDeferred = createDeferred<SessionStats>();
    const setup = await renderOverlay(
      {
        onClose: () => {
          closeCount += 1;
        },
      },
      {
        sessions: sessionsDeferred.promise,
        stats: statsDeferred.promise,
      }
    );

    await act(async () => {
      sessionsDeferred.resolve([session]);
      statsDeferred.resolve(buildSessionStats({ sessionPath: session.path }));
      await setup.renderOnce();
      await Promise.resolve();
      await setup.renderOnce();
    });

    await pressKeyAndRender(setup, "d");
    await pressKeyAndRender(setup, "escape");

    expect(closeCount).toBe(0);
    const frame = setup.captureCharFrame();
    expect(frame).not.toContain("Delete Session Log");
  });

  test("n closes delete confirmation first, not the overlay", async () => {
    let closeCount = 0;
    const session = buildLogSession({
      path: "/tmp/logs/session-a.jsonl",
      name: "session-a.jsonl",
    });
    const sessionsDeferred = createDeferred<LogSession[]>();
    const statsDeferred = createDeferred<SessionStats>();
    const setup = await renderOverlay(
      {
        onClose: () => {
          closeCount += 1;
        },
      },
      {
        sessions: sessionsDeferred.promise,
        stats: statsDeferred.promise,
      }
    );

    await act(async () => {
      sessionsDeferred.resolve([session]);
      statsDeferred.resolve(buildSessionStats({ sessionPath: session.path }));
      await setup.renderOnce();
      await Promise.resolve();
      await setup.renderOnce();
    });

    await pressKeyAndRender(setup, "d");
    await pressKeyAndRender(setup, "n");

    expect(closeCount).toBe(0);
    const frame = setup.captureCharFrame();
    expect(frame).not.toContain("Delete Session Log");
  });

  test("y confirms deletion and removes the selected session", async () => {
    const first = buildLogSession({
      path: "/tmp/logs/session-a.jsonl",
      name: "session-a.jsonl",
      timestamp: 200,
    });
    const second = buildLogSession({
      path: "/tmp/logs/session-b.jsonl",
      name: "session-b.jsonl",
      timestamp: 100,
    });
    const deleteSpy = spyOn(logger, "deleteSessionFiles").mockResolvedValue();
    spyOn(sessionState, "listAllActiveSessions").mockResolvedValue([]);
    const sessionsDeferred = createDeferred<LogSession[]>();
    const statsDeferred = createDeferred<SessionStats>();

    const setup = await renderOverlay(
      {},
      {
        sessions: sessionsDeferred.promise,
        stats: statsDeferred.promise,
      }
    );

    await act(async () => {
      sessionsDeferred.resolve([first, second]);
      statsDeferred.resolve(buildSessionStats({ sessionPath: first.path }));
      await setup.renderOnce();
      await Promise.resolve();
      await setup.renderOnce();
    });

    await pressKeyAndRender(setup, "d");
    await pressKeyAndRender(setup, "y");
    await settleOverlay(setup);

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith(first.path);

    const frame = setup.captureCharFrame();
    expect(frame).toContain("session-b");
    expect(frame).not.toContain("Delete Session Log");
  });

  test("enter and return do not confirm deletion", async () => {
    const session = buildLogSession({
      path: "/tmp/logs/session-a.jsonl",
      name: "session-a.jsonl",
    });
    const deleteSpy = spyOn(logger, "deleteSessionFiles").mockResolvedValue();
    spyOn(sessionState, "listAllActiveSessions").mockResolvedValue([]);
    const sessionsDeferred = createDeferred<LogSession[]>();
    const statsDeferred = createDeferred<SessionStats>();

    const setup = await renderOverlay(
      {},
      {
        sessions: sessionsDeferred.promise,
        stats: statsDeferred.promise,
      }
    );

    await act(async () => {
      sessionsDeferred.resolve([session]);
      statsDeferred.resolve(buildSessionStats({ sessionPath: session.path }));
      await setup.renderOnce();
      await Promise.resolve();
      await setup.renderOnce();
    });

    await pressKeyAndRender(setup, "d");
    await pressKeyAndRender(setup, "enter");
    await pressKeyAndRender(setup, "return");
    await settleOverlay(setup);

    expect(deleteSpy).not.toHaveBeenCalled();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Delete Session Log");
  });

  test("blocks deleting an active session", async () => {
    const session = buildLogSession({
      path: "/tmp/logs/session-a.jsonl",
      name: "session-a.jsonl",
    });
    const deleteSpy = spyOn(logger, "deleteSessionFiles").mockResolvedValue();
    spyOn(sessionState, "listAllActiveSessions").mockResolvedValue([
      buildActiveSession({ sessionPath: session.path }),
    ]);
    const sessionsDeferred = createDeferred<LogSession[]>();
    const statsDeferred = createDeferred<SessionStats>();

    const setup = await renderOverlay(
      {},
      {
        sessions: sessionsDeferred.promise,
        stats: statsDeferred.promise,
      }
    );

    await act(async () => {
      sessionsDeferred.resolve([session]);
      statsDeferred.resolve(buildSessionStats({ sessionPath: session.path }));
      await setup.renderOnce();
      await Promise.resolve();
      await setup.renderOnce();
    });

    await pressKeyAndRender(setup, "d");
    await pressKeyAndRender(setup, "y");
    await settleOverlay(setup);

    expect(deleteSpy).not.toHaveBeenCalled();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Cannot delete a running session");
    expect(frame).toContain("Delete Session Log");
  });

  test("does not open fixing from the history session overlay", async () => {
    const session = buildLogSession({
      path: "/tmp/logs/session-a.jsonl",
      name: "session-a.jsonl",
    });
    const sessionsDeferred = createDeferred<LogSession[]>();
    const statsDeferred = createDeferred<SessionStats>();
    const setup = await renderOverlay(
      {},
      {
        sessions: sessionsDeferred.promise,
        stats: statsDeferred.promise,
      }
    );

    await act(async () => {
      sessionsDeferred.resolve([session]);
      statsDeferred.resolve(
        buildSessionStats({
          sessionId: "session-123",
          reviewOutcome: "findings-pending",
          entries: [
            buildSystemEntry({ projectPath: "/repo/project" }),
            {
              type: "discovery_iteration",
              timestamp: Date.now(),
              iteration: 1,
              phase: "discovery",
              sessionStatus: "completed",
              findings: [
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
              netNewFindingIds: ["F001"],
            },
          ],
        })
      );
      await setup.renderOnce();
      await Promise.resolve();
      await setup.renderOnce();
    });

    await pressKeyAndRender(setup, "f");
    const frame = setup.captureCharFrame();
    expect(frame).not.toContain("Fix Findings");
  });
});

describe("SessionDetailPane", () => {
  let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

  afterEach(async () => {
    if (testSetup) {
      await act(async () => {
        testSetup?.renderer.destroy();
      });
      testSetup = null;
    }
  });

  async function renderDetailPane(
    stats: SessionStats,
    props: Partial<Parameters<typeof SessionDetailPane>[0]> = {}
  ): Promise<Awaited<ReturnType<typeof testRender>>> {
    const renderHeight = props.height ?? 40;
    testSetup = await testRender(createElement(SessionDetailPane, { stats, ...props }), {
      width: 100,
      height: renderHeight,
    });

    await act(async () => {
      await testSetup?.renderOnce();
    });

    return testSetup;
  }

  test("renders header metadata", async () => {
    const stats = buildSessionStats({
      gitBranch: "main",
      worktreeBranch: "rr-worktree-abc",
      reviewOutcome: "clean",
      handoffStatus: "applied-auto",
      commitSha: "abc1234",
    });

    const setup = await renderDetailPane(stats, { height: 70 });
    const frame = setup.captureCharFrame();

    expect(frame).toContain("completed");
    expect(frame).toContain("2m 34s");
    expect(frame).toContain("main");
    expect(frame).toContain("rr-worktree-abc");
    expect(frame).toContain("claude");
    expect(frame).toContain("sonnet-4");
    expect(frame).toContain("clean");
    expect(frame).toContain("Applied to working tree");
    expect(frame).toContain("Overview");
    expect(frame).toContain("Run setup");
  });

  test("does not start detail-pane metric polling while unfocused", async () => {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const intervalCalls: number[] = [];

    globalThis.setInterval = ((_handler: Parameters<typeof setInterval>[0], timeout?: number) => {
      intervalCalls.push(Number(timeout ?? 0));
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval;
    globalThis.clearInterval = (() => undefined) as typeof clearInterval;

    try {
      const stats = buildSessionStats();
      await renderDetailPane(stats, { focused: false });
      expect(intervalCalls).toEqual([]);
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });

  test("starts detail-pane metric polling at 100ms while focused", async () => {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const intervalCalls: number[] = [];

    globalThis.setInterval = ((_handler: Parameters<typeof setInterval>[0], timeout?: number) => {
      intervalCalls.push(Number(timeout ?? 0));
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval;
    globalThis.clearInterval = (() => undefined) as typeof clearInterval;

    try {
      const stats = buildSessionStats();
      await renderDetailPane(stats, { focused: true });
      expect(intervalCalls).toContain(100);
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });

  test("shortens very long code locations for readability", async () => {
    const longPath = `${"/tmp/worktrees"}${"/deeply-nested".repeat(16)}/src/lib/profile.ts`;
    const fix = buildFixEntry({
      file: longPath,
      code_location: {
        absolute_file_path: longPath,
        line_range: { start: 12, end: 14 },
      },
    });

    const iterEntry = buildIterationEntry({
      iteration: 1,
      fixes: {
        decision: "APPLY_SELECTIVELY",
        fixes: [fix],
        skipped: [],
      },
    });

    const stats = buildSessionStats({
      entries: [buildSystemEntry(), iterEntry],
    });

    const setup = await renderDetailPane(stats);
    const frame = setup.captureCharFrame();

    expect(frame).toContain("...");
    expect(frame).toContain("profile.ts:12-14");
  });

  test("renders project name without hash suffix", async () => {
    const stats = buildSessionStats({
      sessionPath: "/tmp/.config/ralph-review/ralph-review-75433236/logs/session-a.jsonl",
    });

    const setup = await renderDetailPane(stats);
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Project:");
    expect(frame).toContain("ralph-review");
    expect(frame).not.toContain("ralph-review-75433236");
  });

  test("renders timestamp below the project metadata", async () => {
    const stats = buildSessionStats({
      timestamp: new Date(2026, 3, 10, 14, 54, 0).getTime(),
    });

    const setup = await renderDetailPane(stats);
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Project:");
    expect(frame).toContain("Timestamp:");
    expect(frame).toContain("2026-04-10 14:54");
    expect(frame.indexOf("Project:")).toBeLessThan(frame.indexOf("Timestamp:"));
  });

  test("renders issue summary and priority breakdown", async () => {
    const stats = buildSessionStats({
      totalFixes: 3,
      totalSkipped: 1,
      iterations: 2,
      priorityCounts: { P0: 0, P1: 1, P2: 2, P3: 0 },
    });

    const setup = await renderDetailPane(stats);
    const frame = setup.captureCharFrame();

    expect(frame).toContain("3 fixes, 1 skipped in 2 iterations");
    expect(frame).toContain("P0");
    expect(frame).toContain("P1");
    expect(frame).toContain("P2");
    expect(frame).toContain("P3");
  });

  test("renders the batch-first lifecycle and findings inventory", async () => {
    const stats = buildSessionStats({
      sessionId: "session-123",
      sessionStatus: "completed",
      phase: "complete",
      reviewOutcome: "incomplete",
      totalFindings: 2,
      totalSelectedFindings: 1,
      totalResolvedSelectedFindings: 0,
      totalUnresolvedSelectedFindings: 1,
      entries: [
        buildSystemEntry({ projectPath: "/test/project" }),
        {
          type: "discovery_iteration",
          timestamp: Date.now(),
          iteration: 1,
          phase: "discovery",
          sessionStatus: "running",
          findings: [
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
            {
              id: "F002",
              fingerprint: "fp-2",
              title: "Avoid stale cache",
              body: "Cache can be stale",
              priority: "P2",
              confidenceScore: 0.92,
              filePath: "src/cache.ts",
              startLine: 20,
              endLine: 22,
            },
          ],
          netNewFindingIds: ["F001", "F002"],
        },
        {
          type: "finding_selection",
          timestamp: Date.now(),
          selectionMode: "id",
          selectedFindingIds: ["F001"],
        },
        {
          type: "batch_fix",
          timestamp: Date.now(),
          selectedFindingIds: ["F001"],
          fixResults: [
            {
              findingId: "F001",
              status: "unresolved",
              summary: "Added a null guard",
            },
          ],
        },
        buildSessionEndEntry({
          phase: "complete",
          sessionStatus: "completed",
          reviewOutcome: "incomplete",
          reason: "Some selected findings remain unresolved after remediation.",
        }),
      ],
    });

    const setup = await renderDetailPane(stats);
    const frame = setup.captureCharFrame();

    expect(frame).toContain("incomplete");
    expect(frame).toContain("2 issues found");
    expect(frame).toContain("Selection");
    expect(frame).toContain("1 selected");
    expect(frame).toContain("0 resolved");
    expect(frame).toContain("1 unresolved");
    expect(frame).toContain("Guard missing config");
  });

  test("renders iteration timeline with findings and fixes", async () => {
    const fix = buildFixEntry({ title: "Missing null check", priority: "P1" });
    const skipped = buildSkippedEntry({
      title: "Complex refactor",
      reason: "Would require significant restructuring",
    });

    const iterEntry = buildIterationEntry({
      iteration: 1,
      duration: 45000,
      review: {
        findings: [
          {
            title: "Missing null check",
            body: "foo may be null",
            confidence_score: 0.9,
            priority: 1,
            code_location: {
              absolute_file_path: "src/lib/foo.ts",
              line_range: { start: 42, end: 48 },
            },
          },
        ],
        overall_correctness: "patch is correct",
        overall_explanation: "One issue found",
        overall_confidence_score: 0.9,
      },
      fixes: {
        decision: "APPLY_SELECTIVELY",
        fixes: [fix],
        skipped: [skipped],
      },
    });

    const stats = buildSessionStats({
      entries: [buildSystemEntry(), iterEntry, buildSessionEndEntry()],
    });

    const setup = await renderDetailPane(stats);
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Iteration 1");
    expect(frame).toContain("45s");
    expect(frame).toContain("Issues Found");
    expect(frame).toContain("Missing null check");
    expect(frame).toContain("src/lib/foo.ts");
    expect(frame).toContain("Decision:");
    expect(frame).toContain("APPLY_SELECTIVELY");
    expect(frame).toContain("Fixes Applied");
  });

  test("renders rich fix details with code location fallback and no ids", async () => {
    const fix = buildFixEntry({
      id: 42424242,
      title: "Guard profile access",
      priority: "P1",
      file: "",
      code_location: {
        absolute_file_path: "src/lib/profile.ts",
        line_range: { start: 12, end: 14 },
      },
      claim: "Null check is missing before profile.name access",
      evidence: "profile can be null in loadProfile()",
      fix: "Return early when profile is null",
    });
    const skipped = buildSkippedEntry({
      id: 31313131,
      title: "Complex rewrite",
      reason: "SKIP: out of scope for this session",
    });

    const iterEntry = buildIterationEntry({
      iteration: 1,
      fixes: {
        decision: "APPLY_SELECTIVELY",
        fixes: [fix],
        skipped: [skipped],
      },
    });

    const stats = buildSessionStats({
      entries: [buildSystemEntry(), iterEntry],
    });

    const setup = await renderDetailPane(stats);
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Fixes Applied");
    expect(frame).toContain("Guard profile access");
    expect(frame).toContain("src/lib/profile.ts:12-14");
    expect(frame).toContain("Claim:");
    expect(frame).toContain("Null check is missing before profile.name access");
    expect(frame).toContain("Evidence:");
    expect(frame).toContain("profile can be null in loadProfile()");
    expect(frame).toContain("Fix:");
    expect(frame).toContain("Return early when profile is null");
    expect(frame).not.toContain("42424242");
    expect(frame).not.toContain("31313131");
  });

  test("renders iteration decision without stop-iteration metadata", async () => {
    const iterEntry = buildIterationEntry({
      iteration: 1,
      fixes: {
        decision: "NO_CHANGES_NEEDED",
        fixes: [],
        skipped: [],
      },
    });

    const stats = buildSessionStats({
      entries: [buildSystemEntry(), iterEntry],
    });

    const setup = await renderDetailPane(stats);
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Decision:");
    expect(frame).toContain("NO_CHANGES_NEEDED");
    expect(frame).not.toContain("Stop iteration:");
  });

  test("renders empty iteration as no issues found", async () => {
    const iterEntry = buildIterationEntry({
      iteration: 1,
      review: {
        findings: [],
        overall_correctness: "patch is correct",
        overall_explanation: "Clean",
        overall_confidence_score: 1.0,
      },
    });

    const stats = buildSessionStats({
      entries: [buildSystemEntry(), iterEntry],
    });

    const setup = await renderDetailPane(stats);
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Iteration 1");
    expect(frame).toContain("No issues found");
  });

  test("renders session end section", async () => {
    const endEntry = buildSessionEndEntry({
      status: "completed",
      reason: "All issues resolved",
    });

    const stats = buildSessionStats({
      entries: [buildSystemEntry(), endEntry],
    });

    const setup = await renderDetailPane(stats);
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Result");
    expect(frame).toContain("completed");
    expect(frame).toContain("All issues resolved");
  });

  test("renders error in iteration", async () => {
    const iterEntry = buildIterationEntry({
      iteration: 1,
      error: {
        phase: "reviewer",
        message: "Agent process exited with code 1",
      },
    });

    const stats = buildSessionStats({
      entries: [buildSystemEntry(), iterEntry],
    });

    const setup = await renderDetailPane(stats);
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Error");
    expect(frame).toContain("Agent process exited with code 1");
  });

  test("renders reasoning levels", async () => {
    const stats = buildSessionStats({
      reviewerReasoning: "high",
      fixerReasoning: "medium",
    });

    const setup = await renderDetailPane(stats);
    const frame = setup.captureCharFrame();

    expect(frame).toContain("[high]");
    expect(frame).toContain("[medium]");
  });
});
