import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { KeyEvent } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, createElement } from "react";
import type { LogSession } from "@/lib/logger";
import * as logger from "@/lib/logger";
import { SessionDetailPane } from "@/lib/tui/components/SessionListDetailPane";
import { SessionOverlay } from "@/lib/tui/components/SessionListOverlay";
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

  test("renders the Session pane title", async () => {
    const setup = await renderOverlay();
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Sessions");
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

  test("? toggles help overlay", async () => {
    const setup = await renderOverlay();

    // Help should not be visible initially
    let frame = setup.captureCharFrame();
    expect(frame).not.toContain("Keyboard Shortcuts");

    // Press ? to show help
    await pressKeyAndRender(setup, "?");

    frame = setup.captureCharFrame();
    expect(frame).toContain("Keyboard Shortcuts");
    expect(frame).toContain("Navigate sessions");
    expect(frame).toContain("Toggle help");
    expect(frame).toContain("Close session");

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
    stats: SessionStats
  ): Promise<Awaited<ReturnType<typeof testRender>>> {
    testSetup = await testRender(createElement(SessionDetailPane, { stats }), {
      width: 100,
      height: 40,
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

    const setup = await renderDetailPane(stats);
    const frame = setup.captureCharFrame();

    expect(frame).toContain("completed");
    expect(frame).toContain("2m 34s");
    expect(frame).toContain("main");
    expect(frame).toContain("rr-worktree-abc");
    expect(frame).toContain("claude");
    expect(frame).toContain("sonnet-4");
    expect(frame).toContain("clean");
    expect(frame).toContain("Applied to working tree");
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

  test("renders iteration decision and stop-iteration metadata", async () => {
    const iterEntry = buildIterationEntry({
      iteration: 1,
      fixes: {
        decision: "NO_CHANGES_NEEDED",
        stop_iteration: true,
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
    expect(frame).toContain("Stop iteration:");
    expect(frame).toContain("true");
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

  test("renders rollback in iteration", async () => {
    const iterEntry = buildIterationEntry({
      iteration: 1,
      rollback: {
        attempted: true,
        success: true,
      },
    });

    const stats = buildSessionStats({
      entries: [buildSystemEntry(), iterEntry],
    });

    const setup = await renderDetailPane(stats);
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Rollback");
    expect(frame).toContain("succeeded");
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
