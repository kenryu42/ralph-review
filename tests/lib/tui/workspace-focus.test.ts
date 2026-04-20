import { describe, expect, test } from "bun:test";
import { resolveWorkspaceFocusState } from "@/lib/tui/workspace/workspace-focus";

describe("resolveWorkspaceFocusState", () => {
  test("blocks detail focus while an overlay is open", () => {
    expect(resolveWorkspaceFocusState("detail", true)).toEqual({
      sidebarFocused: false,
      detailFocused: false,
      outputFocused: false,
    });
  });

  test("blocks output focus while an overlay is open", () => {
    expect(resolveWorkspaceFocusState("output", true)).toEqual({
      sidebarFocused: false,
      detailFocused: false,
      outputFocused: false,
    });
  });

  test("keeps the selected pane focused when no overlay is open", () => {
    expect(resolveWorkspaceFocusState("detail", false)).toEqual({
      sidebarFocused: false,
      detailFocused: true,
      outputFocused: false,
    });
  });
});
