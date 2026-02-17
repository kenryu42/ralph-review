import { afterEach, describe, expect, test } from "bun:test";
import {
  extractFixesFromStats,
  extractLatestReviewSummary,
  extractSkippedFromStats,
  findLatestReviewerPhaseStart,
  formatLastRunIssueSummary,
  formatPriorityBreakdown,
  formatProjectStatsSummary,
  formatRelativeTime,
} from "@/lib/tui/session-panel-utils";
import type {
  FixEntry,
  IterationEntry,
  Priority,
  SessionStats,
  SkippedEntry,
  SystemEntry,
} from "@/lib/types";
import { buildFixEntry, buildFixSummary, buildSkippedEntry } from "../../test-utils/fix-summary";

describe("SessionPanel helpers", () => {
  const originalDateNow = Date.now;

  afterEach(() => {
    Date.now = originalDateNow;
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

  describe("extractSkippedFromStats", () => {
    const createSkipped = (id: number, title: string, priority: Priority): SkippedEntry =>
      buildSkippedEntry({ id, title, priority });

    const createIterationEntry = (iteration: number, skipped: SkippedEntry[]): IterationEntry => ({
      type: "iteration",
      timestamp: Date.now(),
      iteration,
      fixes: buildFixSummary({ decision: "APPLY_MOST", skipped }),
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

    test("extracts skipped from single iteration", () => {
      const skipped1 = createSkipped(1, "Need context", "P1");
      const skipped2 = createSkipped(2, "Cannot reproduce", "P2");
      const stats = createSessionStats([
        createSystemEntry(),
        createIterationEntry(1, [skipped1, skipped2]),
      ]);

      const result = extractSkippedFromStats(stats);
      expect(result).toHaveLength(2);
      expect(result[0]?.title).toBe("Need context");
      expect(result[1]?.title).toBe("Cannot reproduce");
    });

    test("extracts skipped from multiple iterations", () => {
      const skipped1 = createSkipped(1, "First skipped", "P0");
      const skipped2 = createSkipped(2, "Second skipped", "P1");
      const skipped3 = createSkipped(3, "Third skipped", "P2");
      const stats = createSessionStats([
        createSystemEntry(),
        createIterationEntry(1, [skipped1]),
        createIterationEntry(2, [skipped2, skipped3]),
      ]);

      const result = extractSkippedFromStats(stats);
      expect(result).toHaveLength(3);
      expect(result.map((entry) => entry.title)).toEqual([
        "First skipped",
        "Second skipped",
        "Third skipped",
      ]);
    });

    test("returns empty array when no skipped", () => {
      const stats = createSessionStats([createSystemEntry()]);
      const result = extractSkippedFromStats(stats);
      expect(result).toEqual([]);
    });

    test("handles iterations without fixes property", () => {
      const entry: IterationEntry = {
        type: "iteration",
        timestamp: Date.now(),
        iteration: 1,
      };
      const stats = createSessionStats([entry]);

      const result = extractSkippedFromStats(stats);
      expect(result).toEqual([]);
    });

    test("ignores system entries", () => {
      const skipped1 = createSkipped(1, "Skipped item", "P1");
      const stats = createSessionStats([
        createSystemEntry(),
        createIterationEntry(1, [skipped1]),
        createSystemEntry(),
      ]);

      const result = extractSkippedFromStats(stats);
      expect(result).toHaveLength(1);
    });
  });

  describe("formatLastRunIssueSummary", () => {
    test("returns no issues found when no fixes and no skipped", () => {
      expect(formatLastRunIssueSummary(0, 0, 2)).toBe("no issues found in 2 iterations");
    });

    test("returns fixes-only summary when skipped is zero", () => {
      expect(formatLastRunIssueSummary(3, 0, 2)).toBe("3 fixes in 2 iterations");
    });

    test("returns skipped-only summary when fixes is zero", () => {
      expect(formatLastRunIssueSummary(0, 2, 1)).toBe("2 skipped in 1 iteration");
    });

    test("returns combined summary when fixes and skipped exist", () => {
      expect(formatLastRunIssueSummary(2, 1, 3)).toBe("2 fixes, 1 skipped in 3 iterations");
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

  describe("formatRelativeTime", () => {
    test("returns just now when under one minute", () => {
      Date.now = () => 100_000;
      expect(formatRelativeTime(99_500)).toBe("just now");
    });

    test("returns minutes ago for minute-level differences", () => {
      Date.now = () => 10 * 60 * 1_000;
      expect(formatRelativeTime(8 * 60 * 1_000)).toBe("2m ago");
    });

    test("returns hours ago for hour-level differences", () => {
      Date.now = () => 10 * 60 * 60 * 1_000;
      expect(formatRelativeTime(7 * 60 * 60 * 1_000)).toBe("3h ago");
    });

    test("returns yesterday for one-day difference", () => {
      Date.now = () => 4 * 24 * 60 * 60 * 1_000;
      expect(formatRelativeTime(3 * 24 * 60 * 60 * 1_000)).toBe("yesterday");
    });

    test("returns days ago for multi-day differences", () => {
      Date.now = () => 6 * 24 * 60 * 60 * 1_000;
      expect(formatRelativeTime(3 * 24 * 60 * 60 * 1_000)).toBe("3d ago");
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

    test("parses summaries with escaped quotes and backslashes", () => {
      const escapedReview = {
        ...baseReview,
        overall_explanation: 'has "quotes" and path C:\\\\temp\\\\file.ts',
      };
      const text = `start\n${JSON.stringify(escapedReview)}\nend`;
      const result = extractLatestReviewSummary(text);
      expect(result?.overall_explanation).toBe(escapedReview.overall_explanation);
    });

    test("returns last valid summary when followed by malformed JSON object", () => {
      const valid = JSON.stringify({
        ...baseReview,
        overall_explanation: "valid",
      });
      const malformed = '{"findings":[}';
      const text = `${valid}\n${malformed}`;
      const result = extractLatestReviewSummary(text);
      expect(result?.overall_explanation).toBe("valid");
    });

    test("returns null for whitespace-only input", () => {
      expect(extractLatestReviewSummary("   \n\t  ")).toBeNull();
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
