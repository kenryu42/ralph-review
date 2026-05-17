#!/usr/bin/env bun
/**
 * Dev script for previewing the detail pane with mock data.
 *
 * Usage:
 *   bun scripts/tui-dev.tsx                      # Default: running state
 *   bun scripts/tui-dev.tsx --state=codex        # Codex review text
 *   bun scripts/tui-dev.tsx --state=completed    # Completed session
 *   bun scripts/tui-dev.tsx --state=many         # Stress test layout
 *   bun scripts/tui-dev.tsx --state=empty        # No session
 *   bun scripts/tui-dev.tsx --state=loading      # Loading state
 *   bun scripts/tui-dev.tsx --state=no-git       # Not a git repo
 *   bun scripts/tui-dev.tsx --state=workspace    # Full Workspace with multiple session groups
 *                                                # (tab cycles focus, up/down or j/k navigate groups)
 */
import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { useCallback, useMemo, useState } from "react";
import type {
  FindingFixResult,
  FindingId,
  StoredFinding,
} from "@/lib/review-workflow/findings/types";
import type { ActiveSession, SessionState } from "@/lib/session-state";
import {
  cycleDashboardFocus,
  cycleDashboardFocusReverse,
} from "@/lib/tui/dashboard/dashboard-focus";
import {
  resolveSelectedGroupPath,
  selectAdjacentGroupPath,
} from "@/lib/tui/dashboard/dashboard-group-selection";
import { DetailPane } from "@/lib/tui/sessions/detail/DetailPane";
import { SelectionCopyToastBoundary } from "@/lib/tui/shared/SelectionCopyToastBoundary";
import { Workspace } from "@/lib/tui/workspace/Workspace";
import type { FocusedPane, SessionGroupData } from "@/lib/tui/workspace/workspace-types";
import type {
  AgentRole,
  Finding,
  FixEntry,
  ProjectStats,
  ReviewOptions,
  SessionStats,
  SkippedEntry,
} from "@/lib/types";

type MockState =
  | "running"
  | "codex"
  | "completed"
  | "many"
  | "empty"
  | "loading"
  | "no-git"
  | "workspace";

const VALID_STATES: MockState[] = [
  "running",
  "codex",
  "completed",
  "many",
  "empty",
  "loading",
  "no-git",
  "workspace",
];

function parseState(): MockState {
  const arg = process.argv.find((a) => a.startsWith("--state="));
  if (!arg) return "running";

  const state = arg.split("=")[1] as MockState;
  if (!VALID_STATES.includes(state)) {
    console.error(`Invalid state: ${state}`);
    console.error(`Valid states: ${VALID_STATES.join(", ")}`);
    process.exit(1);
  }
  return state;
}

const mockFindings: Finding[] = [
  {
    title: "Unused variable 'tempData' should be removed",
    body: "The variable tempData is declared but never used.",
    confidence_score: 0.95,
    priority: 0,
    code_location: {
      absolute_file_path: "/Users/dev/project/src/utils/helpers.ts",
      line_range: { start: 42, end: 42 },
    },
  },
  {
    title: "Missing error handling in async function",
    body: "The fetchData function does not handle rejection cases.",
    confidence_score: 0.88,
    priority: 1,
    code_location: {
      absolute_file_path: "/Users/dev/project/src/api/client.ts",
      line_range: { start: 78, end: 85 },
    },
  },
  {
    title: "Potential null reference access",
    body: "user.profile may be null when accessed.",
    confidence_score: 0.82,
    priority: 1,
    code_location: {
      absolute_file_path: "/Users/dev/project/src/components/UserCard.tsx",
      line_range: { start: 23, end: 25 },
    },
  },
  {
    title: "Console.log statement left in production code",
    body: "Debug logging should be removed before deployment.",
    confidence_score: 0.99,
    priority: 2,
    code_location: {
      absolute_file_path: "/Users/dev/project/src/services/auth.ts",
      line_range: { start: 156, end: 156 },
    },
  },
  {
    title: "Consider using optional chaining",
    body: "Nested property access could be simplified.",
    confidence_score: 0.75,
    priority: 3,
    code_location: {
      absolute_file_path: "/Users/dev/project/src/lib/parser.ts",
      line_range: { start: 89, end: 92 },
    },
  },
];

