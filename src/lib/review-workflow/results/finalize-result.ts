import type { GitSessionWorktree } from "@/lib/git";
import { createOrAutoApplyHandoff } from "@/lib/handoff";
import { appendLog } from "@/lib/logging";
import type { FindingFixResult, FindingsArtifact } from "@/lib/review-workflow/findings/types";
import type {
  FixSessionResult,
  RemediationSelection,
} from "@/lib/review-workflow/remediation/types";

export interface FinalizeResultInput {
  artifact: FindingsArtifact;
  selection: RemediationSelection;
  fixResults: FindingFixResult[];
  worktree: GitSessionWorktree;
}

export interface FinalizeResultDependencies {
  createOrAutoApplyHandoff: typeof createOrAutoApplyHandoff;
  appendLog: typeof appendLog;
}

const DEFAULT_FINALIZE_RESULT_DEPENDENCIES: FinalizeResultDependencies = {
  createOrAutoApplyHandoff,
  appendLog,
};

export async function finalizeResult(
  input: FinalizeResultInput,
  deps: FinalizeResultDependencies = DEFAULT_FINALIZE_RESULT_DEPENDENCIES
): Promise<FixSessionResult> {
  const unresolvedSelectedFindingIds = new Set(
    input.fixResults
      .filter((result) => result.status === "unresolved")
      .map((result) => result.findingId)
  );
  const unresolvedSelectedFindings = input.selection.selectedFindings.filter((finding) =>
    unresolvedSelectedFindingIds.has(finding.id)
  );
  const unselectedFindings = input.artifact.findings.filter(
    (finding) => !input.selection.selectedFindingIds.includes(finding.id)
  );

  let reviewOutcome: FixSessionResult["reviewOutcome"];
  let reason: string;

  if (unresolvedSelectedFindings.length > 0) {
    reviewOutcome = "incomplete";
    reason = "Some selected findings remain unresolved after remediation.";
  } else {
    reviewOutcome = "fixed-selected";
    reason = "Selected findings were resolved by remediation.";
  }

  let handoffStatus: FixSessionResult["handoffStatus"];
  let handoffId: string | undefined;
  let handoffUpdatedAt: number | undefined;
  let commitSha: string | undefined;

  if (reviewOutcome === "fixed-selected") {
    const handoff = await deps.createOrAutoApplyHandoff(undefined, {
      sessionId: input.artifact.sessionId,
      projectPath: input.artifact.projectPath,
      logPath: input.artifact.logPath,
      worktree: input.worktree,
    });

    if (handoff) {
      handoffId = handoff.handoffId;
      handoffStatus = handoff.handoffStatus;
      handoffUpdatedAt = handoff.handoffUpdatedAt;
      commitSha = handoff.commitSha;

      await deps.appendLog(input.artifact.logPath, {
        type: "handoff",
        timestamp: handoff.handoffUpdatedAt,
        handoffId: handoff.handoffId,
        handoffStatus: handoff.handoffStatus,
        commitSha: handoff.commitSha,
      });
    }
  }

  return {
    phase: "complete",
    sessionStatus: "completed",
    reviewOutcome,
    reason,
    artifact: input.artifact,
    selection: input.selection,
    fixResults: input.fixResults,
    unresolvedSelectedFindings,
    unselectedFindings,
    handoffStatus,
    handoffId,
    handoffUpdatedAt,
    commitSha,
  };
}
