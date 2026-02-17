import { describe, expect, test } from "bun:test";
import { isReviewSummary } from "@/lib/types";

describe("isReviewSummary", () => {
  const validSummary = {
    findings: [
      {
        title: "Title",
        body: "Body",
        confidence_score: 0.75,
        priority: 1,
        code_location: {
          absolute_file_path: "/tmp/file.ts",
          line_range: { start: 10, end: 12 },
        },
      },
    ],
    overall_correctness: "patch is incorrect",
    overall_explanation: "Details",
    overall_confidence_score: 0.8,
  } as const;

  test("returns true for a valid review summary", () => {
    expect(isReviewSummary(validSummary)).toBe(true);
  });

  test("returns false when summary is not an object", () => {
    expect(isReviewSummary(null)).toBe(false);
  });

  test("returns false when findings contains a non-object value", () => {
    expect(
      isReviewSummary({
        ...validSummary,
        findings: [null],
      })
    ).toBe(false);
  });

  test("returns false when a finding has a non-string title", () => {
    expect(
      isReviewSummary({
        ...validSummary,
        findings: [{ ...validSummary.findings[0], title: 123 }],
      })
    ).toBe(false);
  });

  test("returns false when confidence_score is out of range", () => {
    expect(
      isReviewSummary({
        ...validSummary,
        findings: [{ ...validSummary.findings[0], confidence_score: 1.1 }],
      })
    ).toBe(false);
  });

  test("returns false when priority is out of range", () => {
    expect(
      isReviewSummary({
        ...validSummary,
        findings: [{ ...validSummary.findings[0], priority: 4 }],
      })
    ).toBe(false);
  });

  test("returns false when code_location is not an object", () => {
    expect(
      isReviewSummary({
        ...validSummary,
        findings: [{ ...validSummary.findings[0], code_location: null }],
      })
    ).toBe(false);
  });

  test("returns false when absolute_file_path is not a string", () => {
    expect(
      isReviewSummary({
        ...validSummary,
        findings: [
          {
            ...validSummary.findings[0],
            code_location: {
              ...validSummary.findings[0].code_location,
              absolute_file_path: 42,
            },
          },
        ],
      })
    ).toBe(false);
  });

  test("returns false when line_range is invalid", () => {
    expect(
      isReviewSummary({
        ...validSummary,
        findings: [
          {
            ...validSummary.findings[0],
            code_location: {
              ...validSummary.findings[0].code_location,
              line_range: null,
            },
          },
        ],
      })
    ).toBe(false);
  });

  test("returns false when overall_explanation is not a string", () => {
    expect(
      isReviewSummary({
        ...validSummary,
        overall_explanation: 99,
      })
    ).toBe(false);
  });
});
