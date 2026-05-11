import type { AGENTS } from "@/lib/agents";
import type { GitSessionWorktree } from "@/lib/git";
import type { PendingHandoffArtifact } from "@/lib/handoff";
import type { FindingsArtifact, StoredFinding } from "@/lib/review-workflow/findings/types";
import {
  CONFIG_SCHEMA_URI,
  CONFIG_VERSION,
  type Config,
  type IterationResult,
  type ReviewSummary,
} from "@/lib/types";

export function createStoredFinding(
  id: StoredFinding["id"],
  priority: StoredFinding["priority"] = "P1"
): StoredFinding {
  return {
    id,
    fingerprint: `fp-${id}`,
    locationKey: `src/file-${id}.ts:10:12`,
    title: `Finding ${id}`,
    body: `Body for ${id}`,
    priority,
    confidenceScore: 0.91,
    filePath: `src/file-${id}.ts`,
    startLine: 10,
    endLine: 12,
  };
}

export function createFindingsArtifact(
  findings: StoredFinding[] = [
    createStoredFinding("F001", "P0"),
    createStoredFinding("F002", "P1"),
    createStoredFinding("F003", "P2"),
  ],
  overrides: Partial<FindingsArtifact> = {}
): FindingsArtifact {
  return {
    artifactVersion: 1,
    sessionId: "session-123",
    projectPath: "/repo/project",
    logPath: "/tmp/session-123.jsonl",
    baselineRef: "refs/ralph-review/sessions/session-123/baseline",
    baselineCommitSha: "baseline-sha-123",
    sourceBaselineRef: "refs/ralph-review/sessions/session-123/source",
    sourceBaselineCommitSha: "source-baseline-sha-123",
    sourceBaselineFingerprint: "tracked-fingerprint-1",
    findings,
    selectedFindingIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function createPendingHandoff(
  overrides: Partial<PendingHandoffArtifact> = {}
): PendingHandoffArtifact {
  const projectPath = process.cwd();
  return {
    handoffId: overrides.handoffId ?? overrides.sessionId ?? "session-id",
    sessionId: "session-id",
    projectPath,
    sourceRepoPath: projectPath,
    logPath: `${projectPath}/.ralph-review/logs/session.jsonl`,
    hiddenRef: "refs/ralph-review/sessions/session-id/final",
    patchPath: `${projectPath}/.ralph-review/handoffs/session-id.patch`,
    sourceBaselineFingerprint: "fingerprint-1",
    commitSha: "commit-sha-1",
    state: "pending-apply",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

export function createReviewWorkflowConfig(overrides: Partial<Config> = {}): Config {
  return {
    $schema: CONFIG_SCHEMA_URI,
    version: CONFIG_VERSION,
    reviewer: { agent: "claude" },
    fixer: { agent: "claude" },
    maxIterations: 3,
    iterationTimeout: 10,
    defaultReview: { type: "uncommitted" },
    notifications: { sound: { enabled: false } },
    ...overrides,
  };
}

export function createSessionWorktree(
  overrides: Partial<GitSessionWorktree> = {}
): GitSessionWorktree {
  return {
    sourceProjectPath: "/repo/project",
    sourceRepoPath: "/repo/project",
    worktreeProjectPath: "/tmp/worktree",
    agentProjectPath: "/tmp/worktree",
    retainedBranch: "rr-worktree-session-123",
    headKind: "detached",
    baselineCommitSha: "baseline-sha-123",
    baselineRef: "refs/ralph-review/sessions/session-123/baseline",
    sourceBaselineCommitSha: "source-baseline-sha-123",
    sourceBaselineRef: "refs/ralph-review/sessions/session-123/source",
    sourceBaselineFingerprint: "baseline-fingerprint",
    ...overrides,
  };
}

export function createMockAgentRegistry(agentTypes: Array<keyof typeof AGENTS> = ["claude"]) {
  return Object.fromEntries(
    agentTypes.map((agent) => [
      agent,
      {
        config: {
          command: "mock",
          buildArgs: () => [],
          buildEnv: () => ({}),
        },
        usesJsonl: false,
        extractResult: async (output: string) => output,
      },
    ])
  ) as unknown as typeof AGENTS;
}

export function createAgentResult(overrides: Partial<IterationResult> = {}): IterationResult {
  return {
    success: true,
    output: "",
    exitCode: 0,
    duration: 1,
    ...overrides,
  };
}

export function createReviewParse(value: ReviewSummary = createReviewSummary()) {
  return {
    ok: true as const,
    value,
    source: "framed-raw" as const,
    usedRepair: false,
    failureReason: null,
  };
}

export function createReviewFinding(
  overrides: Partial<ReviewSummary["findings"][number]> = {}
): ReviewSummary["findings"][number] {
  return {
    title: "Guard missing config",
    body: "A null check is missing before dereference.",
    confidence_score: 0.97,
    priority: 1,
    code_location: {
      absolute_file_path: "/repo/project/src/file.ts",
      line_range: {
        start: 10,
        end: 12,
      },
    },
    ...overrides,
  };
}

export function createReviewSummary(findings: ReviewSummary["findings"] = []): ReviewSummary {
  return {
    findings,
    overall_correctness: "patch is incorrect",
    overall_explanation: "Actionable findings remain.",
    overall_confidence_score: 0.91,
  };
}
