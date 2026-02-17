import { describe, expect, test } from "bun:test";
import { getPriorityPillClass, getPriorityRank } from "@/lib/html/priority";

describe("html priority utilities", () => {
  test("returns expected class names for P1 and P2 priorities", () => {
    expect(getPriorityPillClass("P1")).toBe("fix-pill-p1");
    expect(getPriorityPillClass("P2")).toBe("fix-pill-p2");
  });

  test("returns expected rank values and default fallback", () => {
    expect(getPriorityRank("P0")).toBe(0);
    expect(getPriorityRank("P1")).toBe(1);
    expect(getPriorityRank("P2")).toBe(2);
    expect(getPriorityRank("P3")).toBe(3);
    expect(getPriorityRank("UNKNOWN")).toBe(99);
  });
});
