import { AGENTS, runAgent } from "@/lib/agents";
import type { GitSessionWorktree } from "@/lib/git";
import { appendLog } from "@/lib/logging";
import {
  createReviewerSummaryRetryReminder,
  REVIEW_SUMMARY_END_TOKEN,
  REVIEW_SUMMARY_START_TOKEN,
} from "@/lib/prompts/protocol";
import { createTargetedAuditPrompt } from "@/lib/review-workflow/audit/prompt";
import type { FinalAuditPhaseResult } from "@/lib/review-workflow/audit/types";
import { mergeFindingsIntoInventory } from "@/lib/review-workflow/findings/inventory";
import type { FindingId, FindingsArtifact } from "@/lib/review-workflow/findings/types";
import type { RemediationSelection } from "@/lib/review-workflow/remediation/types";
import { parseFramedJson } from "@/lib/review-workflow/shared/framed-json";
import type { Config, Finding } from "@/lib/types";

interface TargetedAuditOutput {
  resolvedFindingIds: FindingId[];
  unresolvedFindingIds: FindingId[];
  regressionFindings: Finding[];
}

export interface RunFinalAuditPhaseOptions {
  config: Config;
  artifact: FindingsArtifact;
  selection: RemediationSelection;
  worktree: GitSessionWorktree;
}

export interface RunFinalAuditPhaseDependencies {
  createTargetedAuditPrompt: typeof createTargetedAuditPrompt;
  createReviewerSummaryRetryReminder: typeof createReviewerSummaryRetryReminder;
  AGENTS: typeof AGENTS;
  runAgent: typeof runAgent;
  appendLog: typeof appendLog;
  collectChangedFileHints: (reviewedSnapshotPath: string, mutableWorkspacePath: string) => string[];
}

const DEFAULT_RUN_FINAL_AUDIT_PHASE_DEPENDENCIES: RunFinalAuditPhaseDependencies = {
  createTargetedAuditPrompt,
  createReviewerSummaryRetryReminder,
  AGENTS,
  runAgent,
  appendLog,
  collectChangedFileHints,
};

function isFindingId(value: unknown): value is FindingId {
  return typeof value === "string" && /^F\d+$/u.test(value);
}

function isLineRange(value: unknown): value is Finding["code_location"]["line_range"] {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.start === "number" &&
    Number.isInteger(candidate.start) &&
    typeof candidate.end === "number" &&
    Number.isInteger(candidate.end) &&
    candidate.end >= candidate.start
  );
}

function isCodeLocation(value: unknown): value is Finding["code_location"] {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.absolute_file_path === "string" && isLineRange(candidate.line_range);
}

function isFinding(value: unknown): value is Finding {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.title === "string" &&
    typeof candidate.body === "string" &&
    typeof candidate.confidence_score === "number" &&
    candidate.confidence_score >= 0 &&
    candidate.confidence_score <= 1 &&
    (candidate.priority === undefined ||
      (typeof candidate.priority === "number" &&
        candidate.priority >= 0 &&
        candidate.priority <= 3)) &&
    isCodeLocation(candidate.code_location)
  );
}

function isTargetedAuditOutput(value: unknown): value is TargetedAuditOutput {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate.resolvedFindingIds) &&
    candidate.resolvedFindingIds.every(isFindingId) &&
    Array.isArray(candidate.unresolvedFindingIds) &&
    candidate.unresolvedFindingIds.every(isFindingId) &&
    Array.isArray(candidate.regressionFindings) &&
    candidate.regressionFindings.every(isFinding)
  );
}

function uniqueFindingIds(ids: FindingId[]): FindingId[] {
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}

