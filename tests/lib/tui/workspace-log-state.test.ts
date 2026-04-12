import { describe, expect, test } from "bun:test";
import { deriveWorkspaceLogData, loadWorkspaceConfigSafe } from "@/lib/tui/workspace-log-state";
import type { LogEntry, ReviewOptions } from "@/lib/types";
import { createConfig } from "../../helpers/diagnostics";

describe("deriveWorkspaceLogData", () => {
  test("derives review and fix data from log entries", () => {
    const reviewOptions: ReviewOptions = {
      baseBranch: "main",
      simplifier: true,
    };

    const logEntries: LogEntry[] = [
      {
        type: "system",
        timestamp: 100,
        projectPath: "/repo/project",
        reviewer: { agent: "codex", model: "gpt-5.3-codex" },
        fixer: { agent: "claude", model: "claude-opus-4-6" },
        maxIterations: 5,
        reviewOptions,
      },
      {
        type: "iteration",
        timestamp: 200,
        iteration: 1,
        fixes: {
          decision: "APPLY_MOST",
          fixes: [
            {
              id: 1,
              title: "Fix null guard",
              priority: "P1",
              file: "src/a.ts",
              claim: "Claim",
              evidence: "Evidence",
              fix: "Fix",
            },
          ],
          skipped: [],
        },
        review: {
          findings: [
            {
              title: "First finding",
              body: "First finding body",
              confidence_score: 0.8,
              priority: 1,
              code_location: {
                absolute_file_path: "/repo/project/src/a.ts",
                line_range: { start: 1, end: 2 },
              },
            },
          ],
          overall_correctness: "patch is incorrect",
          overall_explanation: "Need fixes",
          overall_confidence_score: 0.8,
        },
      },
      {
        type: "iteration",
        timestamp: 300,
        iteration: 2,
        fixes: {
          decision: "APPLY_MOST",
          fixes: [
            {
              id: 2,
              title: "Fix race",
              priority: "P0",
              file: "src/b.ts",
              claim: "Claim",
              evidence: "Evidence",
              fix: "Fix",
            },
          ],
          skipped: [
            {
              id: 3,
              title: "Skip low signal issue",
              priority: "P3",
              reason: "Low confidence",
            },
          ],
        },
        codexReview: {
          text: "codex review summary",
        },
      },
    ];

    const result = deriveWorkspaceLogData(logEntries);

    expect(result.maxIterations).toBe(5);
    expect(result.reviewOptions).toEqual(reviewOptions);
    expect(result.fixes).toHaveLength(2);
    expect(result.skipped).toHaveLength(1);
    expect(result.iterationFixes.map((entry) => entry.id)).toEqual([2]);
    expect(result.iterationSkipped.map((entry) => entry.id)).toEqual([3]);
    expect(result.latestReviewIteration).toBe(2);
    expect(result.codexReviewText).toBe("codex review summary");
    expect(result.findings).toEqual(result.iterationFindings);
  });
});

describe("loadWorkspaceConfigSafe", () => {
  test("returns config without warning when load succeeds", async () => {
    const result = await loadWorkspaceConfigSafe("/repo/project", async () => createConfig());

    expect(result.config).not.toBeNull();
    expect(result.configWarning).toBeNull();
  });

  test("returns warning when config load fails", async () => {
    const result = await loadWorkspaceConfigSafe("/repo/project", async () => {
      throw new Error("missing config");
    });

    expect(result.config).toBeNull();
    expect(result.configWarning).toBe("Unable to load config: missing config");
  });
});
