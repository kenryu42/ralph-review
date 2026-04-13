import { describe, expect, test } from "bun:test";
import { createTargetedAuditPrompt } from "@/lib/review-workflow/audit/prompt";
import type { StoredFinding } from "@/lib/review-workflow/findings/types";

function createFinding(id: StoredFinding["id"]): StoredFinding {
  return {
    id,
    fingerprint: `fp-${id}`,
    locationKey: `src/file-${id}.ts:10:12`,
    title: `Finding ${id}`,
    body: `Body for ${id}`,
    priority: "P1",
    confidenceScore: 0.91,
    filePath: `src/file-${id}.ts`,
    startLine: 10,
    endLine: 12,
  };
}

describe("review-workflow/audit/createTargetedAuditPrompt", () => {
  test("limits the audit to selected findings and touched files or hunks", () => {
    const prompt = createTargetedAuditPrompt({
      reviewedSnapshotPath: "/tmp/reviewed",
      mutableWorkspacePath: "/tmp/workspace",
      selectedFindings: [createFinding("F001"), createFinding("F002")],
      changedFileHints: ["src/file-F001.ts", "src/file-F002.ts @@ -10,0 +10,2 @@"],
    });

    expect(prompt).toContain("F001");
    expect(prompt).toContain("F002");
    expect(prompt).toContain("src/file-F001.ts");
    expect(prompt).toContain("@@ -10,0 +10,2 @@");
    expect(prompt).toContain("Do not reopen broad discovery");
  });

  test("requires only resolved ids unresolved ids and regression findings in the output", () => {
    const prompt = createTargetedAuditPrompt({
      reviewedSnapshotPath: "/tmp/reviewed",
      mutableWorkspacePath: "/tmp/workspace",
      selectedFindings: [createFinding("F001")],
      changedFileHints: [],
    });

    expect(prompt).toContain('"resolvedFindingIds"');
    expect(prompt).toContain('"unresolvedFindingIds"');
    expect(prompt).toContain('"regressionFindings"');
    expect(prompt).not.toContain('"overall_correctness"');
  });
});
