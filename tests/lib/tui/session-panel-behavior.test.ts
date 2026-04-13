import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, createElement } from "react";
import type { SessionState } from "@/lib/session-state";
import { DetailPane } from "@/lib/tui/sessions/detail/DetailPane";
import { resolveIssuesFoundDisplay } from "@/lib/tui/sessions/issues-found-display";
import type { AgentRole, ReviewSummary } from "@/lib/types";

describe("SessionPanel behavior", () => {
  const finding = {
    title: "Fix race condition",
    body: "Race condition can hide updates in the panel.",
    confidence_score: 0.8,
    priority: 1,
    code_location: {
      absolute_file_path: "/tmp/foo.ts",
      line_range: { start: 10, end: 12 },
    },
  };

  const liveSummary: ReviewSummary = {
    findings: [finding],
    overall_correctness: "patch is incorrect",
    overall_explanation: "A race condition is present.",
    overall_confidence_score: 0.8,
  };

  test("shows reviewer issues immediately when live summary is available", () => {
    const result = resolveIssuesFoundDisplay({
      sessionStatus: "running",
      sessionIteration: 2,
      latestReviewIteration: 1,
      persistedFindings: [],
      persistedCodexText: null,
      parsedCodexSummary: null,
      liveReviewSummary: liveSummary,
      cachedLiveReviewSummary: null,
      sessionStateReviewSummary: null,
    });

    expect(result.codexText).toBeNull();
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.title).toBe("Fix race condition");
  });

  test("keeps issues visible during reviewer-to-fixer transition via cached summary", () => {
    const result = resolveIssuesFoundDisplay({
      sessionStatus: "running",
      sessionIteration: 2,
      latestReviewIteration: 1,
      persistedFindings: [],
      persistedCodexText: null,
      parsedCodexSummary: null,
      liveReviewSummary: null,
      cachedLiveReviewSummary: liveSummary,
      sessionStateReviewSummary: null,
    });

    expect(result.codexText).toBeNull();
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.title).toBe("Fix race condition");
  });

  test("hides previous-iteration findings while next reviewer phase is active", () => {
    const result = resolveIssuesFoundDisplay({
      sessionStatus: "running",
      sessionIteration: 3,
      latestReviewIteration: 2,
      persistedFindings: [finding],
      persistedCodexText: null,
      parsedCodexSummary: null,
      liveReviewSummary: null,
      cachedLiveReviewSummary: null,
      sessionStateReviewSummary: null,
    });

    expect(result.codexText).toBeNull();
    expect(result.findings).toEqual([]);
  });

  test("shows session-state review summary when running with no live or persisted review", () => {
    const result = resolveIssuesFoundDisplay({
      sessionStatus: "running",
      sessionIteration: 2,
      latestReviewIteration: 1,
      persistedFindings: [],
      persistedCodexText: null,
      parsedCodexSummary: null,
      liveReviewSummary: null,
      cachedLiveReviewSummary: null,
      sessionStateReviewSummary: liveSummary,
    });

    expect(result.codexText).toBeNull();
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.title).toBe("Fix race condition");
  });

  test("prefers live tmux summary over session-state review summary", () => {
    const sessionStateSummary: ReviewSummary = {
      findings: [{ ...finding, title: "Session-state finding" }],
      overall_correctness: "patch is incorrect",
      overall_explanation: "From session state.",
      overall_confidence_score: 0.7,
    };

    const result = resolveIssuesFoundDisplay({
      sessionStatus: "running",
      sessionIteration: 2,
      latestReviewIteration: 1,
      persistedFindings: [],
      persistedCodexText: null,
      parsedCodexSummary: null,
      liveReviewSummary: liveSummary,
      cachedLiveReviewSummary: null,
      sessionStateReviewSummary: sessionStateSummary,
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.title).toBe("Fix race condition");
  });

  test("ignores session-state review summary when persisted review matches current iteration", () => {
    const persistedFinding = { ...finding, title: "Persisted finding" };
    const result = resolveIssuesFoundDisplay({
      sessionStatus: "running",
      sessionIteration: 2,
      latestReviewIteration: 2,
      persistedFindings: [persistedFinding],
      persistedCodexText: null,
      parsedCodexSummary: null,
      liveReviewSummary: null,
      cachedLiveReviewSummary: null,
      sessionStateReviewSummary: liveSummary,
    });

    // Persisted findings win because latestReviewIteration === sessionIteration
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.title).toBe("Persisted finding");
  });

  test("shows persisted findings when session is not running", () => {
    const persistedFinding = { ...finding, title: "Persisted finding for completed run" };
    const result = resolveIssuesFoundDisplay({
      sessionStatus: "completed",
      sessionIteration: 3,
      latestReviewIteration: 2,
      persistedFindings: [persistedFinding],
      persistedCodexText: null,
      parsedCodexSummary: null,
      liveReviewSummary: null,
      cachedLiveReviewSummary: null,
      sessionStateReviewSummary: null,
    });

    expect(result.codexText).toBeNull();
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.title).toBe("Persisted finding for completed run");
  });

  test("shows parsed codex summary findings when persisted findings are empty", () => {
    const parsedSummary: ReviewSummary = {
      findings: [{ ...finding, title: "Parsed codex finding" }],
      overall_correctness: "patch is incorrect",
      overall_explanation: "Parsed from codex text.",
      overall_confidence_score: 0.77,
    };

    const result = resolveIssuesFoundDisplay({
      sessionStatus: "completed",
      sessionIteration: 3,
      latestReviewIteration: 2,
      persistedFindings: [],
      persistedCodexText: null,
      parsedCodexSummary: parsedSummary,
      liveReviewSummary: null,
      cachedLiveReviewSummary: null,
      sessionStateReviewSummary: null,
    });

    expect(result.codexText).toBeNull();
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.title).toBe("Parsed codex finding");
  });

  test("falls back to persisted codex text when no findings are available", () => {
    const result = resolveIssuesFoundDisplay({
      sessionStatus: "completed",
      sessionIteration: 3,
      latestReviewIteration: 2,
      persistedFindings: [],
      persistedCodexText: "raw codex output",
      parsedCodexSummary: null,
      liveReviewSummary: null,
      cachedLiveReviewSummary: null,
      sessionStateReviewSummary: null,
    });

    expect(result.findings).toEqual([]);
    expect(result.codexText).toBe("raw codex output");
  });
});

