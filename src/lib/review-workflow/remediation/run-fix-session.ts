import * as p from "@clack/prompts";
import { CONFIG_DIR } from "@/lib/config";
import {
  createSessionWorktreeAt,
  discardSessionWorktree,
  finalizeSessionWorktree,
  type GitSessionWorktree,
  type RetainedSessionWorktree,
} from "@/lib/git";
import { appendLog } from "@/lib/logging";
import {
  appendFixResults,
  loadFindingsArtifactBySessionId,
  updateRetainedWorktree,
  updateSelection,
  validateArtifactBaseline,
} from "@/lib/review-workflow/findings/artifact";
import { selectFindings } from "@/lib/review-workflow/findings/selection";
import type { FindingId, FindingsArtifact } from "@/lib/review-workflow/findings/types";
import { runBatchFixPhase } from "@/lib/review-workflow/remediation/run-batch-fix-phase";
import type {
  FixSessionResult,
  RemediationSelection,
} from "@/lib/review-workflow/remediation/types";
import { finalizeResult } from "@/lib/review-workflow/results/finalize-result";
import type { SessionState } from "@/lib/session-state";
import type { Config, Priority, ReviewPhase } from "@/lib/types";

interface FixSessionSelector {
  all?: boolean;
  priorities?: Priority[];
  ids?: FindingId[];
}

export interface RunFixSessionOptions {
  sessionId: string;
  selector?: FixSessionSelector;
  isTTY: boolean;
  onProgress?: (updates: Partial<SessionState>) => Promise<void> | void;
}

export interface RunFixSessionDependencies {
  loadFindingsArtifactBySessionId: typeof loadFindingsArtifactBySessionId;
  validateArtifactBaseline: typeof validateArtifactBaseline;
  createSessionWorktreeAt: typeof createSessionWorktreeAt;
  updateSelection: typeof updateSelection;
  appendLog: typeof appendLog;
  promptForSelection: (artifact: FindingsArtifact) => Promise<FindingId[] | null>;
  runBatchFixPhase: (
    options: Parameters<typeof runBatchFixPhase>[0]
  ) => Promise<Awaited<ReturnType<typeof runBatchFixPhase>>>;
  appendFixResults: typeof appendFixResults;
  updateRetainedWorktree: typeof updateRetainedWorktree;
  finalizeResult: typeof finalizeResult;
  finalizeSessionWorktree: typeof finalizeSessionWorktree;
  discardSessionWorktree: typeof discardSessionWorktree;
}

async function defaultPromptForSelection(artifact: FindingsArtifact): Promise<FindingId[] | null> {
  const selection = await p.multiselect({
    message: "Choose findings to fix",
    options: artifact.findings.map((finding) => ({
      value: finding.id,
      label: `${finding.id} [${finding.priority}] ${finding.title}`,
      hint: `${finding.filePath}:${finding.startLine}-${finding.endLine}`,
    })),
    required: false,
  });

  if (p.isCancel(selection)) {
    return null;
  }

  return (selection as FindingId[]) ?? [];
}

const DEFAULT_RUN_FIX_SESSION_DEPENDENCIES: RunFixSessionDependencies = {
  loadFindingsArtifactBySessionId,
  validateArtifactBaseline,
  createSessionWorktreeAt,
  updateSelection,
  appendLog,
  promptForSelection: defaultPromptForSelection,
  runBatchFixPhase,
  appendFixResults,
  updateRetainedWorktree,
  finalizeResult,
  finalizeSessionWorktree,
  discardSessionWorktree,
};

function emptySelection(): RemediationSelection {
  return {
    selectedFindingIds: [],
    selectedFindings: [],
  };
}

function buildResult(overrides: Partial<FixSessionResult>): FixSessionResult {
  return {
    phase: "selection",
    sessionStatus: "failed",
    reviewOutcome: "incomplete",
    reason: "Remediation failed.",
    selection: emptySelection(),
    fixResults: [],
    unresolvedSelectedFindings: [],
    unselectedFindings: [],
    ...overrides,
  };
}

function buildRetainedCleanupWorktree(
  sourceWorktree: GitSessionWorktree,
  retainedWorktree: RetainedSessionWorktree
): GitSessionWorktree {
  return {
    ...sourceWorktree,
    worktreeProjectPath: retainedWorktree.worktreeProjectPath,
    agentProjectPath: retainedWorktree.worktreeProjectPath,
    retainedBranch: retainedWorktree.worktreeBranch,
    preserveBranchOnDiscard: false,
  };
}

