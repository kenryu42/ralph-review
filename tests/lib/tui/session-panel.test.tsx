import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, createElement } from "react";
import type { SessionState } from "@/lib/session-state";
import { SessionPanel } from "@/lib/tui/components/SessionPanel";
import type {
  AgentRole,
  Finding,
  FixEntry,
  IterationEntry,
  ProjectStats,
  ReviewOptions,
  SessionStats,
  SkippedEntry,
} from "@/lib/types";
import { buildFixEntry, buildFixSummary, buildSkippedEntry } from "../../test-utils/fix-summary";

describe("SessionPanel", () => {
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

  function createFinding(overrides: Partial<Finding> = {}): Finding {
    return {
      title: "Trailing spaces in title",
      body: "The title contains trailing spaces.",
      confidence_score: 0.92,
      priority: 1,
      code_location: {
        absolute_file_path: "/test/project/src/file.ts",
        line_range: { start: 10, end: 12 },
      },
      ...overrides,
    };
  }

  function createIterationEntry(overrides: Partial<IterationEntry> = {}): IterationEntry {
    return {
      type: "iteration",
      timestamp: Date.now(),
      iteration: 1,
      duration: 1_000,
      fixes: buildFixSummary({
        decision: "APPLY_MOST",
        fixes: [buildFixEntry()],
        skipped: [buildSkippedEntry()],
      }),
      ...overrides,
    };
  }

  function createLastSessionStats(overrides: Partial<SessionStats> = {}): SessionStats {
    return {
      sessionPath: "/logs/test-project/2024-01-15T14-30-00.jsonl",
      sessionName: "2024-01-15T14-30-00.jsonl",
      sessionId: "session-1",
      timestamp: Date.now(),
      gitBranch: "main",
      status: "completed",
      totalFixes: 1,
      totalSkipped: 1,
      priorityCounts: { P0: 0, P1: 1, P2: 1, P3: 0 },
      iterations: 2,
      entries: [createIterationEntry()],
      reviewer: "claude",
      reviewerModel: "claude-sonnet-4-20250514",
      reviewerDisplayName: "Claude",
      reviewerModelDisplayName: "claude-sonnet-4-20250514",
      fixer: "codex",
      fixerModel: "gpt-5.3-codex",
      fixerDisplayName: "Codex",
      fixerModelDisplayName: "gpt-5.3-codex",
      ...overrides,
    };
  }

  function createProjectStats(overrides: Partial<ProjectStats> = {}): ProjectStats {
    return {
      projectName: "test-project",
      displayName: "test-project",
      totalFixes: 3,
      totalSkipped: 1,
      priorityCounts: { P0: 0, P1: 1, P2: 1, P3: 1 },
      sessionCount: 2,
      averageIterations: 1.5,
      fixRate: 0.75,
      sessions: [],
      ...overrides,
    };
  }

  async function renderFrame({
    session = createSession(),
    fixes = [],
    skipped = [],
    findings = [],
    latestReviewIteration = null,
    codexReviewText = null,
    tmuxOutput = "",
    maxIterations = 5,
    isLoading = false,
    lastSessionStats = null,
    projectStats = null,
    isGitRepo = true,
    currentAgent = null,
    reviewOptions = undefined,
    isStarting = false,
    isStopping = false,
    activeSessionCount = 1,
    focused = false,
  }: {
    session?: SessionState | null;
    fixes?: FixEntry[];
    skipped?: SkippedEntry[];
    findings?: Finding[];
    latestReviewIteration?: number | null;
    codexReviewText?: string | null;
    tmuxOutput?: string;
    maxIterations?: number;
    isLoading?: boolean;
    lastSessionStats?: SessionStats | null;
    projectStats?: ProjectStats | null;
    isGitRepo?: boolean;
    currentAgent?: AgentRole | null;
    reviewOptions?: ReviewOptions | undefined;
    isStarting?: boolean;
    isStopping?: boolean;
    activeSessionCount?: number;
    focused?: boolean;
  } = {}): Promise<string> {
    testSetup = await testRender(
      createElement(SessionPanel, {
        session,
        fixes,
        skipped,
        findings,
        latestReviewIteration,
        codexReviewText,
        tmuxOutput,
        maxIterations,
        isLoading,
        lastSessionStats,
        projectStats,
        isGitRepo,
        currentAgent,
        reviewOptions,
        isStarting,
        isStopping,
        activeSessionCount,
        focused,
      }),
      {
        width: 160,
        height: 60,
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

  test("renders the loading state", async () => {
    const frame = await renderFrame({
      isLoading: true,
    });

    expect(frame).toContain("Loading...");
  });

  test("renders the idle state with git guidance", async () => {
    const frame = await renderFrame({
      session: null,
      lastSessionStats: null,
      isGitRepo: false,
    });

    expect(frame).toContain("Not a git repository");
    expect(frame).toContain('Run "git init" to initialize');
    expect(frame).toContain("No active session");
    expect(frame).toContain('Start a review with "rr run"');
  });

  test("renders the idle starting banner", async () => {
    const frame = await renderFrame({
      session: null,
      lastSessionStats: null,
      isStarting: true,
    });

    expect(frame).toContain("Starting review...");
  });

  test("renders the idle stopping banner", async () => {
    const frame = await renderFrame({
      session: null,
      lastSessionStats: null,
      isStopping: true,
    });

    expect(frame).toContain("Stopping review...");
  });

  test("renders historical run details with handoff commands and extracted fixes", async () => {
    const frame = await renderFrame({
      session: null,
      lastSessionStats: createLastSessionStats({
        handoffStatus: "pending-apply",
        commitSha: "abc1234",
      }),
      projectStats: createProjectStats(),
    });

    expect(frame).toContain("Project stats:");
    expect(frame).toContain("3 fixes across 2 sessions");
    expect(frame).toContain('"rr dashboard" for more insights');
    expect(frame).toContain("Last run:");
    expect(frame).toContain("Pending apply");
    expect(frame).toContain("rr apply --session session-1");
    expect(frame).toContain("Recent fixes:");
    expect(frame).toContain("Fix title");
    expect(frame).toContain("src/file.ts");
    expect(frame).toContain("Recent skipped:");
    expect(frame).toContain("Skipped title");
  });

  test("renders retained worktree guidance for the previous run when no handoff exists", async () => {
    const frame = await renderFrame({
      session: null,
      lastSessionStats: createLastSessionStats({
        handoffStatus: undefined,
        worktreeBranch: "rr-worktree-session-1",
        mergeReady: true,
        reviewOutcome: "incomplete",
        entries: [],
        totalFixes: 0,
        totalSkipped: 0,
      }),
    });

    expect(frame).toContain("Worktree branch:");
    expect(frame).toContain("rr-worktree-session-1");
    expect(frame).toContain("git merge rr-worktree-session-1");
    expect(frame).toContain("Remaining findings may still exist");
  });

  test("keeps last-run running status when there is no active session", async () => {
    const frame = await renderFrame({
      session: null,
      lastSessionStats: createLastSessionStats({
        status: "running",
      }),
    });

    expect(frame).toContain("Last run:");
    expect(frame).toContain("running");
    expect(frame).not.toContain("preparing session worktree");
  });

  test("renders an active session summary with findings, fixes, skipped items, and handoff", async () => {
    const frame = await renderFrame({
      session: createSession({
        iteration: 2,
        currentAgent: "reviewer",
        handoffStatus: "pending-apply",
        commitSha: "def5678",
        worktreeBranch: "rr-worktree-session-2",
      }),
      currentAgent: "reviewer",
      reviewOptions: { baseBranch: "main" },
      latestReviewIteration: 2,
      findings: [createFinding()],
      fixes: [buildFixEntry()],
      skipped: [buildSkippedEntry()],
      activeSessionCount: 2,
    });

    expect(frame).toContain("running reviewer agent");
    expect(frame).toContain("Review Type:");
    expect(frame).toContain("base (main)");
    expect(frame).toContain("Session:");
    expect(frame).toContain("rr-test-123");
    expect(frame).toContain("rr-worktree-session-2");
    expect(frame).toContain("2 active sessions");
    expect(frame).toContain("Handoff:");
    expect(frame).toContain("Pending apply");
    expect(frame).toContain("rr apply --session session-1");
    expect(frame).toContain("Issues found");
    expect(frame).toContain("Trailing spaces in title");
    expect(frame).toContain("/test/project/src/file.ts:10-12");
    expect(frame).toContain("Fix applied");
    expect(frame).toContain("Fix title");
    expect(frame).toContain("Skipped");
    expect(frame).toContain("Skipped title");
  });

  test("renders merge guidance and empty sections for an active retained worktree", async () => {
    const frame = await renderFrame({
      session: createSession({
        state: "completed",
        iteration: 3,
        currentAgent: null,
        handoffStatus: undefined,
        worktreeBranch: "rr-worktree-session-3",
        worktreeMergeReady: true,
        reviewOutcome: "incomplete",
      }),
      currentAgent: null,
      reviewOptions: undefined,
    });

    expect(frame).toContain("completed");
    expect(frame).toContain("uncommitted changes");
    expect(frame).toContain("Merge fixes:");
    expect(frame).toContain("git merge rr-worktree-session-3");
    expect(frame).toContain("Remaining findings may still exist");
    expect(frame).toContain("None yet");
  });

  test("renders codex review text when no structured findings are present", async () => {
    const frame = await renderFrame({
      session: createSession({
        state: "completed",
        iteration: 4,
      }),
      codexReviewText: "Looks clean.\nShip it.",
    });

    expect(frame).toContain("Issues found");
    expect(frame).toContain("codex");
    expect(frame).toContain("Looks clean.");
    expect(frame).toContain("Ship it.");
  });

  test("renders the active stop banner while a session is stopping", async () => {
    const frame = await renderFrame({
      session: createSession({
        state: "running",
        iteration: 2,
      }),
      isStopping: true,
    });

    expect(frame).toContain("Stopping review...");
  });
});
