import { describe, expect, test } from "bun:test";
import { runReviewPhase } from "@/lib/review-workflow/review/run-review-phase";
import { CONFIG_SCHEMA_URI, CONFIG_VERSION, type Config } from "@/lib/types";

function createConfig(maxIterations: number): Config {
  return {
    $schema: CONFIG_SCHEMA_URI,
    version: CONFIG_VERSION,
    reviewer: { agent: "claude" },
    fixer: { agent: "claude" },
    maxIterations,
    iterationTimeout: 10,
    defaultReview: { type: "uncommitted" },
    notifications: { sound: { enabled: false } },
  };
}

describe("review-workflow/review/runReviewPhase", () => {
  test("stops on no-new-findings when forceMaxIterations is not enabled", async () => {
    let calls = 0;

    const result = await runReviewPhase({
      config: createConfig(3),
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

    expect(calls).toBe(1);
    expect(result.iterations).toBe(1);
    expect(result.stopReason).toBe("no-new-findings");
  });

  test("continues to max iterations when forceMaxIterations is enabled", async () => {
    let calls = 0;

    const result = await runReviewPhase({
      config: createConfig(3),
      reviewOptions: {
        forceMaxIterations: true,
      },
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

    expect(calls).toBe(3);
    expect(result.iterations).toBe(3);
    expect(result.stopReason).toBe("max-iterations");
  });
});