function resolveSelectionMode(selector: FixSessionSelector | undefined): {
  mode: "all" | "priority" | "id" | "interactive";
  count: number;
} {
  const modeCount =
    (selector?.all === true ? 1 : 0) +
    ((selector?.priorities?.length ?? 0) > 0 ? 1 : 0) +
    ((selector?.ids?.length ?? 0) > 0 ? 1 : 0);

  if (selector?.all === true) {
    return { mode: "all", count: modeCount };
  }

  if ((selector?.priorities?.length ?? 0) > 0) {
    return { mode: "priority", count: modeCount };
  }

  if ((selector?.ids?.length ?? 0) > 0) {
    return { mode: "id", count: modeCount };
  }

  return { mode: "interactive", count: modeCount };
}

async function resolveSelection(
  artifact: FindingsArtifact,
  options: RunFixSessionOptions,
  deps: RunFixSessionDependencies
): Promise<{
  selection: RemediationSelection | null;
  mode: "all" | "priority" | "id";
  error?: string;
  cancelled?: boolean;
}> {
  const selectionMode = resolveSelectionMode(options.selector);
  if (selectionMode.count > 1) {
    return {
      selection: null,
      mode: "id",
      error: "Selector modes are mutually exclusive. Use only one of --all, --priority, or --id.",
    };
  }

  if (selectionMode.mode === "interactive") {
    if (!options.isTTY) {
      return {
        selection: null,
        mode: "id",
        error:
          "No selector was provided. Re-run with one of --all, --priority, or --id, or use an interactive terminal.",
      };
    }

    const promptSelection = await deps.promptForSelection(artifact);
    if (promptSelection === null) {
      return {
        selection: null,
        mode: "id",
        cancelled: true,
      };
    }

    return {
      selection: {
        selectedFindingIds: [...promptSelection].sort((left, right) => left.localeCompare(right)),
        selectedFindings: artifact.findings.filter((finding) =>
          promptSelection.includes(finding.id)
        ),
      },
      mode: "id",
    };
  }

  const request =
    selectionMode.mode === "all"
      ? { mode: "all" as const }
      : selectionMode.mode === "priority"
        ? { mode: "priority" as const, priorities: options.selector?.priorities ?? [] }
        : { mode: "id" as const, ids: options.selector?.ids ?? [] };

  const resolved = selectFindings(artifact.findings, request);
  if (selectionMode.mode === "id" && resolved.notFoundIds.length > 0) {
    return {
      selection: null,
      mode: selectionMode.mode,
      error: `Unknown finding IDs: ${resolved.notFoundIds.join(", ")}`,
    };
  }

  return {
    selection: {
      selectedFindingIds: resolved.selectedIds,
      selectedFindings: resolved.selectedFindings,
    },
    mode: selectionMode.mode,
  };
}

function getSelectedArtifactSelection(selection: RemediationSelection): FindingId[] {
  return [...selection.selectedFindingIds].sort((left, right) => left.localeCompare(right));
}

async function emitProgress(
  onProgress: RunFixSessionOptions["onProgress"],
  updates: Partial<SessionState>
): Promise<void> {
  await onProgress?.(updates);
}

