import { describe, expect, test } from "bun:test";
import { runReviewPhase } from "@/lib/review-workflow/review/run-review-phase";
import type { Finding, ReviewOptions } from "@/lib/types";
import { createReviewWorkflowConfig } from "../../../helpers/review-workflow";

function createFinding(title: string, startLine: number): Finding {
  return {
    title,
    body: `${title} body`,
    confidence_score: 0.91,
    priority: 2,
    code_location: {
      absolute_file_path: "/repo/project/src/file.ts",
      line_range: { start: startLine, end: startLine + 1 },
    },
  };
}

async function runPhaseWithEmptyFindings(reviewOptions?: ReviewOptions) {
  let calls = 0;
  const result = await runReviewPhase({
    config: createReviewWorkflowConfig({ maxIterations: 3 }),
    reviewOptions,
    projectPath: "/repo/project",
    findingPathRoots: ["/repo/project"],
    sessionPath: "/tmp/session.jsonl",
    runReviewerIteration: async () => {
      calls += 1;
      return {
        findings: [],
        duration: 1,
      };
    },
    appendLog: async () => {},
    updateSessionState: async () => true,
    wasInterrupted: () => false,
  });

  return { calls, result };
}

describe("review-workflow/review/runReviewPhase", () => {
  test("stops on no-new-findings when forceMaxIterations is not enabled", async () => {
    const { calls, result } = await runPhaseWithEmptyFindings();

    expect(calls).toBe(1);
    expect(result.iterations).toBe(1);
    expect(result.stopReason).toBe("no-new-findings");
  });

  test("continues to max iterations when forceMaxIterations is enabled", async () => {
    const { calls, result } = await runPhaseWithEmptyFindings({ forceMaxIterations: true });

    expect(calls).toBe(3);
    expect(result.iterations).toBe(3);
    expect(result.stopReason).toBe("max-iterations");
  });

  test("logs only net-new findings while returning accumulated findings", async () => {
    const entries: Array<{
      iteration: number;
      findings: Array<{ id: string; title: string }>;
      netNewFindingIds: string[];
    }> = [];
    const firstFinding = createFinding("Guard missing config", 10);
    const secondFinding = createFinding("Avoid stale cache", 20);

    const result = await runReviewPhase({
      config: createReviewWorkflowConfig({ maxIterations: 3 }),
      reviewOptions: {
        forceMaxIterations: true,
      },
      projectPath: "/repo/project",
      findingPathRoots: ["/repo/project"],
      sessionPath: "/tmp/session.jsonl",
      runReviewerIteration: async (iteration) => {
        if (iteration === 1) {
          return {
            findings: [firstFinding],
            duration: 1,
          };
        }

        if (iteration === 2) {
          return {
            findings: [secondFinding],
            duration: 1,
          };
        }

        return {
          findings: [],
          duration: 1,
        };
      },
      appendLog: async (_logPath, entry) => {
        entries.push({
          iteration: entry.iteration,
          findings: entry.findings.map((finding) => ({
            id: finding.id,
            title: finding.title,
          })),
          netNewFindingIds: entry.netNewFindingIds,
        });
      },
      updateSessionState: async () => true,
      wasInterrupted: () => false,
    });

    expect(result.findings.map((finding) => finding.title)).toEqual([
      "Guard missing config",
      "Avoid stale cache",
    ]);
    expect(entries.map((entry) => entry.findings.map((finding) => finding.title))).toEqual([
      ["Guard missing config"],
      ["Avoid stale cache"],
      [],
    ]);
    expect(entries.map((entry) => entry.netNewFindingIds)).toEqual([["F001"], ["F002"], []]);
  });
});
