import type {
  DiscoveryIterationResult,
  DiscoveryPhaseResult,
} from "@/lib/review-workflow/discovery/types";
import { mergeFindingsIntoInventory } from "@/lib/review-workflow/findings/inventory";
import type { StoredFinding } from "@/lib/review-workflow/findings/types";
import type { Config, ReviewOptions } from "@/lib/types";

interface RunDiscoveryPhaseOptions {
  config: Config;
  reviewOptions?: ReviewOptions;
  sessionId?: string;
  projectPath: string;
  findingPathRoots: string[];
  sessionPath: string;
  reviewerWorktreePath: string;
  baselineFingerprint: string;
  runReviewerIteration: (
    iteration: number,
    knownFindings: StoredFinding[]
  ) => Promise<{
    findings: ReviewSummaryLike["findings"];
    duration: number;
  }>;
  appendLog: (logPath: string, entry: DiscoveryIterationLogEntry) => Promise<void>;
  updateSessionState: (
    storageRoot: string | undefined,
    projectPath: string,
    sessionId: string,
    updates: Record<string, unknown>,
    options?: { expectedSessionId?: string }
  ) => Promise<boolean>;
  computeWorkingTreeFingerprint: (repoPath: string) => Promise<string>;
  wasInterrupted: () => boolean;
}

interface DiscoveryIterationLogEntry extends DiscoveryIterationResult {
  type: "discovery_iteration";
  timestamp: number;
  iteration: number;
  duration?: number;
}

interface ReviewSummaryLike {
  findings: Array<{
    title: string;
    body: string;
    confidence_score: number;
    priority?: number;
    code_location: {
      absolute_file_path: string;
      line_range: { start: number; end: number };
    };
  }>;
}

async function updateDiscoverySessionState(
  options: Pick<RunDiscoveryPhaseOptions, "projectPath" | "sessionId" | "updateSessionState">,
  updates: Record<string, unknown>
): Promise<void> {
  if (!options.sessionId) {
    return;
  }

  await options
    .updateSessionState(undefined, options.projectPath, options.sessionId, updates, {
      expectedSessionId: options.sessionId,
    })
    .catch(() => {});
}

async function assertWorktreeFingerprint(
  reviewerWorktreePath: string,
  expectedFingerprint: string,
  computeWorkingTreeFingerprint: RunDiscoveryPhaseOptions["computeWorkingTreeFingerprint"]
): Promise<void> {
  const currentFingerprint = await computeWorkingTreeFingerprint(reviewerWorktreePath);
  if (currentFingerprint !== expectedFingerprint) {
    throw new Error(
      `Discovery mutated the reviewer worktree at ${reviewerWorktreePath}. Expected ${expectedFingerprint}, got ${currentFingerprint}.`
    );
  }
}

export async function runDiscoveryPhase(
  options: RunDiscoveryPhaseOptions
): Promise<DiscoveryPhaseResult> {
  let findings: StoredFinding[] = [];
  let iterations = 0;

  while (iterations < options.config.maxIterations) {
    if (options.wasInterrupted()) {
      return {
        phase: "discovery",
        sessionStatus: "interrupted",
        findings,
        iterations,
        stopReason: "interrupted",
      };
    }

    const iteration = iterations + 1;
    const iterationStartTime = Date.now();

    await updateDiscoverySessionState(options, {
      currentPhase: "discovery",
      phase: "discovery",
      sessionStatus: "running",
      currentAgent: "reviewer",
      iteration,
      reviewSummary: undefined,
      codexReviewText: undefined,
    });

    const reviewerResult = await options.runReviewerIteration(iteration, findings);
    const merged = mergeFindingsIntoInventory(findings, reviewerResult.findings, {
      pathRoots: options.findingPathRoots,
    });
    findings = merged.findings;
    iterations = iteration;

    const entry: DiscoveryIterationLogEntry = {
      type: "discovery_iteration",
      timestamp: Date.now(),
      iteration,
      duration: reviewerResult.duration ?? Date.now() - iterationStartTime,
      phase: "discovery",
      sessionStatus: "running",
      findings,
      netNewFindingIds: merged.newFindings.map((finding) => finding.id),
    };
    await options.appendLog(options.sessionPath, entry);
    await updateDiscoverySessionState(options, {
      currentPhase: "discovery",
      phase: "discovery",
      sessionStatus: "running",
      currentAgent: null,
      iteration,
      accumulatedFindings: findings,
    });
    await assertWorktreeFingerprint(
      options.reviewerWorktreePath,
      options.baselineFingerprint,
      options.computeWorkingTreeFingerprint
    );

    if (options.wasInterrupted()) {
      return {
        phase: "discovery",
        sessionStatus: "interrupted",
        findings,
        iterations,
        stopReason: "interrupted",
      };
    }

    if (merged.newFindings.length === 0) {
      return {
        phase: "discovery",
        sessionStatus: "completed",
        findings,
        iterations,
        stopReason: "no-new-findings",
      };
    }
  }

  return {
    phase: "discovery",
    sessionStatus: "completed",
    findings,
    iterations,
    stopReason: "max-iterations",
  };
}
