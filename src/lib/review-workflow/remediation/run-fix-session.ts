import { join } from "node:path";
import * as p from "@clack/prompts";
import { CONFIG_DIR } from "@/lib/config";
import {
  createSessionWorktree,
  discardSessionWorktree,
  finalizeSessionWorktree,
  type GitSessionWorktree,
  type RetainedSessionWorktree,
} from "@/lib/git";
import { appendLog, getProjectWorktreesDir } from "@/lib/logging";
import { runFinalAuditPhase } from "@/lib/review-workflow/audit/run-final-audit-phase";
import {
  appendFixResults,
  loadFindingsArtifactBySessionId,
  updateAuditSummary,
  updateSelection,
  validateArtifactSnapshots,
} from "@/lib/review-workflow/findings/artifact";
import { selectFindings } from "@/lib/review-workflow/findings/selection";
import type { FindingId, FindingsArtifact } from "@/lib/review-workflow/findings/types";
import { runBatchFixPhase } from "@/lib/review-workflow/remediation/run-batch-fix-phase";
import type {
  FixSessionResult,
  RemediationSelection,
} from "@/lib/review-workflow/remediation/types";
import { finalizeResult } from "@/lib/review-workflow/results/finalize-result";
import { copySnapshotDirectoryPreservingMetadata } from "@/lib/review-workflow/shared/snapshot";
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
  validateArtifactSnapshots: typeof validateArtifactSnapshots;
  createSessionWorktree: typeof createSessionWorktree;
  materializeSnapshotIntoWorkspace: (
    sourceSnapshotPath: string,
    destinationPath: string
  ) => Promise<void>;
  createSourceSnapshotCopy: (
    sourceSnapshotPath: string,
    sessionId: string,
    projectPath: string
  ) => Promise<string>;
  updateSelection: typeof updateSelection;
  appendLog: typeof appendLog;
  promptForSelection: (artifact: FindingsArtifact) => Promise<FindingId[] | null>;
  runBatchFixPhase: (
    options: Parameters<typeof runBatchFixPhase>[0]
  ) => Promise<Awaited<ReturnType<typeof runBatchFixPhase>>>;
  appendFixResults: typeof appendFixResults;
  runFinalAuditPhase: (
    options: Parameters<typeof runFinalAuditPhase>[0]
  ) => Promise<Awaited<ReturnType<typeof runFinalAuditPhase>>>;
  updateAuditSummary: typeof updateAuditSummary;
  finalizeResult: typeof finalizeResult;
  finalizeSessionWorktree: typeof finalizeSessionWorktree;
  discardSessionWorktree: typeof discardSessionWorktree;
}

function assertCommandSucceeded(result: ReturnType<typeof Bun.spawnSync>, context: string): void {
  if (result.exitCode === 0) {
    return;
  }

  const stderr = result.stderr ? result.stderr.toString().trim() : "";
  const stdout = result.stdout ? result.stdout.toString().trim() : "";
  throw new Error(`${context}: ${stderr || stdout || "command failed"}`);
}

