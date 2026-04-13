import { describe, expect, test } from "bun:test";
import { selectFindings } from "@/lib/review-workflow/findings/selection";
import type { FindingId, StoredFinding } from "@/lib/review-workflow/findings/types";
import type { Priority } from "@/lib/types";

function createStoredFinding(id: FindingId, priority: Priority): StoredFinding {
  return {
    id,
    fingerprint: `fp-${id}`,
    locationKey: `src/file-${id}.ts:1:1`,
    title: `Finding ${id}`,
    body: `Body for ${id}`,
    priority,
    confidenceScore: 0.5,
    filePath: `src/file-${id}.ts`,
    startLine: 1,
    endLine: 1,
  };
}

describe("review-workflow/findings/selection", () => {
  const findings: StoredFinding[] = [
    createStoredFinding("F001", "P0"),
    createStoredFinding("F002", "P1"),
    createStoredFinding("F003", "P1"),
    createStoredFinding("F004", "P3"),
  ];

  test("selects findings by explicit IDs", () => {
    const result = selectFindings(findings, {
      mode: "id",
      ids: ["F003", "F001", "F003"],
    });

    expect(result.selectedFindings.map((finding) => finding.id)).toEqual(["F001", "F003"]);
    expect(result.selectedIds).toEqual(["F001", "F003"]);
    expect(result.notFoundIds).toEqual([]);
  });

  test("reports unknown IDs during ID selection", () => {
    const result = selectFindings(findings, {
      mode: "id",
      ids: ["F004", "F099"],
    });

    expect(result.selectedIds).toEqual(["F004"]);
    expect(result.notFoundIds).toEqual(["F099"]);
  });

  test("selects findings by priority union", () => {
    const result = selectFindings(findings, {
      mode: "priority",
      priorities: ["P1", "P3"],
    });

    expect(result.selectedIds).toEqual(["F002", "F003", "F004"]);
  });

  test("returns all findings for all mode", () => {
    const result = selectFindings(findings, { mode: "all" });

    expect(result.selectedIds).toEqual(["F001", "F002", "F003", "F004"]);
  });
});
