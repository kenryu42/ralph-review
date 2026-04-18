import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, createElement } from "react";
import type {
  FindingFixResult,
  FindingId,
  StoredFinding,
} from "@/lib/review-workflow/findings/types";
import type { SessionState } from "@/lib/session-state";
import { DetailPane } from "@/lib/tui/sessions/detail/DetailPane";
import type {
  AgentRole,
  Finding,
  FixEntry,
  IterationEntry,
  ProjectStats,
  ReviewOptions,
  SessionStats,
  SkippedEntry,
  SystemEntry,
} from "@/lib/types";
import { buildFixEntry, buildFixSummary, buildSkippedEntry } from "../../test-utils/fix-summary";

describe("DetailPane", () => {
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

  function createSystemEntry(overrides: Partial<SystemEntry> = {}): SystemEntry {
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

  function createIterationEntry(overrides: Partial<IterationEntry> = {}): IterationEntry {
    return {
      type: "iteration",
      timestamp: Date.now(),
      iteration: 1,
      fixes: buildFixSummary({
        fixes: [buildFixEntry()],
      }),
      ...overrides,
    };
  }

  function createLastSessionStats(overrides: Partial<SessionStats> = {}): SessionStats {
    return {
      sessionPath: "/tmp/logs/session.jsonl",
      sessionName: "session.jsonl",
      sessionId: "session-123",
      timestamp: Date.now() - 60_000,
      status: "completed",
      totalFixes: 3,
      totalSkipped: 1,
      priorityCounts: { P0: 1, P1: 1, P2: 1, P3: 1 },
      iterations: 2,
      totalDuration: 258_000,
      entries: [
        createSystemEntry(),
        createIterationEntry({
          iteration: 1,
          review: {
            findings: [
              createFinding({
                title: "[P1] Guard missing config before dereference",
                priority: 1,
                code_location: {
                  absolute_file_path: "/test/project/src/config.ts",
                  line_range: { start: 14, end: 18 },
                },
              }),
              createFinding({
                title: "[P2] Avoid stale review summary after restart",
                priority: 2,
                code_location: {
                  absolute_file_path: "/test/project/src/session.ts",
                  line_range: { start: 21, end: 24 },
                },
              }),
            ],
            overall_correctness: "patch is correct",
            overall_explanation: "ok",
            overall_confidence_score: 0.94,
          },
          fixes: buildFixSummary({
            fixes: [
              buildFixEntry({
                id: 1,
                title: "Guard missing config before dereference",
                priority: "P1",
              }),
              buildFixEntry({
                id: 2,
                title: "Avoid stale review summary after restart",
                priority: "P2",
              }),
            ],
          }),
        }),
        createIterationEntry({
          iteration: 2,
          review: {
            findings: [
              createFinding({
                title: "[P1] Stop leaking tmux pane handles on refresh",
                priority: 1,
                code_location: {
                  absolute_file_path: "/test/project/src/tmux.ts",
                  line_range: { start: 8, end: 12 },
                },
              }),
              createFinding({
                title: "[P3] Normalize lock timestamp parsing",
                priority: 3,
                code_location: {
                  absolute_file_path: "/test/project/src/locks.ts",
                  line_range: { start: 30, end: 32 },
                },
              }),
            ],
            overall_correctness: "patch is correct",
            overall_explanation: "ok",
            overall_confidence_score: 0.95,
          },
          fixes: buildFixSummary({
            fixes: [
              buildFixEntry({
                id: 3,
                title: "Stop leaking tmux pane handles on refresh",
                priority: "P1",
              }),
              buildFixEntry({ id: 4, title: "Normalize lock timestamp parsing", priority: "P3" }),
            ],
            skipped: [
              buildSkippedEntry({ id: 5, title: "Low-priority style note", priority: "P3" }),
            ],
          }),
        }),
      ],
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

  async function renderFrame({
    session = createSession(),
    fixes = [],
    skipped = [],
    findings = [],
    storedFindings = [],
    selectedFindingIds = [],
    selectedFindings = [],
    fixResults = [],
    unresolvedSelectedFindings = [],
    auditRegressionFindings = [],
    latestReviewIteration = null,
    codexReviewText = null,
    tmuxOutput = "",
    maxIterations = 5,
    isLoading = false,
    projectStats = null,
    isGitRepo = true,
    currentAgent = null,
    reviewOptions = undefined,
    startupMode = null,
    isStopping = false,
    activeSessionCount = 1,
    lastSessionStats = null,
    focused = false,
    height = 60,
  }: {
    session?: SessionState | null;
    fixes?: FixEntry[];
    skipped?: SkippedEntry[];
    findings?: Finding[];
    storedFindings?: StoredFinding[];
    selectedFindingIds?: FindingId[];
    selectedFindings?: StoredFinding[];
    fixResults?: FindingFixResult[];
    unresolvedSelectedFindings?: StoredFinding[];
    auditRegressionFindings?: StoredFinding[];
    latestReviewIteration?: number | null;
    codexReviewText?: string | null;
    tmuxOutput?: string;
    maxIterations?: number;
    isLoading?: boolean;
    projectStats?: ProjectStats | null;
    isGitRepo?: boolean;
    currentAgent?: AgentRole | null;
    reviewOptions?: ReviewOptions | undefined;
    startupMode?: "review" | "fix" | null;
    isStopping?: boolean;
    activeSessionCount?: number;
    lastSessionStats?: SessionStats | null;
    focused?: boolean;
    height?: number;
  } = {}): Promise<string> {
    testSetup = await testRender(
      createElement(DetailPane, {
        session,
        fixes,
        skipped,
        findings,
        storedFindings,
        selectedFindingIds,
        selectedFindings,
        fixResults,
        unresolvedSelectedFindings,
        auditRegressionFindings,
        latestReviewIteration,
        codexReviewText,
        tmuxOutput,
        maxIterations,
        isLoading,
        projectStats,
        isGitRepo,
        currentAgent,
        reviewOptions,
        startupMode,
        isStopping,
        activeSessionCount,
        lastSessionStats,
        focused,
      }),
      {
        width: 160,
        height,
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
      isGitRepo: false,
    });

    expect(frame).toContain("Not a git repository");
    expect(frame).toContain('Run "git init" to initialize');
    expect(frame).toContain("No active session");
    expect(frame).toContain('Start a review by pressing "r"');
  });

  test("renders the idle starting banner", async () => {
    const frame = await renderFrame({
      session: null,
      startupMode: "review",
    });

    expect(frame).toContain("Starting review...");
  });

  test("renders the idle stopping banner", async () => {
    const frame = await renderFrame({
      session: null,
      isStopping: true,
    });

    expect(frame).toContain("Stopping review...");
  });

  test("renders project stats in idle state", async () => {
    const frame = await renderFrame({
      session: null,
      projectStats: createProjectStats(),
    });

    expect(frame).toContain("Project stats");
    expect(frame).toContain("3 fixes across 2 sessions");
  });

  test("renders last-run preview with fix titles and apply command when handoff is pending", async () => {
    const frame = await renderFrame({
      session: null,
      lastSessionStats: createLastSessionStats({
        handoffStatus: "pending-apply",
        sessionId: "session-123",
      }),
    });

    expect(frame).toContain("Last run");
    expect(frame).toContain("3 fixes, 1 skipped in 2 iterations");
    expect(frame).not.toContain("Priorities:");
    expect(frame).toContain("Guard missing config before dereference");
    expect(frame).toContain("Avoid stale review summary after restart");
    expect(frame).toContain("Stop leaking tmux pane handles on refresh");
    expect(frame).not.toContain("[P1] Guard missing config before dereference");
    expect(frame).not.toContain("[P2] Avoid stale review summary after restart");
    expect(frame).toContain("Recent fixes");
    expect(frame).toContain("Guard missing config before dereference");
    expect(frame).toContain("Avoid stale review summary after restart");
    expect(frame).toContain("Stop leaking tmux pane handles on refresh");
    expect(frame).toContain("Handoff:");
    expect(frame).toContain("rr apply --session session-123");
  });

  test("renders auto-applied handoff status without apply command", async () => {
    const frame = await renderFrame({
      session: null,
      lastSessionStats: createLastSessionStats({
        handoffStatus: "applied-auto",
      }),
    });

    expect(frame).toContain("Handoff: auto applied.");
    expect(frame).not.toContain("rr apply --session");
  });

  test("renders project stats before the last-run section in idle state", async () => {
    const frame = await renderFrame({
      session: null,
      projectStats: createProjectStats(),
      lastSessionStats: createLastSessionStats(),
    });

    const projectStatsIndex = frame.indexOf("Project stats");
    const lastRunIndex = frame.indexOf("Last run");

    expect(projectStatsIndex).toBeGreaterThan(-1);
    expect(lastRunIndex).toBeGreaterThan(-1);
    expect(projectStatsIndex).toBeLessThan(lastRunIndex);
  });

  test("renders an active session summary with findings, fixes, and skipped items", async () => {
    const frame = await renderFrame({
      session: createSession({
        iteration: 2,
        currentAgent: "reviewer",
        worktreeBranch: "rr-worktree-session-2",
      }),
      currentAgent: "reviewer",
      reviewOptions: { baseBranch: "main" },
      latestReviewIteration: 2,
      findings: [createFinding({ title: "[P1] Trailing spaces in title" })],
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
    expect(frame).toContain("Issues found");
    expect(frame).toContain("Trailing spaces in title");
    expect(frame).not.toContain("[P1] Trailing spaces in title");
    expect(frame).toContain("/test/project/src/file.ts:10-12");
    expect(frame).toContain("Fix applied");
    expect(frame).toContain("Fix title");
    expect(frame).toContain("Skipped");
    expect(frame).toContain("Skipped title");
  });

  test("renders batch-first workflow metadata, inventory, fix results, and audit details", async () => {
    const frame = await renderFrame({
      session: createSession({
        currentPhase: "complete",
        sessionStatus: "completed",
        reviewOutcome: "incomplete",
        accumulatedFindings: [
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
            confidenceScore: 0.91,
            filePath: "src/cache.ts",
            startLine: 20,
            endLine: 22,
          },
        ],
        selectedFindingIds: ["F001"],
      }),
      reviewOptions: { baseBranch: "main" },
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
        {
          id: "F002",
          fingerprint: "fp-2",
          title: "Avoid stale cache",
          body: "Cache can be stale",
          priority: "P2",
          confidenceScore: 0.91,
          filePath: "src/cache.ts",
          startLine: 20,
          endLine: 22,
        },
      ],
      selectedFindingIds: ["F001"],
      selectedFindings: [
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
      fixResults: [
        {
          findingId: "F001",
          status: "unresolved",
          summary: "Added a null guard",
        },
      ],
      unresolvedSelectedFindings: [
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
      auditRegressionFindings: [
        {
          id: "F010",
          fingerprint: "fp-10",
          title: "Regression in cache invalidation",
          body: "Fix introduced a cache regression",
          priority: "P1",
          confidenceScore: 0.88,
          filePath: "src/cache.ts",
          startLine: 30,
          endLine: 32,
        },
      ],
    });

    expect(frame).toContain("Workflow:");
    expect(frame).toContain("complete");
    expect(frame).toContain("completed");
    expect(frame).toContain("incomplete");
    expect(frame).toContain("Findings inventory");
    expect(frame).toContain("Guard missing config");
    expect(frame).toContain("Selected findings");
    expect(frame).toContain("Fix results");
    expect(frame).toContain("Added a null guard");
    expect(frame).toContain("Remediation follow-up");
    expect(frame).toContain("Regression in cache invalidation");
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

  test("keeps section labels readable when the pane height is constrained", async () => {
    const frame = await renderFrame({
      session: createSession({
        iteration: 2,
        currentAgent: "reviewer",
        worktreeBranch: "rr-worktree-session-2",
      }),
      currentAgent: "reviewer",
      reviewOptions: { baseBranch: "main" },
      latestReviewIteration: 2,
      findings: [createFinding()],
      fixes: [buildFixEntry()],
      skipped: [buildSkippedEntry()],
      activeSessionCount: 2,
      height: 20,
    });

    expect(frame).toContain("Session:");
    expect(frame).toContain("Issues found");
    expect(frame).toContain("Fix applied");
    expect(frame).toContain("Skipped");
    expect(frame).toContain("2 active sessions");
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
