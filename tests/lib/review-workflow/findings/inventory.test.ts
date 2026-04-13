import { describe, expect, test } from "bun:test";
import { mergeFindingsIntoInventory } from "@/lib/review-workflow/findings/inventory";
import type { Finding } from "@/lib/types";

function createRawFinding(
  options: {
    title?: string;
    body?: string;
    priority?: number;
    confidenceScore?: number;
    absolutePath?: string;
    startLine?: number;
    endLine?: number;
  } = {}
): Finding {
  const {
    title = "Handle undefined config",
    body = "Config access can throw when optional field is missing.",
    priority = 1,
    confidenceScore = 0.9,
    absolutePath = "/repo/src/lib/config.ts",
    startLine = 10,
    endLine = 12,
  } = options;

  return {
    title,
    body,
    priority,
    confidence_score: confidenceScore,
    code_location: {
      absolute_file_path: absolutePath,
      line_range: {
        start: startLine,
        end: endLine,
      },
    },
  };
}

describe("review-workflow/findings/inventory", () => {
  test("deduplicates findings and assigns stable IDs", () => {
    const findingA = createRawFinding();
    const findingADuplicate = createRawFinding({
      body: "  Config access can throw when optional field is missing.  ",
      confidenceScore: 0.2,
      priority: 3,
    });
    const findingB = createRawFinding({
      title: "Validate array bounds",
      body: "Bounds check is missing before index access.",
      absolutePath: "/repo/src/lib/parser.ts",
      startLine: 42,
      endLine: 44,
    });

    const result = mergeFindingsIntoInventory([], [findingA, findingADuplicate, findingB], {
      repoPath: "/repo",
    });

    expect(result.findings).toHaveLength(2);
    expect(result.newFindings).toHaveLength(2);
    expect(result.findings.map((finding) => finding.id)).toEqual(["F001", "F002"]);
  });

  test("keeps fingerprints stable when priority and confidence change", () => {
    const initial = mergeFindingsIntoInventory(
      [],
      [
        createRawFinding({
          priority: 0,
          confidenceScore: 0.95,
        }),
      ],
      { repoPath: "/repo" }
    );

    const repeated = mergeFindingsIntoInventory(
      initial.findings,
      [
        createRawFinding({
          priority: 3,
          confidenceScore: 0.11,
        }),
      ],
      { repoPath: "/repo" }
    );

    expect(repeated.findings).toHaveLength(1);
    expect(repeated.newFindings).toHaveLength(0);
    expect(repeated.findings[0]?.id).toBe("F001");
  });

  test("preserves earliest IDs when merging later duplicates with new findings", () => {
    const firstPass = mergeFindingsIntoInventory(
      [],
      [
        createRawFinding(),
        createRawFinding({
          title: "Validate array bounds",
          absolutePath: "/repo/src/lib/parser.ts",
          startLine: 42,
          endLine: 44,
        }),
      ],
      { repoPath: "/repo" }
    );

    const secondPass = mergeFindingsIntoInventory(
      firstPass.findings,
      [
        createRawFinding({
          title: "Validate array bounds",
          body: "Bounds check is still missing before index access.",
          absolutePath: "/repo/src/lib/parser.ts",
          startLine: 42,
          endLine: 44,
        }),
        createRawFinding({
          title: "Guard null dereference",
          body: "Null value can reach dereference path.",
          absolutePath: "/repo/src/lib/null-guard.ts",
          startLine: 7,
          endLine: 9,
        }),
      ],
      { repoPath: "/repo" }
    );

    expect(secondPass.findings.map((finding) => finding.id)).toEqual(["F001", "F002", "F003"]);
    expect(secondPass.newFindings.map((finding) => finding.id)).toEqual(["F003"]);
  });
});
