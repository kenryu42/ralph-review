import { describe, expect, test } from "bun:test";
import {
  cycleDashboardFocus,
  cycleDashboardFocusReverse,
} from "@/lib/tui/dashboard/dashboard-focus";

describe("dashboard focus helpers", () => {
  test("cycles focus forward between sidebar and detail when output is hidden", () => {
    expect(cycleDashboardFocus("sidebar", false)).toBe("detail");
    expect(cycleDashboardFocus("detail", false)).toBe("sidebar");
  });

  test("cycles focus forward across sidebar/detail/output when output is visible", () => {
    expect(cycleDashboardFocus("sidebar", true)).toBe("detail");
    expect(cycleDashboardFocus("detail", true)).toBe("output");
    expect(cycleDashboardFocus("output", true)).toBe("sidebar");
  });

  test("cycles focus reverse across sidebar/detail/output when output is visible", () => {
    expect(cycleDashboardFocusReverse("sidebar", true)).toBe("output");
    expect(cycleDashboardFocusReverse("output", true)).toBe("detail");
    expect(cycleDashboardFocusReverse("detail", true)).toBe("sidebar");
  });
});
