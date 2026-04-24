import { AGENTS, runAgent } from "@/lib/agents";
import {
  createCheckpoint,
  discardCheckpoint,
  type GitSessionWorktree,
  rollbackToCheckpoint,
} from "@/lib/git";
import { appendLog } from "@/lib/logging";
import { FIX_SUMMARY_END_TOKEN, FIX_SUMMARY_START_TOKEN } from "@/lib/prompts/protocol";
import type {
  FindingFixResult,
  FindingId,
  FindingsArtifact,
} from "@/lib/review-workflow/findings/types";
import { createBatchFixerPrompt } from "@/lib/review-workflow/remediation/prompt";
import type { BatchFixResult, RemediationSelection } from "@/lib/review-workflow/remediation/types";
import { parseFramedJson } from "@/lib/review-workflow/shared/framed-json";
import type { Config } from "@/lib/types";
import type { FixDecision } from "@/lib/types/domain";

interface BatchFixerResultEntry {
  status: "resolved" | "unresolved";
  summary: string;
}

interface BatchFixerOutput {
  decision: FixDecision;
  results: Record<string, BatchFixerResultEntry>;
}

export interface RunBatchFixPhaseOptions {
  config: Config;
  artifact: FindingsArtifact;
  selection: RemediationSelection;
  worktree: GitSessionWorktree;
}

export interface RunBatchFixPhaseDependencies {
  createBatchFixerPrompt: typeof createBatchFixerPrompt;
  AGENTS: typeof AGENTS;
  runAgent: typeof runAgent;
  createCheckpoint: typeof createCheckpoint;
  discardCheckpoint: typeof discardCheckpoint;
  rollbackToCheckpoint: typeof rollbackToCheckpoint;
  appendLog: typeof appendLog;
}

const DEFAULT_RUN_BATCH_FIX_PHASE_DEPENDENCIES: RunBatchFixPhaseDependencies = {
  createBatchFixerPrompt,
  AGENTS,
  runAgent,
  createCheckpoint,
  discardCheckpoint,
  rollbackToCheckpoint,
  appendLog,
};

function isFindingId(value: string): value is FindingId {
  return /^F\d+$/u.test(value);
}

function isBatchFixerResultEntry(value: unknown): value is BatchFixerResultEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    (candidate.status === "resolved" || candidate.status === "unresolved") &&
    typeof candidate.summary === "string"
  );
}

function isBatchFixerOutput(value: unknown): value is BatchFixerOutput {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (
    candidate.decision !== "NO_CHANGES_NEEDED" &&
    candidate.decision !== "APPLY_SELECTIVELY" &&
    candidate.decision !== "APPLY_MOST"
  ) {
    return false;
  }

  if (typeof candidate.results !== "object" || candidate.results === null) {
    return false;
  }

  return Object.entries(candidate.results).every(([findingId, entry]) => {
    return isFindingId(findingId) && isBatchFixerResultEntry(entry);
  });
}

function toFixResults(
  selectedFindingIds: FindingId[],
  parsed: BatchFixerOutput
): FindingFixResult[] {
  const selectedIdSet = new Set(selectedFindingIds);
  const unexpectedIds = Object.keys(parsed.results).filter(
    (findingId) => !selectedIdSet.has(findingId as FindingId)
  );
  if (unexpectedIds.length > 0) {
    throw new Error(`Fixer returned unexpected finding IDs: ${unexpectedIds.join(", ")}`);
  }

  return selectedFindingIds.map((findingId) => {
    const entry = parsed.results[findingId];
    if (!entry) {
      return {
        findingId,
        status: "unresolved",
        summary: `Fixer did not return a result for ${findingId}.`,
      };
    }

    return {
      findingId,
      status: entry.status,
      summary: entry.summary.trim(),
    };
  });
}

export async function runBatchFixPhase(
  options: RunBatchFixPhaseOptions,
  deps: RunBatchFixPhaseDependencies = DEFAULT_RUN_BATCH_FIX_PHASE_DEPENDENCIES
): Promise<BatchFixResult> {
  const checkpoint = deps.createCheckpoint(
    options.worktree.worktreeProjectPath,
    `${options.artifact.sessionId}-batch-fix`
  );
  const startedAt = Date.now();

  try {
    const prompt = deps.createBatchFixerPrompt({
      baselineCommitSha: options.artifact.baselineCommitSha,
      remediationStartCommitSha:
        options.worktree.remediationStartCommitSha ?? options.artifact.baselineCommitSha,
      mutableWorkspacePath: options.worktree.agentProjectPath,
      selectedFindings: options.selection.selectedFindings,
    });

    const iterationResult = await deps.runAgent(
      "fixer",
      options.config,
      prompt,
      options.config.iterationTimeout,
      undefined,
      options.worktree.agentProjectPath
    );

    if (!iterationResult.success) {
      throw new Error(`Fixer failed with exit code ${iterationResult.exitCode}`);
    }

    const fixerModule = deps.AGENTS[options.config.fixer.agent];
    const extractedText = await fixerModule.extractResult(iterationResult.output);
    const parsed = parseFramedJson({
      extractedText,
      rawOutput: iterationResult.output,
      startToken: FIX_SUMMARY_START_TOKEN,
      endToken: FIX_SUMMARY_END_TOKEN,
      validate: isBatchFixerOutput,
    });
    const fixResults = toFixResults(options.selection.selectedFindingIds, parsed);

    deps.discardCheckpoint(options.worktree.worktreeProjectPath, checkpoint);
    await deps.appendLog(options.artifact.logPath, {
      type: "batch_fix",
      timestamp: Date.now(),
      duration: Date.now() - startedAt,
      selectedFindingIds: options.selection.selectedFindingIds,
      fixResults,
    });

    return {
      phase: "batch-fix",
      sessionStatus: "completed",
      fixResults,
    };
  } catch (error) {
    deps.rollbackToCheckpoint(options.worktree.worktreeProjectPath, checkpoint);
    await deps.appendLog(options.artifact.logPath, {
      type: "batch_fix",
      timestamp: Date.now(),
      duration: Date.now() - startedAt,
      selectedFindingIds: options.selection.selectedFindingIds,
      fixResults: [],
      error: {
        phase: "fixer",
        message: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}
