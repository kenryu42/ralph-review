import { describe, expect, test } from "bun:test";
import type { StoredFinding } from "@/lib/review-workflow/findings/types";
import type { ReviewOutcome, ReviewPhase, SessionStatus } from "@/lib/types";

describe("workflow domain types", () => {
  test("supports batch-first review outcomes", () => {
    const outcomes: ReviewOutcome[] = ["clean", "findings-pending", "fixed-selected", "incomplete"];

    expect(outcomes).toHaveLength(4);
  });

  test("supports review phases and workflow session statuses", () => {
    const phases: ReviewPhase[] = ["discovery", "selection", "batch-fix", "complete"];
    const statuses: SessionStatus[] = [
      "running",
      "pending-user",
      "completed",
      "failed",
      "interrupted",
    ];

    expect(phases).toHaveLength(4);
    expect(statuses).toHaveLength(5);
  });

  test("supports workflow-local finding contracts", () => {
    const finding: StoredFinding = {
      id: "F001",
      fingerprint: "fp-1",
      locationKey: "src/file.ts:1:1",
      title: "Guard null",
      body: "Body",
      priority: "P1",
      confidenceScore: 0.5,
      filePath: "src/file.ts",
      startLine: 1,
      endLine: 1,
    };

    expect(finding.id).toBe("F001");
  });
});