const mockFixes: FixEntry[] = [
  {
    id: 1,
    title: "Remove unused variable tempData",
    priority: "P0",
    file: "src/utils/helpers.ts",
    claim: "Variable is unused",
    evidence: "No references found in codebase",
    fix: "Deleted line 42",
  },
  {
    id: 2,
    title: "Add try-catch to fetchData",
    priority: "P1",
    file: "src/api/client.ts",
    claim: "Missing error handling",
    evidence: "Async function without catch",
    fix: "Wrapped in try-catch block",
  },
  {
    id: 3,
    title: "Add null check for user.profile",
    priority: "P1",
    file: "src/components/UserCard.tsx",
    claim: "Potential null reference",
    evidence: "profile can be undefined",
    fix: "Added optional chaining",
  },
];

const mockSkipped: SkippedEntry[] = [
  {
    id: 4,
    title: "Remove console.log",
    priority: "P2",
    reason: "Intentional debug logging for staging environment",
  },
];

const mockCodexReviewText = `- Line 42: Consider using const instead of let for tempData
- Line 78: This async function lacks proper error handling
- Line 103: Missing null check before accessing user.profile
- Line 156: Debug console.log should be removed
- Line 89-92: Nested property access could use optional chaining`;

const mockSession: SessionState = {
  schemaVersion: 2,
  sessionId: "mock-session-id",
  sessionName: "ralph-review-mock-12345",
  startTime: Date.now() - 120000,
  lastHeartbeat: Date.now(),
  pid: 12345,
  projectPath: "/Users/dev/project",
  branch: "feature/new-auth",
  state: "running",
  mode: "background",
  iteration: 2,
  currentAgent: "reviewer",
};

const mockCompletedSession: SessionState = {
  ...mockSession,
  state: "completed",
  iteration: 3,
};

const mockReviewOptions: ReviewOptions = {
  baseBranch: "main",
};

function buildManyFindings(count: number): Finding[] {
  const result: Finding[] = [];
  for (let index = 0; index < count; index++) {
    const base = mockFindings[index % mockFindings.length];
    if (!base) continue;
    result.push({
      ...base,
      title: `${base.title} (${index + 1})`,
      code_location: {
        ...base.code_location,
        line_range: {
          start: base.code_location.line_range.start + index,
          end: base.code_location.line_range.end + index,
        },
      },
    });
  }
  return result;
}

function buildManyFixes(count: number): FixEntry[] {
  const result: FixEntry[] = [];
  for (let index = 0; index < count; index++) {
    const base = mockFixes[index % mockFixes.length];
    if (!base) continue;
    result.push({
      ...base,
      id: 100 + index,
      title: `${base.title} (${index + 1})`,
    });
  }
  return result;
}

function buildManySkipped(count: number): SkippedEntry[] {
  const priorities: SkippedEntry["priority"][] = ["P0", "P1", "P2", "P3"];
  const result: SkippedEntry[] = [];
  for (let index = 0; index < count; index++) {
    const base = mockSkipped[index % mockSkipped.length];
    if (!base) continue;
    result.push({
      ...base,
      id: 200 + index,
      title: `${base.title} (${index + 1})`,
      priority: priorities[index % priorities.length] ?? "P2",
      reason: `${base.reason} (${index + 1})`,
    });
  }
  return result;
}

const mockLastSessionStats: SessionStats = {
  sessionPath: "/Users/dev/.config/ralph-review/logs/project/session-001.json",
  sessionName: "ralph-review-prev-session",
  timestamp: Date.now() - 3600000,
  gitBranch: "main",
  status: "completed",
  totalFixes: 5,
  totalSkipped: 1,
  priorityCounts: { P0: 1, P1: 2, P2: 1, P3: 1 },
  iterations: 2,
  totalDuration: 180000,
  entries: [],
  reviewer: "claude",
  reviewerModel: "claude-sonnet-4-20250514",
  reviewerDisplayName: "Claude",
  reviewerModelDisplayName: "claude-sonnet-4-20250514",
  fixer: "claude",
  fixerModel: "claude-sonnet-4-20250514",
  fixerDisplayName: "Claude",
  fixerModelDisplayName: "claude-sonnet-4-20250514",
};

