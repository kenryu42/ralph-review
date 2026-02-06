import { describe, expect, test } from "bun:test";
import {
  extractFixesFromStats,
  extractLatestReviewSummary,
  findLatestReviewerPhaseStart,
  formatPriorityBreakdown,
  formatProjectStatsSummary,
  truncateFilePath,
  truncateText,
} from "@/lib/tui/session-panel-utils";
import type { FixEntry, IterationEntry, Priority, SessionStats, SystemEntry } from "@/lib/types";
import { buildFixEntry, buildFixSummary } from "../../test-utils/fix-summary";

describe("SessionPanel helpers", () => {
  describe("truncateText", () => {
    test("returns text unchanged if shorter than maxLength", () => {
      expect(truncateText("hello", 10)).toBe("hello");
    });

    test("returns text unchanged if equal to maxLength", () => {
      expect(truncateText("hello", 5)).toBe("hello");
    });

    test("truncates with ellipsis when longer than maxLength", () => {
      expect(truncateText("hello world", 8)).toBe("hello w…");
    });

    test("handles empty string", () => {
      expect(truncateText("", 5)).toBe("");
    });

    test("handles maxLength of 1", () => {
      expect(truncateText("hello", 1)).toBe("…");
    });
  });

  describe("truncateFilePath", () => {
    test("returns path unchanged if shorter than maxLength", () => {
      expect(truncateFilePath("src/foo.ts", 20)).toBe("src/foo.ts");
    });

    test("preserves filename and truncates directory with ellipsis", () => {
      // "…/components/Auth.tsx" = 21 chars, so maxLength 21 forces truncation at that level
      expect(truncateFilePath("src/lib/components/Auth.tsx", 21)).toBe("…/components/Auth.tsx");
    });

    test("returns just filename with ellipsis if path is too long", () => {
      expect(truncateFilePath("src/lib/components/VeryLongFileName.tsx", 15)).toBe(
        "…/VeryLongFileName.tsx"
      );
    });

    test("handles path with no directory", () => {
      expect(truncateFilePath("file.ts", 10)).toBe("file.ts");
    });

    test("handles empty string", () => {
      expect(truncateFilePath("", 10)).toBe("");
    });
  });

  describe("extractFixesFromStats", () => {
    const createFix = (id: number, title: string, priority: Priority): FixEntry =>
      buildFixEntry({ id, title, priority });

    const createIterationEntry = (iteration: number, fixes: FixEntry[]): IterationEntry => ({
      type: "iteration",
      timestamp: Date.now(),
      iteration,
      fixes: buildFixSummary({ decision: "APPLY_MOST", fixes }),
    });

    const createSystemEntry = (): SystemEntry => ({
      type: "system",
      timestamp: Date.now(),
      projectPath: "/test/project",
      reviewer: { agent: "claude", model: "opus" },
      fixer: { agent: "claude", model: "opus" },
      maxIterations: 3,
    });

    const createSessionStats = (entries: (SystemEntry | IterationEntry)[]): SessionStats => ({
      sessionPath: "/test/path",
      sessionName: "test-session",
      timestamp: Date.now(),
      status: "completed",
      totalFixes: 0,
      totalSkipped: 0,
      priorityCounts: { P0: 0, P1: 0, P2: 0, P3: 0 },
      iterations: 0,
      entries,
      reviewer: "claude",
      reviewerModel: "opus",
      reviewerDisplayName: "Claude",
      reviewerModelDisplayName: "Claude Opus 4.5",
      fixer: "claude",
      fixerModel: "opus",
      fixerDisplayName: "Claude",
      fixerModelDisplayName: "Claude Opus 4.5",
    });

    test("extracts fixes from single iteration", () => {
      const fix1 = createFix(1, "Fix auth", "P1");
      const fix2 = createFix(2, "Fix null check", "P2");
      const stats = createSessionStats([
        createSystemEntry(),
        createIterationEntry(1, [fix1, fix2]),
      ]);

      const result = extractFixesFromStats(stats);
      expect(result).toHaveLength(2);
      expect(result[0]?.title).toBe("Fix auth");
      expect(result[1]?.title).toBe("Fix null check");
    });

    test("extracts fixes from multiple iterations", () => {
      const fix1 = createFix(1, "First fix", "P0");
      const fix2 = createFix(2, "Second fix", "P1");
      const fix3 = createFix(3, "Third fix", "P2");
      const stats = createSessionStats([
        createSystemEntry(),
        createIterationEntry(1, [fix1]),
        createIterationEntry(2, [fix2, fix3]),
      ]);

      const result = extractFixesFromStats(stats);
      expect(result).toHaveLength(3);
      expect(result.map((f) => f.title)).toEqual(["First fix", "Second fix", "Third fix"]);
    });

    test("returns empty array when no fixes", () => {
      const stats = createSessionStats([createSystemEntry()]);
      const result = extractFixesFromStats(stats);
      expect(result).toEqual([]);
    });

    test("handles iterations without fixes property", () => {
      const entry: IterationEntry = {
        type: "iteration",
        timestamp: Date.now(),
        iteration: 1,
      };
      const stats = createSessionStats([entry]);

      const result = extractFixesFromStats(stats);
      expect(result).toEqual([]);
    });

    test("ignores system entries", () => {
      const fix1 = createFix(1, "A fix", "P1");
      const stats = createSessionStats([
        createSystemEntry(),
        createIterationEntry(1, [fix1]),
        createSystemEntry(),
      ]);

      const result = extractFixesFromStats(stats);
      expect(result).toHaveLength(1);
    });
  });

  describe("formatPriorityBreakdown", () => {
    test("formats all priorities with counts", () => {
      const counts: Record<Priority, number> = { P0: 5, P1: 8, P2: 12, P3: 9 };
      const result = formatPriorityBreakdown(counts);
      expect(result).toEqual([
        { priority: "P0", count: 5 },
        { priority: "P1", count: 8 },
        { priority: "P2", count: 12 },
        { priority: "P3", count: 9 },
      ]);
    });

    test("includes priorities with zero count", () => {
      const counts: Record<Priority, number> = { P0: 0, P1: 3, P2: 0, P3: 7 };
      const result = formatPriorityBreakdown(counts);
      expect(result).toEqual([
        { priority: "P0", count: 0 },
        { priority: "P1", count: 3 },
        { priority: "P2", count: 0 },
        { priority: "P3", count: 7 },
      ]);
    });

    test("returns all priorities when all counts are zero", () => {
      const counts: Record<Priority, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
      const result = formatPriorityBreakdown(counts);
      expect(result).toEqual([
        { priority: "P0", count: 0 },
        { priority: "P1", count: 0 },
        { priority: "P2", count: 0 },
        { priority: "P3", count: 0 },
      ]);
    });

    test("includes all priorities even with single non-zero", () => {
      const counts: Record<Priority, number> = { P0: 1, P1: 0, P2: 0, P3: 0 };
      const result = formatPriorityBreakdown(counts);
      expect(result).toEqual([
        { priority: "P0", count: 1 },
        { priority: "P1", count: 0 },
        { priority: "P2", count: 0 },
        { priority: "P3", count: 0 },
      ]);
    });
  });

  describe("formatProjectStatsSummary", () => {
    test("formats plural fixes and sessions", () => {
      const result = formatProjectStatsSummary(34, 10);
      expect(result).toBe("34 fixes across 10 sessions");
    });

    test("formats singular fix", () => {
      const result = formatProjectStatsSummary(1, 5);
      expect(result).toBe("1 fix across 5 sessions");
    });

    test("formats singular session", () => {
      const result = formatProjectStatsSummary(10, 1);
      expect(result).toBe("10 fixes across 1 session");
    });

    test("formats singular fix and session", () => {
      const result = formatProjectStatsSummary(1, 1);
      expect(result).toBe("1 fix across 1 session");
    });

    test("handles zero fixes", () => {
      const result = formatProjectStatsSummary(0, 5);
      expect(result).toBe("0 fixes across 5 sessions");
    });
  });

  describe("extractLatestReviewSummary", () => {
    const baseReview = {
      findings: [],
      overall_correctness: "patch is correct",
      overall_explanation: "looks good",
      overall_confidence_score: 0.91,
    };

    test("extracts review summary from raw JSON text", () => {
      const json = JSON.stringify(baseReview);
      const text = `noise\n${json}\nmore`;
      const result = extractLatestReviewSummary(text);
      expect(result).not.toBeNull();
      expect(result?.overall_explanation).toBe("looks good");
    });

    test("skips non-review JSON blocks", () => {
      const fixSummary = JSON.stringify({
        decision: "APPLY_MOST",
        fixes: [],
        skipped: [],
      });
      const text = `start\n${fixSummary}\nend`;
      const result = extractLatestReviewSummary(text);
      expect(result).toBeNull();
    });

    test("returns the last valid review summary when multiple exist", () => {
      const first = JSON.stringify({
        ...baseReview,
        overall_explanation: "first",
      });
      const second = JSON.stringify({
        ...baseReview,
        overall_explanation: "second",
      });
      const fixSummary = JSON.stringify({
        decision: "APPLY_SELECTIVELY",
        fixes: [],
        skipped: [],
      });
      const text = `${first}\n${fixSummary}\n${second}`;
      const result = extractLatestReviewSummary(text);
      expect(result?.overall_explanation).toBe("second");
    });

    test("respects the minimum index filter", () => {
      const first = JSON.stringify({
        ...baseReview,
        overall_explanation: "first",
      });
      const second = JSON.stringify({
        ...baseReview,
        overall_explanation: "second",
      });
      const text = `${first}\n${second}`;
      const minIndex = text.indexOf(second) + second.length;
      const result = extractLatestReviewSummary(text, minIndex);
      expect(result).toBeNull();
    });

    test("extracts only summaries in latest reviewer phase", () => {
      const oldSummary = JSON.stringify({
        ...baseReview,
        overall_explanation: "old iteration",
      });
      const newSummary = JSON.stringify({
        ...baseReview,
        overall_explanation: "current iteration",
      });
      const text = [
        "noise",
        oldSummary,
        "  │  Fixes applied. Re-running reviewer...                      │",
        "more output",
        newSummary,
      ].join("\n");

      const reviewerPhaseStart = findLatestReviewerPhaseStart(text);
      const result = extractLatestReviewSummary(
        text,
        reviewerPhaseStart >= 0 ? reviewerPhaseStart : 0
      );

      expect(result?.overall_explanation).toBe("current iteration");
    });
  });

  describe("findLatestReviewerPhaseStart", () => {
    test("finds latest reviewer phase header from running reviewer marker", () => {
      const text = [
        "old output",
        "  │  Running reviewer...                                        │",
        "new output",
      ].join("\n");

      expect(findLatestReviewerPhaseStart(text)).toBe(text.indexOf("Running reviewer..."));
    });

    test("prefers the most recent reviewer phase marker", () => {
      const text = [
        "  │  Running reviewer...                                        │",
        "something",
        "  │  Fixes applied. Re-running reviewer...                      │",
      ].join("\n");

      expect(findLatestReviewerPhaseStart(text)).toBe(
        text.lastIndexOf("Fixes applied. Re-running reviewer...")
      );
    });

    test("returns -1 when no reviewer marker exists", () => {
      expect(findLatestReviewerPhaseStart("no phase markers here")).toBe(-1);
    });
  });
});
