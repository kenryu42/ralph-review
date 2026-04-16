import { join } from "node:path";
import * as p from "@clack/prompts";
import { CONFIG_DIR } from "@/lib/config";
import { createSessionWorktree, discardSessionWorktree, type GitSessionWorktree } from "@/lib/git";
import { appendLog, getProjectWorktreesDir } from "@/lib/logging";
import { runFinalAuditPhase } from "@/lib/review-workflow/audit/run-final-audit-phase";
import {
  appendFixResults,
  loadFindingsArtifactBySessionId,
  updateAuditSummary,
  updateSelection,
  validateArtifactSnapshot,
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
  validateArtifactSnapshot: typeof validateArtifactSnapshot;
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
  discardSessionWorktree: typeof discardSessionWorktree;
}

async function listRelativeFiles(rootPath: string): Promise<string[]> {
  const glob = new Bun.Glob("**/*");
  const relativeFiles: string[] = [];

  for await (const relativePath of glob.scan({ cwd: rootPath, onlyFiles: true })) {
    relativeFiles.push(relativePath);
  }

  relativeFiles.sort((left, right) => left.localeCompare(right));
  return relativeFiles;
}

function assertCommandSucceeded(result: ReturnType<typeof Bun.spawnSync>, context: string): void {
  if (result.exitCode === 0) {
    return;
  }

  const stderr = result.stderr ? result.stderr.toString().trim() : "";
  const stdout = result.stdout ? result.stdout.toString().trim() : "";
  throw new Error(`${context}: ${stderr || stdout || "command failed"}`);
}

async function copySnapshotDirectory(sourcePath: string, destinationPath: string): Promise<void> {
  for (const relativePath of await listRelativeFiles(sourcePath)) {
    const sourceFile = Bun.file(join(sourcePath, relativePath));
    await Bun.write(join(destinationPath, relativePath), await sourceFile.arrayBuffer(), {
      createPath: true,
    });
  }
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
  await copySnapshotDirectory(sourceSnapshotPath, destinationPath);
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
  await copySnapshotDirectory(sourceSnapshotPath, destinationPath);
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
  validateArtifactSnapshot,
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

export async function runFixSession(
  config: Config,
  options: RunFixSessionOptions,
  deps: RunFixSessionDependencies = DEFAULT_RUN_FIX_SESSION_DEPENDENCIES
): Promise<FixSessionResult> {
  let artifact: FindingsArtifact | null = null;
  let worktree: GitSessionWorktree | null = null;
  let result = buildResult({
    reason: `Findings artifact not found for session ${options.sessionId}.`,
  });

  try {
    artifact = await deps.loadFindingsArtifactBySessionId(CONFIG_DIR, options.sessionId);
    if (!artifact) {
      return result;
    }

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

    await deps.validateArtifactSnapshot(artifactWithSelection);

    worktree = deps.createSessionWorktree(artifact.projectPath, `${artifact.sessionId}-fix`);
    await deps.materializeSnapshotIntoWorkspace(
      artifact.reviewedSnapshotPath,
      worktree.agentProjectPath
    );
    worktree.sourceFingerprint = artifact.sourceFingerprint;
    worktree.sourceSnapshotPath = await deps.createSourceSnapshotCopy(
      artifact.reviewedSnapshotPath,
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
      sourceFingerprint: artifact.sourceFingerprint,
      reviewedSnapshotPath: artifact.reviewedSnapshotPath,
      selectedFindingIds: resolvedSelection.selection.selectedFindingIds,
    });

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

    const artifactWithFixResults = await deps.appendFixResults(
      CONFIG_DIR,
      artifact.projectPath,
      artifact.sessionId,
      batchFix.fixResults
    );

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

    const artifactWithAudit = await deps.updateAuditSummary(
      CONFIG_DIR,
      artifact.projectPath,
      artifact.sessionId,
      auditPhase.summary
    );

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
    });
    return result;
  } catch (error) {
    result = buildResult({
      artifact: artifact ?? undefined,
      reason: error instanceof Error ? error.message : String(error),
      unselectedFindings: artifact?.findings ?? [],
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
          commitSha: result.commitSha,
        })
        .catch(() => {});
    }

    if (worktree) {
      try {
        deps.discardSessionWorktree(worktree);
      } catch {
        // Best-effort cleanup; the remediation result is still returned.
      }
    }
  }
}
