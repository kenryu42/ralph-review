import { describe, expect, test } from "bun:test";
import { buildDashboardViewModel } from "@/lib/html/dashboard/view-model";
import type {
  DashboardData,
  FixEntry,
  IterationEntry,
  SessionStats,
  SkippedEntry,
  SystemEntry,
} from "@/lib/types";
import { buildFixEntry, buildFixSummary, buildSkippedEntry } from "../../test-utils/fix-summary";

function createSession(overrides: Partial<SessionStats> = {}): SessionStats {
  return {
    sessionPath: "/logs/work-project-a/session.jsonl",
    sessionName: "session.jsonl",
    timestamp: 1,
    status: "completed",
    totalFixes: 0,
    totalSkipped: 0,
    priorityCounts: { P0: 0, P1: 0, P2: 0, P3: 0 },
    iterations: 0,
    entries: [],
    reviewer: "claude",
    reviewerModel: "claude-sonnet-4-20250514",
    reviewerDisplayName: "Claude",
    reviewerModelDisplayName: "Claude Sonnet 4",
    fixer: "codex",
    fixerModel: "gpt-5",
    fixerDisplayName: "Codex",
    fixerModelDisplayName: "GPT-5",
    ...overrides,
  };
}

function createDashboardData(projectSessions: SessionStats[][]): DashboardData {
  return {
    generatedAt: 1,
    globalStats: {
      totalFixes: 0,
      totalSkipped: 0,
      priorityCounts: { P0: 0, P1: 0, P2: 0, P3: 0 },
      totalSessions: projectSessions.reduce((sum, sessions) => sum + sessions.length, 0),
      averageIterations: 0,
      fixRate: 0,
    },
    projects: projectSessions.map((sessions, index) => ({
      projectName: `work-project-${index + 1}`,
      displayName: `project-${index + 1}`,
      totalFixes: sessions.reduce((sum, session) => sum + session.totalFixes, 0),
      totalSkipped: sessions.reduce((sum, session) => sum + session.totalSkipped, 0),
      priorityCounts: { P0: 0, P1: 0, P2: 0, P3: 0 },
      sessionCount: sessions.length,
      averageIterations: 0,
      fixRate: 0,
      sessions,
    })),
    reviewerAgentStats: [],
    fixerAgentStats: [],
    reviewerModelStats: [],
    fixerModelStats: [],
  };
}

function createSystemEntry(overrides: Partial<SystemEntry> = {}): SystemEntry {
  return {
    type: "system",
    timestamp: 1,
    projectPath: "/work/project-a",
    reviewer: { agent: "claude", model: "claude-sonnet-4-20250514" },
    fixer: { agent: "codex", model: "gpt-5" },
    maxIterations: 5,
    ...overrides,
  };
}