async function defaultMaterializeSnapshotIntoWorkspace(
  sourceSnapshotPath: string,
  destinationPath: string
): Promise<void> {
  const clearResult = Bun.spawnSync(
    [
      "find",
      destinationPath,
      "-mindepth",
      "1",
      "-maxdepth",
      "1",
      "!",
      "-name",
      ".git",
      "-exec",
      "rm",
      "-rf",
      "{}",
      "+",
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  assertCommandSucceeded(clearResult, `Failed to clear mutable workspace at ${destinationPath}`);
  copySnapshotDirectoryPreservingMetadata(sourceSnapshotPath, destinationPath);
}

async function defaultCreateSourceSnapshotCopy(
  sourceSnapshotPath: string,
  sessionId: string,
  projectPath: string
): Promise<string> {
  const destinationPath = join(
    getProjectWorktreesDir(CONFIG_DIR, projectPath),
    `${sessionId}-source-snapshot-${Date.now()}-${crypto.randomUUID()}`
  );
  copySnapshotDirectoryPreservingMetadata(sourceSnapshotPath, destinationPath);
  return destinationPath;
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
  validateArtifactSnapshots,
  createSessionWorktree,
  materializeSnapshotIntoWorkspace: defaultMaterializeSnapshotIntoWorkspace,
  createSourceSnapshotCopy: defaultCreateSourceSnapshotCopy,
  updateSelection,
  appendLog,
  promptForSelection: defaultPromptForSelection,
  runBatchFixPhase,
  appendFixResults,
  runFinalAuditPhase,
  updateAuditSummary,
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

function isStructuredJsonError(error: unknown): boolean {
  return (
    error instanceof Error && error.message === "Structured JSON output was missing or invalid."
  );
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
  let audit: FixSessionResult["audit"];
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
        latestAudit: result.audit,
        handoffStatus: result.handoffStatus,
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
        latestAudit: result.audit,
        handoffStatus: result.handoffStatus,
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
        latestAudit: result.audit,
        handoffStatus: result.handoffStatus,
        handoffUpdatedAt: result.handoffUpdatedAt,
        commitSha: result.commitSha,
      });
      return result;
    }

    await deps.validateArtifactSnapshots(artifactWithSelection);

    worktree = deps.createSessionWorktree(artifact.projectPath, `${artifact.sessionId}-fix`);
    await deps.materializeSnapshotIntoWorkspace(
      artifact.reviewedSnapshotPath,
      worktree.agentProjectPath
    );
    worktree.sourceFingerprint = artifact.sourceRepoFingerprint;
    worktree.sourceSnapshotPath = await deps.createSourceSnapshotCopy(
      artifact.handoffSnapshotPath,
      artifact.sessionId,
      artifact.projectPath
    );
    await emitProgress(options.onProgress, {
      currentPhase: "selection",
      phase: "selection",
      sessionStatus: "running",
      currentAgent: null,
      worktreeProjectPath: worktree.worktreeProjectPath,
      worktreeBranch: worktree.retainedBranch,
      sourceRepoFingerprint: artifact.sourceRepoFingerprint,
      reviewedSnapshotPath: artifact.reviewedSnapshotPath,
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

    phase = "final-audit";
    await emitProgress(options.onProgress, {
      currentPhase: "final-audit",
      phase: "final-audit",
      sessionStatus: "running",
      currentAgent: "reviewer",
      selectedFindingIds: resolvedSelection.selection.selectedFindingIds,
    });
    const auditPhase = await deps.runFinalAuditPhase({
      config,
      artifact: artifactWithFixResults,
      selection: resolvedSelection.selection,
      worktree,
    });
    audit = auditPhase.summary;

    const artifactWithAudit = await deps.updateAuditSummary(
      CONFIG_DIR,
      artifact.projectPath,
      artifact.sessionId,
      auditPhase.summary
    );
    artifactForResult = artifactWithAudit;

    result = await deps.finalizeResult({
      artifact: artifactWithAudit,
      selection: resolvedSelection.selection,
      fixResults: batchFix.fixResults,
      audit: auditPhase.summary,
      worktree,
    });
    await emitProgress(options.onProgress, {
      currentPhase: result.phase,
      phase: result.phase,
      sessionStatus: result.sessionStatus,
      currentAgent: null,
      selectedFindingIds: result.selection.selectedFindingIds,
      latestAudit: result.audit,
      reviewOutcome: result.reviewOutcome,
      handoffStatus: result.handoffStatus,
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
    if (worktree && phase === "final-audit" && isStructuredJsonError(error)) {
      try {
        retainedWorktree = deps.finalizeSessionWorktree(worktree) ?? undefined;
        if (retainedWorktree) {
          shouldDiscardWorktree = false;
        }
      } catch {
        retainedWorktree = undefined;
      }
    }

    const resultArtifact = artifactForResult ?? artifact ?? undefined;
    result = buildResult({
      artifact: resultArtifact,
      phase,
      reason,
      selection,
      fixResults,
      audit,
      retainedWorktree,
      unresolvedSelectedFindings: selection.selectedFindings.filter(
        (finding) => audit?.unresolvedFindingIds.includes(finding.id) === true
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
      latestAudit: result.audit,
      reviewOutcome: result.reviewOutcome,
      handoffStatus: result.handoffStatus,
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
