import { describe, expect, test } from "bun:test";
import { buildPriorityTextSegments, formatPriorityToken } from "@/lib/tui/sessions/priority-text";
import { PRIORITY_COLORS, UNKNOWN_PRIORITY_COLOR } from "@/lib/tui/sessions/session-display";
import { TUI_COLORS } from "@/lib/tui/shared/colors";

describe("priority-text", () => {
  test("formats numeric priorities as priority tokens", () => {
    expect(formatPriorityToken(0)).toBe("P0");
    expect(formatPriorityToken(1)).toBe("P1");
    expect(formatPriorityToken(2)).toBe("P2");
    expect(formatPriorityToken(3)).toBe("P3");
  });

  test("builds bracketed segments with only the priority token colored", () => {
    expect(buildPriorityTextSegments("P0", { bracketed: true })).toEqual([
      { text: "[", color: TUI_COLORS.text.dim },
      { text: "P0", color: PRIORITY_COLORS.P0 },
      { text: "]", color: TUI_COLORS.text.dim },
    ]);
  });

  test("falls back to P? with the unknown priority color", () => {
    expect(buildPriorityTextSegments("nope")).toEqual([
      { text: "P?", color: UNKNOWN_PRIORITY_COLOR },
    ]);
  });
});
