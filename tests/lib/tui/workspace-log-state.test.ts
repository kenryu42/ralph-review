import { describe, expect, test } from "bun:test";
import {
  deriveWorkspaceLogData,
  loadWorkspaceConfigSafe,
} from "@/lib/tui/workspace/workspace-log-state";
import type { LogEntry, ReviewOptions } from "@/lib/types";
import { createConfig } from "../../helpers/diagnostics";

describe("deriveWorkspaceLogData", () => {
  test("derives review and fix data from log entries", () => {
    const reviewOptions: ReviewOptions = {
      baseBranch: "main",
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

  test("derives batch-first workflow data from lifecycle entries", () => {
    const logEntries: LogEntry[] = [
      {
        type: "system",
        timestamp: 100,
        sessionId: "session-123",
        projectPath: "/repo/project",
        reviewer: { agent: "codex", model: "gpt-5.3-codex" },
        fixer: { agent: "claude", model: "claude-opus-4-6" },
        maxIterations: 5,
      },
      {
        type: "review_iteration",
        timestamp: 200,
        iteration: 1,
        phase: "review",
        sessionStatus: "running",
        findings: [
          {
            id: "F001",
            fingerprint: "fp-1",
            title: "Guard missing config",
            body: "Missing null guard",
            priority: "P0",
            confidenceScore: 0.99,
            filePath: "src/config.ts",
            startLine: 10,
            endLine: 12,
          },
          {
            id: "F002",
            fingerprint: "fp-2",
            title: "Avoid stale cache",
            body: "Cache can be stale",
            priority: "P2",
            confidenceScore: 0.88,
            filePath: "src/cache.ts",
            startLine: 20,
            endLine: 24,
          },
        ],
        netNewFindingIds: ["F001", "F002"],
      },
      {
        type: "finding_selection",
        timestamp: 300,
        selectionMode: "id",
        selectedFindingIds: ["F001"],
      },
      {
        type: "batch_fix",
        timestamp: 400,
        selectedFindingIds: ["F001"],
        fixResults: [
          {
            findingId: "F001",
            status: "unresolved",
            summary: "Added a null guard",
          },
        ],
      },
    ];

    const result = deriveWorkspaceLogData(logEntries);

    expect(result.storedFindings.map((finding) => finding.id)).toEqual(["F001", "F002"]);
    expect(result.findings.map((finding) => finding.title)).toEqual([
      "Guard missing config",
      "Avoid stale cache",
    ]);
    expect(result.selectedFindingIds).toEqual(["F001"]);
    expect(result.selectedFindings.map((finding) => finding.id)).toEqual(["F001"]);
    expect(result.unselectedFindings.map((finding) => finding.id)).toEqual(["F002"]);
    expect(result.fixResults).toHaveLength(1);
    expect(result.fixResults[0]).toMatchObject({
      findingId: "F001",
      status: "unresolved",
      summary: "Added a null guard",
    });
    expect(result.unresolvedSelectedFindings.map((finding) => finding.id)).toEqual(["F001"]);
    expect(result.auditRegressionFindings).toEqual([]);
    expect(result.latestReviewIteration).toBeNull();
    expect(result.codexReviewText).toBeNull();
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