const mockProjectStats: ProjectStats = {
  projectName: "mock-project",
  displayName: "Mock Project",
  totalFixes: 23,
  totalSkipped: 4,
  priorityCounts: { P0: 5, P1: 10, P2: 6, P3: 2 },
  sessionCount: 8,
  averageIterations: 2.5,
  fixRate: 0.85,
  sessions: [],
};

interface MockData {
  session: SessionState | null;
  fixes: FixEntry[];
  skipped: SkippedEntry[];
  findings: Finding[];
  storedFindings: StoredFinding[];
  selectedFindingIds: FindingId[];
  fixResults: FindingFixResult[];
  unresolvedSelectedFindings: StoredFinding[];
  auditRegressionFindings: StoredFinding[];
  latestReviewIteration: number | null;
  totalFixes: number;
  totalSkipped: number;
  codexReviewText: string | null;
  tmuxOutput: string;
  maxIterations: number;
  isLoading: boolean;
  lastSessionStats: SessionStats | null;
  projectStats: ProjectStats | null;
  isGitRepo: boolean;
  currentAgent: AgentRole | null;
  reviewOptions: ReviewOptions | undefined;
}

function getMockData(state: MockState): MockData {
  const base: MockData = {
    session: null,
    fixes: [],
    skipped: [],
    findings: [],
    storedFindings: [],
    selectedFindingIds: [],
    fixResults: [],
    unresolvedSelectedFindings: [],
    auditRegressionFindings: [],
    latestReviewIteration: null,
    totalFixes: 0,
    totalSkipped: 0,
    codexReviewText: null,
    tmuxOutput: "",
    maxIterations: 5,
    isLoading: false,
    lastSessionStats: null,
    projectStats: null,
    isGitRepo: true,
    currentAgent: null,
    reviewOptions: undefined,
  };

  switch (state) {
    case "running":
      return {
        ...base,
        session: mockSession,
        fixes: mockFixes.slice(0, 2),
        skipped: [],
        findings: mockFindings,
        latestReviewIteration: mockSession.iteration ?? null,
        totalFixes: mockFixes.length,
        totalSkipped: mockSkipped.length,
        maxIterations: 5,
        currentAgent: "reviewer",
        reviewOptions: mockReviewOptions,
      };

    case "codex":
      return {
        ...base,
        session: mockSession,
        fixes: mockFixes.slice(0, 1),
        skipped: [],
        findings: [],
        latestReviewIteration: mockSession.iteration ?? null,
        totalFixes: mockFixes.length,
        totalSkipped: mockSkipped.length,
        codexReviewText: mockCodexReviewText,
        maxIterations: 5,
        currentAgent: "fixer",
        reviewOptions: { customInstructions: "Focus on error handling and null safety" },
      };

    case "completed":
      return {
        ...base,
        session: mockCompletedSession,
        fixes: mockFixes,
        skipped: mockSkipped,
        findings: mockFindings.slice(0, 3),
        latestReviewIteration: mockCompletedSession.iteration ?? null,
        totalFixes: mockFixes.length,
        totalSkipped: mockSkipped.length,
        maxIterations: 5,
        currentAgent: null,
        reviewOptions: mockReviewOptions,
      };

    case "many": {
      const manyFindings = buildManyFindings(18);
      const manyFixes = buildManyFixes(10);
      const manySkipped = buildManySkipped(7);

      return {
        ...base,
        session: { ...mockSession, iteration: 4 },
        findings: manyFindings,
        latestReviewIteration: 4,
        fixes: manyFixes,
        skipped: manySkipped,
        totalFixes: 42,
        totalSkipped: 13,
        maxIterations: 6,
        currentAgent: "fixer",
        reviewOptions: { customInstructions: "Stress test layout and truncation behavior" },
      };
    }

    case "empty":
      return {
        ...base,
        lastSessionStats: null,
        projectStats: null,
      };

    case "loading":
      return {
        ...base,
        isLoading: true,
      };

    case "no-git":
      return {
        ...base,
        isGitRepo: false,
        lastSessionStats: mockLastSessionStats,
        projectStats: mockProjectStats,
      };

    default:
      return base;
  }
}

