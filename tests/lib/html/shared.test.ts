import { describe, expect, test } from "bun:test";
import { formatDuration } from "@/lib/html/shared";

describe("html shared utilities", () => {
  test("formats duration with hours when duration exceeds one hour", () => {
    expect(formatDuration(3_661_000)).toBe("1h 1m 1s");
  });
});
