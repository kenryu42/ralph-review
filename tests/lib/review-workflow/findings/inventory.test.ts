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
      pathRoots: ["/repo"],
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
      { pathRoots: ["/repo"] }
    );

    const repeated = mergeFindingsIntoInventory(
      initial.findings,
      [
        createRawFinding({
          priority: 3,
          confidenceScore: 0.11,
        }),
      ],
      { pathRoots: ["/repo"] }
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
      { pathRoots: ["/repo"] }
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
      { pathRoots: ["/repo"] }
    );

    expect(secondPass.findings.map((finding) => finding.id)).toEqual(["F001", "F002", "F003"]);
    expect(secondPass.newFindings.map((finding) => finding.id)).toEqual(["F003"]);
  });

  test("stores finding paths relative to the real project when the reviewer reports a worktree path", () => {
    const projectPath = "/Users/kenryu/Developer/420024-lab/ralph-review";
    const reviewedSnapshotPath =
      "/Users/kenryu/.config/ralph-review/ralph-review-75433236/snapshots/session-1";
    const worktreePath =
      "/Users/kenryu/.config/ralph-review/ralph-review-75433236/worktrees/d0b34499-37ce-40fa-981e-5d88a24a6630-1776137135107-bca7be6e";

    const result = mergeFindingsIntoInventory(
      [],
      [
        createRawFinding({
          absolutePath: `${worktreePath}/src/lib/review-workflow/findings/artifact.ts`,
          startLine: 205,
          endLine: 208,
        }),
      ],
      {
        pathRoots: [projectPath, reviewedSnapshotPath, worktreePath],
      }
    );

    expect(result.findings[0]?.filePath).toBe("src/lib/review-workflow/findings/artifact.ts");
  });

  test("keeps unmatched absolute finding paths intact", () => {
    const result = mergeFindingsIntoInventory(
      [],
      [
        createRawFinding({
          absolutePath: "/tmp/external/dependency.ts",
        }),
      ],
      {
        pathRoots: ["/repo"],
      }
    );

    expect(result.findings[0]?.filePath).toBe("/tmp/external/dependency.ts");
  });
});