function collectChangedFileHints(
  reviewedSnapshotPath: string,
  mutableWorkspacePath: string
): string[] {
  const result = Bun.spawnSync(
    [
      "git",
      "diff",
      "--no-index",
      "--no-renames",
      "--unified=0",
      reviewedSnapshotPath,
      mutableWorkspacePath,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  if (result.exitCode !== 0 && result.exitCode !== 1) {
    return [];
  }

  return result.stdout
    .toString()
    .split("\n")
    .map((line) =>
      line.replace(`${reviewedSnapshotPath}/`, "").replace(`${mutableWorkspacePath}/`, "").trim()
    )
    .filter((line) => line.startsWith("diff --git") || line.startsWith("@@"))
    .slice(0, 200);
}

function isStructuredJsonError(error: unknown): boolean {
  return (
    error instanceof Error && error.message === "Structured JSON output was missing or invalid."
  );
}

async function parseTargetedAuditOutput(
  agent: RunFinalAuditPhaseDependencies["AGENTS"][keyof RunFinalAuditPhaseDependencies["AGENTS"]],
  output: string
): Promise<TargetedAuditOutput> {
  const extractedText = await agent.extractResult(output);
  return parseFramedJson({
    extractedText,
    rawOutput: output,
    startToken: REVIEW_SUMMARY_START_TOKEN,
    endToken: REVIEW_SUMMARY_END_TOKEN,
    validate: isTargetedAuditOutput,
  });
}

export async function runFinalAuditPhase(
  options: RunFinalAuditPhaseOptions,
  deps: RunFinalAuditPhaseDependencies = DEFAULT_RUN_FINAL_AUDIT_PHASE_DEPENDENCIES
): Promise<FinalAuditPhaseResult> {
  const startedAt = Date.now();
  const changedFileHints = deps.collectChangedFileHints(
    options.artifact.reviewedSnapshotPath,
    options.worktree.agentProjectPath
  );

  try {
    const prompt = deps.createTargetedAuditPrompt({
      reviewedSnapshotPath: options.artifact.reviewedSnapshotPath,
      mutableWorkspacePath: options.worktree.agentProjectPath,
      selectedFindings: options.selection.selectedFindings,
      changedFileHints,
    });

    const runAudit = async (prompt: string) =>
      await deps.runAgent(
        "reviewer",
        options.config,
        prompt,
        options.config.iterationTimeout,
        undefined,
        options.worktree.agentProjectPath
      );

    let iterationResult = await runAudit(prompt);

    if (!iterationResult.success) {
      throw new Error(`Final audit reviewer failed with exit code ${iterationResult.exitCode}`);
    }

    const reviewerModule = deps.AGENTS[options.config.reviewer.agent];
    let parsed: TargetedAuditOutput;

    try {
      parsed = await parseTargetedAuditOutput(reviewerModule, iterationResult.output);
    } catch (error) {
      if (!isStructuredJsonError(error)) {
        throw error;
      }

      iterationResult = await runAudit(`${prompt}\n${deps.createReviewerSummaryRetryReminder()}`);
      if (!iterationResult.success) {
        throw new Error(`Final audit reviewer failed with exit code ${iterationResult.exitCode}`);
      }

      parsed = await parseTargetedAuditOutput(reviewerModule, iterationResult.output);
    }

    const selectedIdSet = new Set(options.selection.selectedFindingIds);
    const reportedIds = [...parsed.resolvedFindingIds, ...parsed.unresolvedFindingIds];
    const unexpectedIds = reportedIds.filter((findingId) => !selectedIdSet.has(findingId));
    if (unexpectedIds.length > 0) {
      throw new Error(`Final audit returned unexpected finding IDs: ${unexpectedIds.join(", ")}`);
    }

    const resolvedFindingIds = uniqueFindingIds(
      parsed.resolvedFindingIds.filter((findingId) => selectedIdSet.has(findingId))
    );
    const unresolvedFromOutput = parsed.unresolvedFindingIds.filter((findingId) =>
      selectedIdSet.has(findingId)
    );
    const unresolvedFindingIds = uniqueFindingIds([
      ...unresolvedFromOutput,
      ...options.selection.selectedFindingIds.filter(
        (findingId) => !resolvedFindingIds.includes(findingId)
      ),
    ]);
    const regressionFindings = mergeFindingsIntoInventory(
      options.artifact.findings,
      parsed.regressionFindings,
      {
        pathRoots: [
          options.artifact.projectPath,
          options.artifact.reviewedSnapshotPath,
          options.worktree.agentProjectPath,
        ],
      }
    ).newFindings;

    const summary = {
      resolvedFindingIds,
      unresolvedFindingIds,
      regressionFindings,
    };

    await deps.appendLog(options.artifact.logPath, {
      type: "final_audit",
      timestamp: Date.now(),
      duration: Date.now() - startedAt,
      selectedFindingIds: options.selection.selectedFindingIds,
      summary,
    });

    return {
      phase: "final-audit",
      sessionStatus: "completed",
      summary,
    };
  } catch (error) {
    await deps.appendLog(options.artifact.logPath, {
      type: "final_audit",
      timestamp: Date.now(),
      duration: Date.now() - startedAt,
      selectedFindingIds: options.selection.selectedFindingIds,
      summary: {
        resolvedFindingIds: [],
        unresolvedFindingIds: [...options.selection.selectedFindingIds],
        regressionFindings: [],
      },
      error: {
        phase: "reviewer",
        message: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}
