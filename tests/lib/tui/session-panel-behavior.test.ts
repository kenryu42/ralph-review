import { describe, expect, test } from "bun:test";
import { resolveIssuesFoundDisplay } from "@/lib/tui/session-panel-utils";
import type { ReviewSummary } from "@/lib/types";

describe("SessionPanel behavior", () => {
  const finding = {
    title: "Fix race condition",
    body: "Race condition can hide updates in the panel.",
    confidence_score: 0.8,
    priority: 1,
    code_location: {
      absolute_file_path: "/tmp/foo.ts",
      line_range: { start: 10, end: 12 },
    },
  };

  const liveSummary: ReviewSummary = {
    findings: [finding],
    overall_correctness: "patch is incorrect",
    overall_explanation: "A race condition is present.",
    overall_confidence_score: 0.8,
  };

  test("shows reviewer issues immediately when live summary is available", () => {
    const result = resolveIssuesFoundDisplay({
      sessionStatus: "running",
      sessionIteration: 2,
      latestReviewIteration: 1,
      persistedFindings: [],
      persistedCodexText: null,
      parsedCodexSummary: null,
      liveReviewSummary: liveSummary,
      cachedLiveReviewSummary: null,
      lockfileReviewSummary: null,
    });

    expect(result.codexText).toBeNull();
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.title).toBe("Fix race condition");
  });

  test("keeps issues visible during reviewer-to-fixer transition via cached summary", () => {
    const result = resolveIssuesFoundDisplay({
      sessionStatus: "running",
      sessionIteration: 2,
      latestReviewIteration: 1,
      persistedFindings: [],
      persistedCodexText: null,
      parsedCodexSummary: null,
      liveReviewSummary: null,
      cachedLiveReviewSummary: liveSummary,
      lockfileReviewSummary: null,
    });

    expect(result.codexText).toBeNull();
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.title).toBe("Fix race condition");
  });

  test("hides previous-iteration findings while next reviewer phase is active", () => {
    const result = resolveIssuesFoundDisplay({
      sessionStatus: "running",
      sessionIteration: 3,
      latestReviewIteration: 2,
      persistedFindings: [finding],
      persistedCodexText: null,
      parsedCodexSummary: null,
      liveReviewSummary: null,
      cachedLiveReviewSummary: null,
      lockfileReviewSummary: null,
    });

    expect(result.codexText).toBeNull();
    expect(result.findings).toEqual([]);
  });

  test("shows lockfile review summary when running with no live or persisted review", () => {
    const result = resolveIssuesFoundDisplay({
      sessionStatus: "running",
      sessionIteration: 2,
      latestReviewIteration: 1,
      persistedFindings: [],
      persistedCodexText: null,
      parsedCodexSummary: null,
      liveReviewSummary: null,
      cachedLiveReviewSummary: null,
      lockfileReviewSummary: liveSummary,
    });

    expect(result.codexText).toBeNull();
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.title).toBe("Fix race condition");
  });

  test("prefers live tmux summary over lockfile review summary", () => {
    const lockfileSummary: ReviewSummary = {
      findings: [{ ...finding, title: "Lockfile finding" }],
      overall_correctness: "patch is incorrect",
      overall_explanation: "From lockfile.",
      overall_confidence_score: 0.7,
    };

    const result = resolveIssuesFoundDisplay({
      sessionStatus: "running",
      sessionIteration: 2,
      latestReviewIteration: 1,
      persistedFindings: [],
      persistedCodexText: null,
      parsedCodexSummary: null,
      liveReviewSummary: liveSummary,
      cachedLiveReviewSummary: null,
      lockfileReviewSummary: lockfileSummary,
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.title).toBe("Fix race condition");
  });

  test("ignores lockfile review summary when persisted review matches current iteration", () => {
    const persistedFinding = { ...finding, title: "Persisted finding" };
    const result = resolveIssuesFoundDisplay({
      sessionStatus: "running",
      sessionIteration: 2,
      latestReviewIteration: 2,
      persistedFindings: [persistedFinding],
      persistedCodexText: null,
      parsedCodexSummary: null,
      liveReviewSummary: null,
      cachedLiveReviewSummary: null,
      lockfileReviewSummary: liveSummary,
    });

    // Persisted findings win because latestReviewIteration === sessionIteration
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.title).toBe("Persisted finding");
  });

  test("shows persisted findings when session is not running", () => {
    const persistedFinding = { ...finding, title: "Persisted finding for completed run" };
    const result = resolveIssuesFoundDisplay({
      sessionStatus: "completed",
      sessionIteration: 3,
      latestReviewIteration: 2,
      persistedFindings: [persistedFinding],
      persistedCodexText: null,
      parsedCodexSummary: null,
      liveReviewSummary: null,
      cachedLiveReviewSummary: null,
      lockfileReviewSummary: null,
    });

    expect(result.codexText).toBeNull();
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.title).toBe("Persisted finding for completed run");
  });

  test("shows parsed codex summary findings when persisted findings are empty", () => {
    const parsedSummary: ReviewSummary = {
      findings: [{ ...finding, title: "Parsed codex finding" }],
      overall_correctness: "patch is incorrect",
      overall_explanation: "Parsed from codex text.",
      overall_confidence_score: 0.77,
    };

    const result = resolveIssuesFoundDisplay({
      sessionStatus: "completed",
      sessionIteration: 3,
      latestReviewIteration: 2,
      persistedFindings: [],
      persistedCodexText: null,
      parsedCodexSummary: parsedSummary,
      liveReviewSummary: null,
      cachedLiveReviewSummary: null,
      lockfileReviewSummary: null,
    });

    expect(result.codexText).toBeNull();
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.title).toBe("Parsed codex finding");
  });

  test("falls back to persisted codex text when no findings are available", () => {
    const result = resolveIssuesFoundDisplay({
      sessionStatus: "completed",
      sessionIteration: 3,
      latestReviewIteration: 2,
      persistedFindings: [],
      persistedCodexText: "raw codex output",
      parsedCodexSummary: null,
      liveReviewSummary: null,
      cachedLiveReviewSummary: null,
      lockfileReviewSummary: null,
    });

    expect(result.findings).toEqual([]);
    expect(result.codexText).toBe("raw codex output");
  });
});
