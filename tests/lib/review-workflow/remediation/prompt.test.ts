import { describe, expect, test } from "bun:test";
import type { StoredFinding } from "@/lib/review-workflow/findings/types";
import { createBatchFixerPrompt } from "@/lib/review-workflow/remediation/prompt";

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

describe("review-workflow/remediation/createBatchFixerPrompt", () => {
  test("keys required output by finding id and removes stop iteration semantics", () => {
    const prompt = createBatchFixerPrompt({
      reviewedSnapshotPath: "/tmp/reviewed",
      mutableWorkspacePath: "/tmp/workspace",
      selectedFindings: [createFinding("F001"), createFinding("F002")],
    });

    expect(prompt).toContain("F001");
    expect(prompt).toContain("F002");
    expect(prompt).toContain('"results": {');
    expect(prompt).toContain('"F001": {');
    expect(prompt).not.toContain("stop_iteration");
  });

  test("preserves verify-first default-to-skip and smallest-safe-fix rules", () => {
    const prompt = createBatchFixerPrompt({
      reviewedSnapshotPath: "/tmp/reviewed",
      mutableWorkspacePath: "/tmp/workspace",
      selectedFindings: [createFinding("F001")],
    });

    expect(prompt).toContain("Verify every finding against the real code first");
    expect(prompt).toContain("Default to SKIP");
    expect(prompt).toContain("smallest safe fix");
    expect(prompt).toContain("You must return one result entry for every selected finding ID");
  });
});