describe("DetailPane status rendering", () => {
  let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

  afterEach(async () => {
    if (testSetup) {
      await act(async () => {
        testSetup?.renderer.destroy();
      });
      testSetup = null;
    }
  });

  function createSession(overrides: Partial<SessionState> = {}): SessionState {
    return {
      schemaVersion: 2,
      sessionId: "session-1",
      sessionName: "rr-test-123",
      startTime: Date.now(),
      lastHeartbeat: Date.now(),
      pid: process.pid,
      projectPath: "/test/project",
      branch: "main",
      state: "running",
      mode: "background",
      ...overrides,
    };
  }

  async function renderFrame({
    session = createSession(),
    currentAgent = null,
  }: {
    session?: SessionState | null;
    currentAgent?: AgentRole | null;
  } = {}): Promise<string> {
    testSetup = await testRender(
      createElement(DetailPane, {
        session,
        fixes: [],
        skipped: [],
        findings: [],
        storedFindings: [],
        selectedFindingIds: [],
        selectedFindings: [],
        fixResults: [],
        unresolvedSelectedFindings: [],
        auditRegressionFindings: [],
        latestReviewIteration: null,
        codexReviewText: null,
        tmuxOutput: "",
        maxIterations: 5,
        isLoading: false,
        projectStats: null,
        isGitRepo: true,
        currentAgent,
        reviewOptions: undefined,
        isStarting: false,
        isStopping: false,
        activeSessionCount: 1,
        focused: false,
      }),
      {
        width: 120,
        height: 40,
      }
    );
    await act(async () => {
      await testSetup?.renderOnce();
    });
    return testSetup.captureCharFrame();
  }

  test("renders preparing session worktree before the first agent starts", async () => {
    const frame = await renderFrame({
      session: createSession({
        state: "running",
        currentAgent: null,
        iteration: undefined,
      }),
      currentAgent: null,
    });

    expect(frame).toContain("preparing session worktree");
  });

  test("renders starting review for pending sessions", async () => {
    const frame = await renderFrame({
      session: createSession({
        state: "pending",
        currentAgent: null,
      }),
      currentAgent: null,
    });

    expect(frame).toContain("starting review");
  });

  test("renders the active agent once the review is underway", async () => {
    const frame = await renderFrame({
      session: createSession({
        state: "running",
        iteration: 1,
        currentAgent: "reviewer",
      }),
      currentAgent: "reviewer",
    });

    expect(frame).toContain("running reviewer agent");
  });

  test("renders the code simplifier label when that agent is active", async () => {
    const frame = await renderFrame({
      session: createSession({
        state: "running",
        iteration: 1,
        currentAgent: "code-simplifier",
      }),
      currentAgent: "code-simplifier",
    });

    expect(frame).toContain("running code simplifier agent");
  });

  test("renders a generic running status once iteration one has started", async () => {
    const frame = await renderFrame({
      session: createSession({
        state: "running",
        iteration: 1,
        currentAgent: null,
      }),
      currentAgent: null,
    });

    expect(frame).toContain("running");
    expect(frame).not.toContain("preparing session worktree");
  });
});
