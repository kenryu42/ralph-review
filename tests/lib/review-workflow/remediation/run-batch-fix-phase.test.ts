import { describe, expect, test } from "bun:test";
import type { GitCheckpoint, GitSessionWorktree } from "@/lib/git";
import type { FindingsArtifact, StoredFinding } from "@/lib/review-workflow/findings/types";
import {
  type RunBatchFixPhaseDependencies,
  runBatchFixPhase,
} from "@/lib/review-workflow/remediation/run-batch-fix-phase";
import { CONFIG_SCHEMA_URI, CONFIG_VERSION, type Config } from "@/lib/types";

function createFinding(id: StoredFinding["id"]): StoredFinding {
  return {
    id,
    fingerprint: `fp-${id}`,
    locationKey: `src/file-${id}.ts:10:12`,
    title: `Finding ${id}`,
    body: `Body for ${id}`,
    priority: "P1",
    confidenceScore: 0.91,
    filePath: `src/file-${id}.ts`,
    startLine: 10,
    endLine: 12,
  };
}

function createConfig(): Config {
  return {
    $schema: CONFIG_SCHEMA_URI,
    version: CONFIG_VERSION,
    reviewer: { agent: "claude" },
    fixer: { agent: "claude" },
    maxIterations: 3,
    iterationTimeout: 10,
    defaultReview: { type: "uncommitted" },
    notifications: { sound: { enabled: false } },
  };
}

function createArtifact(findings: StoredFinding[]): FindingsArtifact {
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
  };
}

function createWorktree(): GitSessionWorktree {
  return {
    sourceProjectPath: "/repo/project",
    sourceRepoPath: "/repo/project",
    worktreeProjectPath: "/tmp/worktree",
    agentProjectPath: "/tmp/workspace",
    retainedBranch: "rr-worktree-session-123",
    headKind: "detached",
  };
}

describe("review-workflow/remediation/runBatchFixPhase", () => {
  test("runs the fixer once and returns per-finding results", async () => {
    const findings = [createFinding("F001"), createFinding("F002")];
    const artifact = createArtifact(findings);
    const checkpoint: GitCheckpoint = {
      kind: "snapshot",
      id: "checkpoint-1",
      snapshotDir: "/tmp/checkpoint",
    };
    const appendedEntries: unknown[] = [];
    let runAgentCalls = 0;

    const result = await runBatchFixPhase(
      {
        config: createConfig(),
        artifact,
        selection: {
          selectedFindingIds: ["F001", "F002"],
          selectedFindings: findings,
        },
        worktree: createWorktree(),
      },
      {
        createBatchFixerPrompt: ({ baselineCommitSha, selectedFindings }) => {
          expect(baselineCommitSha).toBe("baseline-sha-123");
          expect(selectedFindings.map((finding) => finding.id)).toEqual(["F001", "F002"]);
          return "BATCH_FIX_PROMPT";
        },
        AGENTS: {
          claude: {
            config: {
              command: "mock",
              buildArgs: () => [],
              buildEnv: () => ({}),
            },
            extractResult: async (output: string) => output,
            detectSessionId: () => null,
            getUpdateInstructions: () => [],
          },
        } as unknown as RunBatchFixPhaseDependencies["AGENTS"],
        runAgent: async (_role, _config, prompt, _timeout, _reviewOptions, cwd) => {
          runAgentCalls += 1;
          expect(prompt).toBe("BATCH_FIX_PROMPT");
          expect(cwd).toBe("/tmp/workspace");
          return {
            success: true,
            output: `<<<RR_FIX_SUMMARY_JSON_START>>>
{"decision":"APPLY_SELECTIVELY","results":{"F001":{"status":"fixed","summary":"Applied guard"},"F002":{"status":"skipped","summary":"SKIP: insufficient evidence"}}}
<<<RR_FIX_SUMMARY_JSON_END>>>`,
            exitCode: 0,
            duration: 1,
          };
        },
        createCheckpoint: () => checkpoint,
        discardCheckpoint: (_projectPath, discardedCheckpoint) => {
          expect(discardedCheckpoint).toBe(checkpoint);
        },
        rollbackToCheckpoint: () => {
          throw new Error("rollback should not be called");
        },
        appendLog: async (_logPath, entry) => {
          appendedEntries.push(entry);
        },
      }
    );

    expect(runAgentCalls).toBe(1);
    expect(result.fixResults).toEqual([
      {
        findingId: "F001",
        status: "fixed",
        summary: "Applied guard",
      },
      {
        findingId: "F002",
        status: "skipped",
        summary: "SKIP: insufficient evidence",
      },
    ]);
    expect(appendedEntries).toHaveLength(1);
  });
});
