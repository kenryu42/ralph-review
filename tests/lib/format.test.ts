import { describe, expect, test } from "bun:test";
import { formatReviewType } from "@/lib/format";
import type { ReviewOptions } from "@/lib/types";

describe("formatReviewType", () => {
  test("returns 'uncommitted changes' when reviewOptions is undefined", () => {
    expect(formatReviewType(undefined)).toBe("uncommitted changes");
  });

  test("returns 'uncommitted changes' when reviewOptions is empty", () => {
    expect(formatReviewType({})).toBe("uncommitted changes");
  });

  test("returns base branch format", () => {
    expect(formatReviewType({ baseBranch: "main" })).toBe("base (main)");
  });

  test("returns commit format with short SHA", () => {
    expect(formatReviewType({ commitSha: "abc1234567890" })).toBe("commit (abc1234)");
  });

  test("returns custom format with short instructions", () => {
    expect(formatReviewType({ customInstructions: "check for typos" })).toBe(
      "custom (check for typos)"
    );
  });

  test("truncates long custom instructions at 40 chars", () => {
    const longInstruction = "a".repeat(50);
    const result = formatReviewType({ customInstructions: longInstruction });
    expect(result).toBe(`custom (${"a".repeat(40)}...)`);
  });

  test("custom instructions exactly 40 chars are not truncated", () => {
    const instruction = "a".repeat(40);
    expect(formatReviewType({ customInstructions: instruction })).toBe(`custom (${instruction})`);
  });

  test("custom instructions take priority over other options", () => {
    const options: ReviewOptions = {
      customInstructions: "check stuff",
      baseBranch: "main",
      commitSha: "abc1234",
    };
    expect(formatReviewType(options)).toBe("custom (check stuff)");
  });

  test("commitSha takes priority over baseBranch", () => {
    const options: ReviewOptions = {
      commitSha: "abc1234567890",
      baseBranch: "main",
    };
    expect(formatReviewType(options)).toBe("commit (abc1234)");
  });
});
