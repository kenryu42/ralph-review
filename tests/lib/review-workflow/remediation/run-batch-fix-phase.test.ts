import { describe, expect, test } from "bun:test";
import type { GitCheckpoint } from "@/lib/git";
import { runBatchFixPhase } from "@/lib/review-workflow/remediation/run-batch-fix-phase";
import {
  createAgentResult,
  createFindingsArtifact,
  createMockAgentRegistry,
  createReviewWorkflowConfig,
  createSessionWorktree,
  createStoredFinding,
} from "../../../helpers/review-workflow";

describe("review-workflow/remediation/runBatchFixPhase", () => {
  test("runs the fixer once and returns per-finding results", async () => {
    const findings = [createStoredFinding("F001"), createStoredFinding("F002")];
    const artifact = createFindingsArtifact(findings);
    const checkpoint: GitCheckpoint = {
      kind: "snapshot",
      id: "checkpoint-1",
      snapshotDir: "/tmp/checkpoint",
    };
    const appendedEntries: unknown[] = [];
    let runAgentCalls = 0;

    const result = await runBatchFixPhase(
      {
        config: createReviewWorkflowConfig(),
        artifact,
        selection: {
          selectedFindingIds: ["F001", "F002"],
          selectedFindings: findings,
        },
        worktree: createSessionWorktree({ agentProjectPath: "/tmp/workspace" }),
      },
      {
        createBatchFixerPrompt: ({
          baselineCommitSha,
          remediationStartCommitSha,
          selectedFindings,
        }) => {
          expect(baselineCommitSha).toBe("baseline-sha-123");
          expect(remediationStartCommitSha).toBe("baseline-sha-123");
          expect(selectedFindings.map((finding) => finding.id)).toEqual(["F001", "F002"]);
          return "BATCH_FIX_PROMPT";
        },
        AGENTS: createMockAgentRegistry(),
        runAgent: async (_role, _config, prompt, _timeout, _reviewOptions, cwd) => {
          runAgentCalls += 1;
          expect(prompt).toBe("BATCH_FIX_PROMPT");
          expect(cwd).toBe("/tmp/workspace");
          return createAgentResult({
            output: `<<<RR_FIX_SUMMARY_JSON_START>>>
{"decision":"APPLY_SELECTIVELY","results":{"F001":{"status":"resolved","summary":"Applied guard"},"F002":{"status":"skipped","summary":"SKIP: insufficient evidence"}}}
<<<RR_FIX_SUMMARY_JSON_END>>>`,
          });
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
        status: "resolved",
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

  test("rejects unknown fixer result statuses", async () => {
    const findings = [createStoredFinding("F001")];
    const checkpoint: GitCheckpoint = {
      kind: "snapshot",
      id: "checkpoint-1",
      snapshotDir: "/tmp/checkpoint",
    };

    await expect(
      runBatchFixPhase(
        {
          config: createReviewWorkflowConfig(),
          artifact: createFindingsArtifact(findings),
          selection: {
            selectedFindingIds: ["F001"],
            selectedFindings: findings,
          },
          worktree: createSessionWorktree({ agentProjectPath: "/tmp/workspace" }),
        },
        {
          createBatchFixerPrompt: () => "BATCH_FIX_PROMPT",
          AGENTS: createMockAgentRegistry(),
          runAgent: async () =>
            createAgentResult({
              output: `<<<RR_FIX_SUMMARY_JSON_START>>>
{"decision":"APPLY_SELECTIVELY","results":{"F001":{"status":"fixed","summary":"Applied guard"}}}
<<<RR_FIX_SUMMARY_JSON_END>>>`,
            }),
          createCheckpoint: () => checkpoint,
          discardCheckpoint: () => {
            throw new Error("discard should not be called");
          },
          rollbackToCheckpoint: () => {},
          appendLog: async () => {},
        }
      )
    ).rejects.toThrow("Structured JSON output was missing or invalid.");
  });
});
