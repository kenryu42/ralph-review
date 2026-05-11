import { describe, expect, test } from "bun:test";
import type { FindingsArtifact, StoredFinding } from "@/lib/review-workflow/findings/types";
import { finalizeResult } from "@/lib/review-workflow/results/finalize-result";
import {
  createFindingsArtifact,
  createSessionWorktree,
  createStoredFinding,
} from "../../../helpers/review-workflow";

type FixResult = Parameters<typeof finalizeResult>[0]["fixResults"][number];

function createFixResult(
  findingId: FixResult["findingId"],
  status: FixResult["status"],
  summary: string
): FixResult {
  return { findingId, status, summary };
}

function getFirstFinding(artifact: FindingsArtifact): StoredFinding {
  const firstFinding = artifact.findings[0];
  if (!firstFinding) {
    throw new Error("Expected at least one finding");
  }

  return firstFinding;
}

async function finalizeWithBlockedHandoff(artifact: FindingsArtifact, fixResults: FixResult[]) {
  return await finalizeResult(
    {
      artifact,
      selection: {
        selectedFindingIds: fixResults.map((result) => result.findingId),
        selectedFindings: artifact.findings.filter((finding) =>
          fixResults.some((result) => result.findingId === finding.id)
        ),
      },
      fixResults,
      worktree: createSessionWorktree(),
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
}

async function finalizeWithCreatedHandoff(
  artifact: FindingsArtifact,
  fixResults: FixResult[],
  handoffStatus: "pending-apply" | "applied-auto"
) {
  const calls: string[] = [];
  const result = await finalizeResult(
    {
      artifact,
      selection: {
        selectedFindingIds: fixResults.map((fixResult) => fixResult.findingId),
        selectedFindings: artifact.findings.filter((finding) =>
          fixResults.some((fixResult) => fixResult.findingId === finding.id)
        ),
      },
      fixResults,
      worktree: createSessionWorktree(),
    },
    {
      createOrAutoApplyHandoff: async () => {
        calls.push("handoff");
        return {
          handoffId: "session-123-handoff-1",
          handoffStatus,
          commitSha: "commit-123",
          handoffUpdatedAt: 123,
        };
      },
      appendLog: async () => {
        calls.push("log");
      },
    }
  );

  return { calls, result };
}

describe("review-workflow/results/finalizeResult", () => {
  test("returns fixed-selected and creates a handoff when all selected findings are resolved", async () => {
    const artifact = createFindingsArtifact([
      createStoredFinding("F001"),
      createStoredFinding("F002"),
    ]);

    const { calls, result } = await finalizeWithCreatedHandoff(
      artifact,
      [createFixResult("F001", "resolved", "Resolved with a focused code change.")],
      "pending-apply"
    );

    expect(result.reviewOutcome).toBe("fixed-selected");
    expect(result.unresolvedSelectedFindings).toEqual([]);
    expect(result.unselectedFindings.map((finding) => finding.id)).toEqual(["F002"]);
    expect(result.handoffStatus).toBe("pending-apply");
    expect(result.handoffId).toBe("session-123-handoff-1");
    expect(calls).toEqual(["handoff", "log"]);
  });

  test("returns fixed-selected and creates a handoff when selected findings are resolved or skipped", async () => {
    const artifact = createFindingsArtifact([
      createStoredFinding("F001"),
      createStoredFinding("F002"),
    ]);

    const { calls, result } = await finalizeWithCreatedHandoff(
      artifact,
      [
        createFixResult("F001", "resolved", "Resolved with a focused code change."),
        createFixResult("F002", "skipped", "SKIP: false positive."),
      ],
      "applied-auto"
    );

    expect(result.reviewOutcome).toBe("fixed-selected");
    expect(result.unresolvedSelectedFindings).toEqual([]);
    expect(result.handoffStatus).toBe("applied-auto");
    expect(result.handoffId).toBe("session-123-handoff-1");
    expect(calls).toEqual(["handoff", "log"]);
  });

  test("returns fixed-selected without a handoff when selected findings are skipped only", async () => {
    const artifact = createFindingsArtifact([createStoredFinding("F001")]);

    const result = await finalizeWithBlockedHandoff(artifact, [
      createFixResult("F001", "skipped", "SKIP: not actionable."),
    ]);

    expect(result.reviewOutcome).toBe("fixed-selected");
    expect(result.reason).toBe("Selected findings were skipped after verification.");
    expect(result.unresolvedSelectedFindings).toEqual([]);
    expect(result.handoffStatus).toBeUndefined();
  });

  test("returns incomplete and skips handoff creation when selected findings are resolved and unresolved", async () => {
    const artifact = createFindingsArtifact([
      createStoredFinding("F001"),
      createStoredFinding("F002"),
    ]);

    const result = await finalizeWithBlockedHandoff(artifact, [
      createFixResult("F001", "resolved", "Resolved with a focused code change."),
      createFixResult("F002", "unresolved", "Could not safely finish remediation."),
    ]);

    expect(result.reviewOutcome).toBe("incomplete");
    expect(result.reason).toBe(
      "Some selected findings were resolved, but others remain unresolved. Ralph retained the remediation worktree instead of creating a handoff because the partial edits may be unsafe to apply automatically."
    );
    expect(result.unresolvedSelectedFindings.map((finding) => finding.id)).toEqual(["F002"]);
    expect(result.handoffStatus).toBeUndefined();
  });

  test("returns incomplete and skips handoff creation when no selected findings are resolved", async () => {
    const artifact = createFindingsArtifact([createStoredFinding("F001")]);

    const result = await finalizeWithBlockedHandoff(artifact, [
      createFixResult("F001", "unresolved", "Could not prove a safe remediation."),
    ]);

    expect(result.reviewOutcome).toBe("incomplete");
    expect(result.handoffStatus).toBeUndefined();
  });

  test("keeps a clean no-op remediation fixed-selected when no handoff is created", async () => {
    const artifact = createFindingsArtifact([createStoredFinding("F001")]);

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
        worktree: createSessionWorktree(),
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