export async function runFixSession(
  config: Config,
  options: RunFixSessionOptions,
  deps: RunFixSessionDependencies = DEFAULT_RUN_FIX_SESSION_DEPENDENCIES
): Promise<FixSessionResult> {
  let artifact: FindingsArtifact | null = null;
  let artifactForResult: FindingsArtifact | undefined;
  let worktree: GitSessionWorktree | null = null;
  let shouldDiscardWorktree = true;
  let phase: ReviewPhase = "selection";
  let selection = emptySelection();
  let fixResults: FixSessionResult["fixResults"] = [];
  let retainedWorktree: RetainedSessionWorktree | undefined;
  let result = buildResult({
    reason: `Findings artifact not found for session ${options.sessionId}.`,
  });

  try {
    artifact = await deps.loadFindingsArtifactBySessionId(CONFIG_DIR, options.sessionId);
    if (!artifact) {
      return result;
    }
    artifactForResult = artifact;

    const resolvedSelection = await resolveSelection(artifact, options, deps);
    if (resolvedSelection.error) {
      result = buildResult({
        artifact,
        unselectedFindings: [...artifact.findings],
        reason: resolvedSelection.error,
      });
      await emitProgress(options.onProgress, {
        currentPhase: result.phase,
        phase: result.phase,
        sessionStatus: result.sessionStatus,
        currentAgent: null,
        selectedFindingIds: result.selection.selectedFindingIds,
        reviewOutcome: result.reviewOutcome,
        handoffStatus: result.handoffStatus,
        handoffId: result.handoffId,
        handoffUpdatedAt: result.handoffUpdatedAt,
        commitSha: result.commitSha,
      });
      return result;
    }

    if (!resolvedSelection.selection || resolvedSelection.cancelled) {
      result = buildResult({
        artifact,
        phase: "selection",
        sessionStatus: "pending-user",
        reviewOutcome: "findings-pending",
        reason: "Selection cancelled. Findings remain pending.",
        unselectedFindings: [...artifact.findings],
      });
      await emitProgress(options.onProgress, {
        currentPhase: result.phase,
        phase: result.phase,
        sessionStatus: result.sessionStatus,
        currentAgent: null,
        selectedFindingIds: result.selection.selectedFindingIds,
        reviewOutcome: result.reviewOutcome,
        handoffStatus: result.handoffStatus,
        handoffId: result.handoffId,
        handoffUpdatedAt: result.handoffUpdatedAt,
        commitSha: result.commitSha,
      });
      return result;
    }

    const artifactWithSelection = await deps.updateSelection(
      CONFIG_DIR,
      artifact.projectPath,
      artifact.sessionId,
      getSelectedArtifactSelection(resolvedSelection.selection)
    );
    artifactForResult = artifactWithSelection;
    selection = resolvedSelection.selection;
    await deps.appendLog(artifact.logPath, {
      type: "finding_selection",
      timestamp: Date.now(),
      selectionMode: resolvedSelection.mode,
      selectedFindingIds: resolvedSelection.selection.selectedFindingIds,
    });
    await emitProgress(options.onProgress, {
      currentPhase: "selection",
      phase: "selection",
      sessionStatus: "running",
      currentAgent: null,
      selectedFindingIds: resolvedSelection.selection.selectedFindingIds,
    });

    if (resolvedSelection.selection.selectedFindingIds.length === 0) {
      result = buildResult({
        artifact: artifactWithSelection,
        phase: "selection",
        sessionStatus: "pending-user",
        reviewOutcome: "findings-pending",
        reason: "No findings were selected. Findings remain pending.",
        selection: resolvedSelection.selection,
        unselectedFindings: [...artifact.findings],
      });
      await emitProgress(options.onProgress, {
        currentPhase: result.phase,
        phase: result.phase,
        sessionStatus: result.sessionStatus,
        currentAgent: null,
        selectedFindingIds: result.selection.selectedFindingIds,
        reviewOutcome: result.reviewOutcome,
        handoffStatus: result.handoffStatus,
        handoffId: result.handoffId,
        handoffUpdatedAt: result.handoffUpdatedAt,
        commitSha: result.commitSha,
      });
      return result;
    }

    const validatedBaseline = await deps.validateArtifactBaseline(artifactWithSelection);
    const fixStartCommitSha =
      artifactWithSelection.retainedWorktree !== undefined
        ? artifactWithSelection.retainedWorktree.commitSha
        : validatedBaseline.baselineCommitSha;
    if (!fixStartCommitSha) {
      throw new Error("Retained remediation commit is missing");
    }

    worktree = deps.createSessionWorktreeAt(
      artifact.projectPath,
      `${artifact.sessionId}-fix`,
      fixStartCommitSha
    );
    worktree.baselineCommitSha = artifact.baselineCommitSha;
    worktree.baselineRef = artifact.baselineRef;
    worktree.sourceBaselineCommitSha = artifact.sourceBaselineCommitSha;
    worktree.sourceBaselineRef = artifact.sourceBaselineRef;
    worktree.sourceBaselineFingerprint = artifact.sourceBaselineFingerprint;
    worktree.remediationStartCommitSha = fixStartCommitSha;
    await emitProgress(options.onProgress, {
      currentPhase: "selection",
      phase: "selection",
      sessionStatus: "running",
      currentAgent: null,
      worktreeProjectPath: worktree.worktreeProjectPath,
      worktreeBranch: worktree.retainedBranch,
      baselineCommitSha: artifact.baselineCommitSha,
      sourceBaselineFingerprint: artifact.sourceBaselineFingerprint,
      selectedFindingIds: resolvedSelection.selection.selectedFindingIds,
    });

    phase = "batch-fix";
    await emitProgress(options.onProgress, {
      currentPhase: "batch-fix",
      phase: "batch-fix",
      sessionStatus: "running",
      currentAgent: "fixer",
      selectedFindingIds: resolvedSelection.selection.selectedFindingIds,
    });
    const batchFix = await deps.runBatchFixPhase({
      config,
      artifact: artifactWithSelection,
      selection: resolvedSelection.selection,
      worktree,
    });
    fixResults = batchFix.fixResults;

    const artifactWithFixResults = await deps.appendFixResults(
      CONFIG_DIR,
      artifact.projectPath,
      artifact.sessionId,
      batchFix.fixResults
    );
    artifactForResult = artifactWithFixResults;

    result = await deps.finalizeResult({
      artifact: artifactWithFixResults,
      selection: resolvedSelection.selection,
      fixResults: batchFix.fixResults,
      worktree,
    });

    if (result.reviewOutcome === "incomplete") {
      try {
        retainedWorktree = deps.finalizeSessionWorktree(worktree) ?? undefined;
      } catch {
        retainedWorktree = undefined;
      }

      if (retainedWorktree) {
        const artifactWithRetainedWorktree = await deps.updateRetainedWorktree(
          CONFIG_DIR,
          artifact.projectPath,
          artifact.sessionId,
          retainedWorktree
        );
        artifactForResult = artifactWithRetainedWorktree;
        shouldDiscardWorktree = false;
        result = {
          ...result,
          artifact: artifactWithRetainedWorktree,
          retainedWorktree,
        };
      }
    } else if (artifactWithFixResults.retainedWorktree) {
      deps.discardSessionWorktree(
        buildRetainedCleanupWorktree(worktree, artifactWithFixResults.retainedWorktree)
      );
      const artifactWithoutRetainedWorktree = await deps.updateRetainedWorktree(
        CONFIG_DIR,
        artifact.projectPath,
        artifact.sessionId,
        undefined
      );
      artifactForResult = artifactWithoutRetainedWorktree;
      result = {
        ...result,
        artifact: artifactWithoutRetainedWorktree,
      };
    }

    await emitProgress(options.onProgress, {
      currentPhase: result.phase,
      phase: result.phase,
      sessionStatus: result.sessionStatus,
      currentAgent: null,
      selectedFindingIds: result.selection.selectedFindingIds,
      reviewOutcome: result.reviewOutcome,
      handoffStatus: result.handoffStatus,
      handoffId: result.handoffId,
      handoffUpdatedAt: result.handoffUpdatedAt,
      commitSha: result.commitSha,
      worktreeProjectPath: result.retainedWorktree?.worktreeProjectPath,
      worktreeBranch: result.retainedWorktree?.worktreeBranch,
      worktreeMergeReady: result.retainedWorktree?.mergeReady,
      worktreeCommitSha: result.retainedWorktree?.commitSha,
    });
    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const resultArtifact = artifactForResult ?? artifact ?? undefined;
    const unresolvedFindingIds = new Set(
      fixResults
        .filter((fixResult) => fixResult.status === "unresolved")
        .map((fixResult) => fixResult.findingId)
    );
    result = buildResult({
      artifact: resultArtifact,
      phase,
      reason,
      selection,
      fixResults,
      retainedWorktree,
      unresolvedSelectedFindings: selection.selectedFindings.filter((finding) =>
        unresolvedFindingIds.has(finding.id)
      ),
      unselectedFindings:
        resultArtifact?.findings.filter(
          (finding) => !selection.selectedFindingIds.includes(finding.id)
        ) ?? [],
    });
    await emitProgress(options.onProgress, {
      currentPhase: phase,
      phase: phase,
      sessionStatus: result.sessionStatus,
      currentAgent: null,
      selectedFindingIds: result.selection.selectedFindingIds,
      reviewOutcome: result.reviewOutcome,
      handoffStatus: result.handoffStatus,
      handoffId: result.handoffId,
      handoffUpdatedAt: result.handoffUpdatedAt,
      commitSha: result.commitSha,
      worktreeProjectPath: retainedWorktree?.worktreeProjectPath,
      worktreeBranch: retainedWorktree?.worktreeBranch,
      worktreeMergeReady: retainedWorktree?.mergeReady,
      worktreeCommitSha: retainedWorktree?.commitSha,
    });
    return result;
  } finally {
    if (artifact) {
      await deps
        .appendLog(artifact.logPath, {
          type: "session_end",
          timestamp: Date.now(),
          status: result.sessionStatus === "failed" ? "failed" : "completed",
          reason: result.reason,
          iterations: 0,
          phase: result.phase as ReviewPhase,
          sessionStatus: result.sessionStatus,
          reviewOutcome: result.reviewOutcome,
          handoffStatus: result.handoffStatus,
          handoffId: result.handoffId,
          handoffUpdatedAt: result.handoffUpdatedAt,
          mergeReady: result.retainedWorktree?.mergeReady,
          commitSha: result.commitSha,
          worktreeBranch: result.retainedWorktree?.worktreeBranch,
          worktreeProjectPath: result.retainedWorktree?.worktreeProjectPath,
        })
        .catch(() => {});
    }

    if (worktree && shouldDiscardWorktree) {
      try {
        deps.discardSessionWorktree(worktree);
      } catch {
        // Best-effort cleanup; the remediation result is still returned.
      }
    }
  }
}
