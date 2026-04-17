import { describe, expect, test } from "bun:test";
import type { GitSessionWorktree } from "@/lib/git";
import type {
  AuditSummary,
  FindingsArtifact,
  StoredFinding,
} from "@/lib/review-workflow/findings/types";
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
  test("returns fixed-selected and creates a handoff when the audit is clean", async () => {
    const calls: string[] = [];
    const artifact = createArtifact([createFinding("F001"), createFinding("F002")]);
    const audit: AuditSummary = {
      resolvedFindingIds: ["F001"],
      unresolvedFindingIds: [],
      regressionFindings: [],
    };

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
            status: "fixed",
            summary: "Applied fix",
          },
        ],
        audit,
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

  test("returns audit-regressions and skips handoff creation when the audit finds regressions", async () => {
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
            status: "fixed",
            summary: "Applied fix",
          },
        ],
        audit: {
          resolvedFindingIds: ["F001"],
          unresolvedFindingIds: [],
          regressionFindings: [createFinding("F900", "P0")],
        },
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

    expect(result.reviewOutcome).toBe("audit-regressions");
    expect(result.handoffStatus).toBeUndefined();
  });

  test("returns incomplete when selected findings remain unresolved", async () => {
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
            status: "fixed",
            summary: "Applied fix",
          },
          {
            findingId: "F002",
            status: "skipped",
            summary: "SKIP: insufficient evidence",
          },
        ],
        audit: {
          resolvedFindingIds: ["F001"],
          unresolvedFindingIds: ["F002"],
          regressionFindings: [],
        },
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
  });
});
