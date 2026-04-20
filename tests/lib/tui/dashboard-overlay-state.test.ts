import { describe, expect, test } from "bun:test";
import { isDashboardOverlayBlockingFocus } from "@/lib/tui/dashboard/dashboard-overlay-state";

describe("isDashboardOverlayBlockingFocus", () => {
  test("returns true when the review overlay is visible", () => {
    expect(
      isDashboardOverlayBlockingFocus({
        showHelp: false,
        showRunOverlay: true,
        showFixFindings: false,
        showSession: false,
        showStopPicker: false,
      })
    ).toBe(true);
  });

  test("returns false when no blocking overlays are visible", () => {
    expect(
      isDashboardOverlayBlockingFocus({
        showHelp: false,
        showRunOverlay: false,
        showFixFindings: false,
        showSession: false,
        showStopPicker: false,
      })
    ).toBe(false);
  });
});
