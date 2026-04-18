import { describe, expect, test } from "bun:test";
import type { GitSessionWorktree } from "@/lib/git";
import type { FindingsArtifact, StoredFinding } from "@/lib/review-workflow/findings/types";
import { finalizeResult } from "@/lib/review-workflow/results/finalize-result";

function createFinding(
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
    agentProjectPath: "/tmp/worktree",
    retainedBranch: "rr-worktree-session-123",
    headKind: "detached",
  };
}

function getFirstFinding(artifact: FindingsArtifact): StoredFinding {
  const firstFinding = artifact.findings[0];
  if (!firstFinding) {
    throw new Error("Expected at least one finding");
  }

  return firstFinding;
}

describe("review-workflow/results/finalizeResult", () => {
  test("returns fixed-selected and creates a handoff when all selected findings are resolved", async () => {
    const calls: string[] = [];
    const artifact = createArtifact([createFinding("F001"), createFinding("F002")]);

    const result = await finalizeResult(
      {
        artifact,
        selection: {
          selectedFindingIds: ["F001"],
          selectedFindings: [getFirstFinding(artifact)],
        },
        fixResults: [
          {
            findingId: "F001",
            status: "resolved",
            summary: "Resolved with a focused code change.",
          },
        ],
        worktree: createWorktree(),
      },
      {
        createOrAutoApplyHandoff: async () => {
          calls.push("handoff");
          return {
            handoffStatus: "pending-apply",
            commitSha: "commit-123",
            handoffUpdatedAt: 123,
          };
        },
        appendLog: async () => {
          calls.push("log");
        },
      }
    );

    expect(result.reviewOutcome).toBe("fixed-selected");
    expect(result.unresolvedSelectedFindings).toEqual([]);
    expect(result.unselectedFindings.map((finding) => finding.id)).toEqual(["F002"]);
    expect(result.handoffStatus).toBe("pending-apply");
    expect(calls).toEqual(["handoff", "log"]);
  });

  test("returns incomplete and skips handoff creation when any selected finding is unresolved", async () => {
    const artifact = createArtifact([createFinding("F001"), createFinding("F002")]);

    const result = await finalizeResult(
      {
        artifact,
        selection: {
          selectedFindingIds: ["F001", "F002"],
          selectedFindings: [...artifact.findings],
        },
        fixResults: [
          {
            findingId: "F001",
            status: "resolved",
            summary: "Resolved with a focused code change.",
          },
          {
            findingId: "F002",
            status: "unresolved",
            summary: "Could not prove a safe remediation.",
          },
        ],
        worktree: createWorktree(),
      },
      {
        createOrAutoApplyHandoff: async () => {
          throw new Error("handoff should not be created");
        },
        appendLog: async () => {
          throw new Error("handoff log should not be written");
        },
      }
    );

    expect(result.reviewOutcome).toBe("incomplete");
    expect(result.unresolvedSelectedFindings.map((finding) => finding.id)).toEqual(["F002"]);
    expect(result.handoffStatus).toBeUndefined();
  });

  test("keeps a clean no-op remediation fixed-selected when no handoff is created", async () => {
    const artifact = createArtifact([createFinding("F001")]);

    const result = await finalizeResult(
      {
        artifact,
        selection: {
          selectedFindingIds: ["F001"],
          selectedFindings: [getFirstFinding(artifact)],
        },
        fixResults: [
          {
            findingId: "F001",
            status: "resolved",
            summary: "Confirmed the finding was already resolved in the selected baseline.",
          },
        ],
        worktree: createWorktree(),
      },
      {
        createOrAutoApplyHandoff: async () => null,
        appendLog: async () => {
          throw new Error("handoff log should not be written");
        },
      }
    );

    expect(result.reviewOutcome).toBe("fixed-selected");
    expect(result.handoffStatus).toBeUndefined();
    expect(result.commitSha).toBeUndefined();
  });
});
