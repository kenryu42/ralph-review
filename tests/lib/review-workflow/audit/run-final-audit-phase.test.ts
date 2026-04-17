import { describe, expect, test } from "bun:test";
import type { GitSessionWorktree } from "@/lib/git";
import {
  type RunFinalAuditPhaseDependencies,
  runFinalAuditPhase,
} from "@/lib/review-workflow/audit/run-final-audit-phase";
import type { FindingsArtifact, StoredFinding } from "@/lib/review-workflow/findings/types";
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
    reviewedSnapshotRef: "snapshot-ref",
    reviewedSnapshotPath: "/tmp/reviewed",
    reviewedSnapshotFingerprint: "reviewed-fingerprint-1",
    handoffSnapshotPath: "/tmp/handoff",
    handoffSnapshotFingerprint: "handoff-fingerprint-1",
    sourceRepoFingerprint: "repo-fingerprint-1",
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

function getFirstFinding(findings: StoredFinding[]): StoredFinding {
  const firstFinding = findings[0];
  if (!firstFinding) {
    throw new Error("Expected at least one finding");
  }

  return firstFinding;
}

describe("review-workflow/audit/runFinalAuditPhase", () => {
  test("runs the final audit once and normalizes regression findings", async () => {
    const findings = [createFinding("F001"), createFinding("F002")];
    const artifact = createArtifact(findings);
    const appendedEntries: unknown[] = [];
    let runAgentCalls = 0;

    const result = await runFinalAuditPhase(
      {
        config: createConfig(),
        artifact,
        selection: {
          selectedFindingIds: ["F001"],
          selectedFindings: [getFirstFinding(findings)],
        },
        worktree: createWorktree(),
      },
      {
        createTargetedAuditPrompt: ({ changedFileHints, selectedFindings }) => {
          expect(changedFileHints).toEqual(["src/file-F001.ts @@ -10,0 +10,2 @@"]);
          expect(selectedFindings.map((finding) => finding.id)).toEqual(["F001"]);
          return "TARGETED_AUDIT_PROMPT";
        },
        createReviewerSummaryRetryReminder: () => "RETRY_PROMPT",
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
        } as unknown as RunFinalAuditPhaseDependencies["AGENTS"],
        runAgent: async (_role, _config, prompt, _timeout, _reviewOptions, cwd) => {
          runAgentCalls += 1;
          expect(prompt).toBe("TARGETED_AUDIT_PROMPT");
          expect(cwd).toBe("/tmp/workspace");
          return {
            success: true,
            output: `<<<RR_REVIEW_SUMMARY_JSON_START>>>
{"resolvedFindingIds":["F001"],"unresolvedFindingIds":[],"regressionFindings":[{"title":"New regression","body":"Fixer introduced a regression.","confidence_score":0.91,"priority":0,"code_location":{"absolute_file_path":"/tmp/workspace/src/new-regression.ts","line_range":{"start":4,"end":5}}}]}
<<<RR_REVIEW_SUMMARY_JSON_END>>>`,
            exitCode: 0,
            duration: 1,
          };
        },
        appendLog: async (_logPath, entry) => {
          appendedEntries.push(entry);
        },
        collectChangedFileHints: () => ["src/file-F001.ts @@ -10,0 +10,2 @@"],
      }
    );

    expect(runAgentCalls).toBe(1);
    expect(result.summary.resolvedFindingIds).toEqual(["F001"]);
    expect(result.summary.unresolvedFindingIds).toEqual([]);
    expect(result.summary.regressionFindings).toHaveLength(1);
    expect(result.summary.regressionFindings[0]?.id).toBe("F003");
    expect(appendedEntries).toHaveLength(1);
  });

  test("retries once when the first audit response is missing structured json", async () => {
    const findings = [createFinding("F001")];
    const artifact = createArtifact(findings);
    const prompts: string[] = [];
    let callCount = 0;

    const result = await runFinalAuditPhase(
      {
        config: createConfig(),
        artifact,
        selection: {
          selectedFindingIds: ["F001"],
          selectedFindings: [getFirstFinding(findings)],
        },
        worktree: createWorktree(),
      },
      {
        createTargetedAuditPrompt: () => "TARGETED_AUDIT_PROMPT",
        createReviewerSummaryRetryReminder: () => "RETRY_PROMPT",
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
        } as unknown as RunFinalAuditPhaseDependencies["AGENTS"],
        runAgent: async (_role, _config, prompt) => {
          prompts.push(prompt ?? "");
          callCount += 1;
          if (callCount === 1) {
            return {
              success: true,
              output: "not valid json",
              exitCode: 0,
              duration: 1,
            };
          }

          return {
            success: true,
            output: `<<<RR_REVIEW_SUMMARY_JSON_START>>>
{"resolvedFindingIds":["F001"],"unresolvedFindingIds":[],"regressionFindings":[]}
<<<RR_REVIEW_SUMMARY_JSON_END>>>`,
            exitCode: 0,
            duration: 1,
          };
        },
        appendLog: async () => {},
        collectChangedFileHints: () => [],
      }
    );

    expect(result.summary.resolvedFindingIds).toEqual(["F001"]);
    expect(result.summary.unresolvedFindingIds).toEqual([]);
    expect(prompts).toEqual(["TARGETED_AUDIT_PROMPT", "TARGETED_AUDIT_PROMPT\nRETRY_PROMPT"]);
  });
});