function buildMockActiveSession(overrides: Partial<ActiveSession>): ActiveSession {
  return {
    schemaVersion: 2,
    sessionId: "session-mock",
    sessionName: "rr-project-main",
    startTime: Date.now() - 30_000,
    lastHeartbeat: Date.now(),
    pid: 0,
    projectPath: "/Users/dev/project",
    branch: "main",
    state: "running",
    mode: "background",
    iteration: 1,
    currentAgent: "reviewer",
    sessionStatePath: "/tmp/rr-project-main.lock",
    sessionPath: "/tmp/rr-project-main.jsonl",
    ...overrides,
  };
}

interface WorkspaceMockGroup {
  group: SessionGroupData;
  data: MockData;
}

function buildWorkspaceMockGroups(): WorkspaceMockGroup[] {
  const currentRunning = buildMockActiveSession({
    sessionId: "current-running",
    sessionName: "rr-current-feature",
    state: "running",
  });
  const currentPending = buildMockActiveSession({
    sessionId: "current-pending",
    sessionName: "rr-current-hotfix",
    state: "pending",
  });
  const otherRunning = buildMockActiveSession({
    sessionId: "other-running",
    sessionName: "rr-api-main",
    projectPath: "/Users/dev/api-service",
    state: "running",
  });
  const otherCompleted = buildMockActiveSession({
    sessionId: "other-completed",
    sessionName: "rr-api-perf",
    projectPath: "/Users/dev/api-service",
    state: "completed",
  });
  const docsFailed = buildMockActiveSession({
    sessionId: "docs-failed",
    sessionName: "rr-docs-typos",
    projectPath: "/Users/dev/docs",
    state: "failed",
  });

  return [
    {
      group: {
        projectPath: "/Users/dev/project",
        projectName: "project",
        isCurrentProject: true,
        sessions: [currentRunning, currentPending],
      },
      data: getMockData("running"),
    },
    {
      group: {
        projectPath: "/Users/dev/api-service",
        projectName: "api-service",
        isCurrentProject: false,
        sessions: [otherRunning, otherCompleted],
      },
      data: getMockData("codex"),
    },
    {
      group: {
        projectPath: "/Users/dev/docs",
        projectName: "docs",
        isCurrentProject: false,
        sessions: [docsFailed],
      },
      data: getMockData("completed"),
    },
    {
      group: {
        projectPath: "/Users/dev/sandbox",
        projectName: "sandbox",
        isCurrentProject: false,
        sessions: [],
      },
      data: getMockData("empty"),
    },
  ];
}

