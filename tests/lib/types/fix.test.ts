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

  const validCodeLocation = {
    absolute_file_path: "/tmp/src/file.ts",
    line_range: {
      start: 42,
      end: 45,
    },
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

  test("returns true for a valid fix summary when fixes include code_location", () => {
    expect(
      isFixSummary({
        decision: "APPLY_SELECTIVELY",
        stop_iteration: false,
        fixes: [
          {
            ...validFixEntry,
            code_location: validCodeLocation,
          },
        ],
        skipped: [validSkippedEntry],
      })
    ).toBe(true);
  });

  test("returns true when a fix entry has code_location set to null", () => {
    expect(
      isFixSummary({
        decision: "APPLY_SELECTIVELY",
        fixes: [
          {
            ...validFixEntry,
            code_location: null,
          },
        ],
        skipped: [],
      })
    ).toBe(true);
  });

  test("returns true when a fix entry omits optional file", () => {
    expect(
      isFixSummary({
        decision: "APPLY_SELECTIVELY",
        fixes: [
          {
            id: 1,
            title: "Fix title",
            priority: "P1",
            claim: "Claim",
            evidence: "Evidence",
            fix: "Fix",
          },
        ],
        skipped: [],
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

  test("returns false when fixes is not an array", () => {
    expect(
      isFixSummary({
        decision: "APPLY_SELECTIVELY",
        fixes: "not-an-array",
        skipped: [],
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

  test("returns false when fix code_location.absolute_file_path is not a string", () => {
    expect(
      isFixSummary({
        decision: "APPLY_SELECTIVELY",
        fixes: [
          {
            ...validFixEntry,
            code_location: {
              ...validCodeLocation,
              absolute_file_path: 42,
            },
          },
        ],
        skipped: [],
      })
    ).toBe(false);
  });

  test("returns false when fix code_location.line_range is malformed", () => {
    expect(
      isFixSummary({
        decision: "APPLY_SELECTIVELY",
        fixes: [
          {
            ...validFixEntry,
            code_location: {
              ...validCodeLocation,
              line_range: {
                start: "42",
                end: 45,
              },
            },
          },
        ],
        skipped: [],
      })
    ).toBe(false);
  });

  test("returns false when fix code_location.line_range is null", () => {
    expect(
      isFixSummary({
        decision: "APPLY_SELECTIVELY",
        fixes: [
          {
            ...validFixEntry,
            code_location: {
              ...validCodeLocation,
              line_range: null,
            },
          },
        ],
        skipped: [],
      })
    ).toBe(false);
  });

  test("returns false when fix code_location.line_range is not an object", () => {
    expect(
      isFixSummary({
        decision: "APPLY_SELECTIVELY",
        fixes: [
          {
            ...validFixEntry,
            code_location: {
              ...validCodeLocation,
              line_range: 42,
            },
          },
        ],
        skipped: [],
      })
    ).toBe(false);
  });

  test("returns false when fix code_location.line_range.start is less than 1", () => {
    expect(
      isFixSummary({
        decision: "APPLY_SELECTIVELY",
        fixes: [
          {
            ...validFixEntry,
            code_location: {
              ...validCodeLocation,
              line_range: {
                start: 0,
                end: 45,
              },
            },
          },
        ],
        skipped: [],
      })
    ).toBe(false);
  });

  test("returns false when fix code_location.line_range.end is before start", () => {
    expect(
      isFixSummary({
        decision: "APPLY_SELECTIVELY",
        fixes: [
          {
            ...validFixEntry,
            code_location: {
              ...validCodeLocation,
              line_range: {
                start: 45,
                end: 42,
              },
            },
          },
        ],
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

  test("returns false when fix entry file is not a string, null, or undefined", () => {
    expect(
      isFixSummary({
        decision: "APPLY_SELECTIVELY",
        fixes: [
          {
            ...validFixEntry,
            file: 123,
          },
        ],
        skipped: [],
      })
    ).toBe(false);
  });

  test("returns false when fix entry priority is outside the valid set", () => {
    expect(
      isFixSummary({
        decision: "APPLY_SELECTIVELY",
        fixes: [
          {
            ...validFixEntry,
            priority: "P9",
          },
        ],
        skipped: [],
      })
    ).toBe(false);
  });

  test("returns false when skipped entry priority is outside the valid set", () => {
    expect(
      isFixSummary({
        decision: "APPLY_SELECTIVELY",
        fixes: [],
        skipped: [
          {
            ...validSkippedEntry,
            priority: "P9",
          },
        ],
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