describe("buildDashboardViewModel", () => {
  test("extracts and sorts fixes and skipped items from iteration entries", () => {
    const fixes: FixEntry[] = [
      {
        id: 2,
        title: "Fix second",
        priority: "P2",
        file: null,
        claim: "claim-2",
        evidence: "evidence-2",
        fix: "fix-2",
      },
      buildFixEntry({ id: 1, priority: "P0", title: "Fix first", file: "src/first.ts" }),
    ];
    const skipped: SkippedEntry[] = [
      buildSkippedEntry({ id: 2, priority: "P3", title: "Skipped later", reason: "reason-2" }),
      buildSkippedEntry({ id: 1, priority: "P1", title: "Skipped first", reason: "reason-1" }),
    ];
    const iterationWithFixes: IterationEntry = {
      type: "iteration",
      timestamp: 2,
      iteration: 2,
      fixes: buildFixSummary({
        fixes,
        skipped,
      }),
    };
    const session = createSession({
      totalFixes: 2,
      totalSkipped: 2,
      entries: [
        createSystemEntry(),
        { type: "iteration", timestamp: 1, iteration: 1 },
        iterationWithFixes,
      ],
      reviewerReasoning: "high",
      fixerReasoning: "medium",
    });

    const viewModel = buildDashboardViewModel(createDashboardData([[session]]));
    const sessionVm = viewModel.sessionsByPath[session.sessionPath];
    expect(sessionVm).toBeDefined();
    if (!sessionVm) throw new Error("expected session view model to exist");

    expect(sessionVm.badge).toEqual({
      label: "2 fixes",
      className: "status-has-fixes",
    });
    expect(sessionVm.prioritiesText).toContain("P0");
    expect(sessionVm.prioritiesText).toContain("P2");
    expect(sessionVm.sortedFixes).toEqual([
      { priority: "P0", title: "Fix first", file: "src/first.ts" },
      { priority: "P2", title: "Fix second", file: "" },
    ]);
    expect(sessionVm.sortedSkipped).toEqual([
      { priority: "P1", title: "Skipped first", reason: "reason-1" },
      { priority: "P3", title: "Skipped later", reason: "reason-2" },
    ]);
    expect(sessionVm.reviewerDisplay).toBe("Claude (Claude Sonnet 4, high)");
    expect(sessionVm.fixerDisplay).toBe("Codex (GPT-5, medium)");
  });

  test("uses running badge when session status is not completed", () => {
    const session = createSession({
      status: "running",
      totalFixes: 9,
      totalSkipped: 1,
      reviewerDisplayName: "",
      reviewerModelDisplayName: "",
      reviewerModel: "",
      fixerDisplayName: "",
      fixerModelDisplayName: "",
      fixerModel: "",
    });

    const viewModel = buildDashboardViewModel(createDashboardData([[session]]));
    const sessionVm = viewModel.sessionsByPath[session.sessionPath];
    expect(sessionVm).toBeDefined();
    if (!sessionVm) throw new Error("expected session view model to exist");

    expect(sessionVm.badge).toEqual({
      label: "running",
      className: "status-running",
    });
    expect(sessionVm.reviewerDisplay).toBe("claude");
    expect(sessionVm.fixerDisplay).toBe("codex");
  });

  test("uses skipped badge when completed session only has skipped items", () => {
    const session = createSession({
      totalFixes: 0,
      totalSkipped: 1200,
    });

    const viewModel = buildDashboardViewModel(createDashboardData([[session]]));
    const sessionVm = viewModel.sessionsByPath[session.sessionPath];
    expect(sessionVm).toBeDefined();
    if (!sessionVm) throw new Error("expected session view model to exist");

    expect(sessionVm.badge).toEqual({
      label: "1,200 skipped",
      className: "status-has-skipped",
    });
  });

  test("uses no-issues badge when completed session has no fixes and no skipped items", () => {
    const session = createSession({
      totalFixes: 0,
      totalSkipped: 0,
    });

    const viewModel = buildDashboardViewModel(createDashboardData([[session]]));
    const sessionVm = viewModel.sessionsByPath[session.sessionPath];
    expect(sessionVm).toBeDefined();
    if (!sessionVm) throw new Error("expected session view model to exist");

    expect(sessionVm.badge).toEqual({
      label: "No Issues",
      className: "status-no-issues",
    });
  });

  test("detects code simplifier from system entry and maps sessions by path across projects", () => {
    const codeSimplifierSession = createSession({
      sessionPath: "/logs/project-1/session-a.jsonl",
      entries: [createSystemEntry({ codeSimplifier: { agent: "codex", model: "gpt-5-codex" } })],
    });
    const reviewOptionSession = createSession({
      sessionPath: "/logs/project-2/session-b.jsonl",
      entries: [createSystemEntry({ reviewOptions: { simplifier: true } })],
    });
    const plainSession = createSession({
      sessionPath: "/logs/project-2/session-c.jsonl",
      entries: [createSystemEntry()],
    });

    const viewModel = buildDashboardViewModel(
      createDashboardData([[codeSimplifierSession], [reviewOptionSession, plainSession]])
    );

    expect(Object.keys(viewModel.sessionsByPath).sort()).toEqual([
      "/logs/project-1/session-a.jsonl",
      "/logs/project-2/session-b.jsonl",
      "/logs/project-2/session-c.jsonl",
    ]);
    expect(viewModel.sessionsByPath[codeSimplifierSession.sessionPath]?.codeSimplified).toBe(true);
    expect(viewModel.sessionsByPath[reviewOptionSession.sessionPath]?.codeSimplified).toBe(true);
    expect(viewModel.sessionsByPath[plainSession.sessionPath]?.codeSimplified).toBe(false);
  });
});