function WorkspaceMockApp() {
  const mockGroups = useMemo(() => buildWorkspaceMockGroups(), []);
  const groups = useMemo(() => mockGroups.map((entry) => entry.group), [mockGroups]);
  const currentProjectPath = groups[0]?.projectPath ?? "/Users/dev/project";
  const [selectedGroupPath, setSelectedGroupPath] = useState(currentProjectPath);
  const [focusedPane, setFocusedPane] = useState<FocusedPane>("sidebar");
  const [outputVisible, setOutputVisible] = useState(false);

  const resolvedPath = resolveSelectedGroupPath(groups, selectedGroupPath, currentProjectPath);
  if (resolvedPath !== selectedGroupPath) {
    setSelectedGroupPath(resolvedPath);
  }

  const activeEntry =
    mockGroups.find((entry) => entry.group.projectPath === resolvedPath) ?? mockGroups[0];
  const activeData = activeEntry?.data ?? getMockData("empty");

  const handleKey = useCallback(
    (key: { name: string }) => {
      if (key.name === "q" || key.name === "escape") {
        process.exit(0);
      }
      if (key.name === "tab" || key.name === "right") {
        setFocusedPane((current) => cycleDashboardFocus(current, outputVisible));
        return;
      }
      if (key.name === "left") {
        setFocusedPane((current) => cycleDashboardFocusReverse(current, outputVisible));
        return;
      }
      if (key.name === "o") {
        setOutputVisible((current) => !current);
        return;
      }
      if (focusedPane === "sidebar" && groups.length >= 2) {
        if (key.name === "up" || key.name === "k") {
          setSelectedGroupPath((current) => selectAdjacentGroupPath(groups, current, "prev"));
          return;
        }
        if (key.name === "down" || key.name === "j") {
          setSelectedGroupPath((current) => selectAdjacentGroupPath(groups, current, "next"));
          return;
        }
      }
    },
    [focusedPane, groups, outputVisible]
  );

  useKeyboard(handleKey);

  return (
    <Workspace
      sessionGroups={groups}
      selectedGroupPath={resolvedPath}
      session={activeData.session}
      fixes={activeData.fixes}
      skipped={activeData.skipped}
      findings={activeData.findings}
      storedFindings={activeData.storedFindings}
      selectedFindingIds={activeData.selectedFindingIds}
      fixResults={activeData.fixResults}
      unresolvedSelectedFindings={activeData.unresolvedSelectedFindings}
      auditRegressionFindings={activeData.auditRegressionFindings}
      latestReviewIteration={activeData.latestReviewIteration}
      codexReviewText={activeData.codexReviewText}
      tmuxOutput={activeData.tmuxOutput}
      maxIterations={activeData.maxIterations}
      isLoading={activeData.isLoading}
      lastSessionStats={activeData.lastSessionStats}
      projectStats={activeData.projectStats}
      isGitRepo={activeData.isGitRepo}
      currentAgent={activeData.currentAgent}
      reviewOptions={activeData.reviewOptions}
      startupMode={null}
      isStopping={false}
      activeSessionCount={activeEntry?.group.sessions.length ?? 0}
      outputVisible={outputVisible}
      focusedPane={focusedPane}
    />
  );
}

async function main() {
  const state = parseState();

  console.log(`Rendering TUI dev preview with state: ${state}`);
  console.log("Press 'q' or Ctrl+C to exit\n");
  if (state === "workspace") {
    console.log(
      "Workspace mode: tab cycles focus, up/down or j/k navigate session groups when sidebar is focused.\n"
    );
  }

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  });

  if (state === "workspace") {
    createRoot(renderer).render(
      <SelectionCopyToastBoundary>
        <WorkspaceMockApp />
      </SelectionCopyToastBoundary>
    );
    return;
  }

  const mockData = getMockData(state);
  createRoot(renderer).render(
    <SelectionCopyToastBoundary>
      <DetailPane
        session={mockData.session}
        fixes={mockData.fixes}
        skipped={mockData.skipped}
        findings={mockData.findings}
        storedFindings={mockData.storedFindings ?? []}
        selectedFindingIds={mockData.selectedFindingIds ?? []}
        fixResults={mockData.fixResults ?? []}
        unresolvedSelectedFindings={mockData.unresolvedSelectedFindings ?? []}
        auditRegressionFindings={mockData.auditRegressionFindings ?? []}
        latestReviewIteration={mockData.latestReviewIteration}
        codexReviewText={mockData.codexReviewText}
        tmuxOutput={mockData.tmuxOutput}
        maxIterations={mockData.maxIterations}
        isLoading={mockData.isLoading}
        lastSessionStats={mockData.lastSessionStats}
        projectStats={mockData.projectStats}
        isGitRepo={mockData.isGitRepo}
        currentAgent={mockData.currentAgent}
        reviewOptions={mockData.reviewOptions}
        startupMode={null}
        isStopping={false}
        activeSessionCount={mockData.session ? 1 : 0}
        focused={true}
      />
    </SelectionCopyToastBoundary>
  );
}

main().catch(console.error);
