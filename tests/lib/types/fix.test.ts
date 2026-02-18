import { describe, expect, test } from "bun:test";
import { isFixSummary } from "@/lib/types";

describe("isFixSummary", () => {
  const validFixEntry = {
    id: 1,
    title: "Fix title",
    priority: "P1",
    file: "src/file.ts",
    claim: "Claim",
    evidence: "Evidence",
    fix: "Fix",
  } as const;

  const validSkippedEntry = {
    id: 2,
    title: "Skipped title",
    priority: "P2",
    reason: "Out of scope",
  } as const;

  test("returns true for a valid fix summary", () => {
    expect(
      isFixSummary({
        decision: "APPLY_SELECTIVELY",
        stop_iteration: false,
        fixes: [validFixEntry],
        skipped: [validSkippedEntry],
      })
    ).toBe(true);
  });

  test("returns false when the summary is not an object", () => {
    expect(isFixSummary(null)).toBe(false);
  });

  test("returns false when stop_iteration is not a boolean", () => {
    expect(
      isFixSummary({
        decision: "APPLY_SELECTIVELY",
        stop_iteration: "yes",
        fixes: [],
        skipped: [],
      })
    ).toBe(false);
  });

  test("returns false when skipped is not an array", () => {
    expect(
      isFixSummary({
        decision: "APPLY_SELECTIVELY",
        fixes: [],
        skipped: "not-an-array",
      })
    ).toBe(false);
  });

  test("returns false when fixes includes a non-object entry", () => {
    expect(
      isFixSummary({
        decision: "APPLY_SELECTIVELY",
        fixes: [null],
        skipped: [],
      })
    ).toBe(false);
  });

  test("returns false when skipped includes a non-object entry", () => {
    expect(
      isFixSummary({
        decision: "APPLY_SELECTIVELY",
        fixes: [],
        skipped: [null],
      })
    ).toBe(false);
  });

  test("returns false when decision is the removed NEED_INFO value", () => {
    expect(
      isFixSummary({
        decision: "NEED_INFO",
        fixes: [],
        skipped: [],
      })
    ).toBe(false);
  });
});
