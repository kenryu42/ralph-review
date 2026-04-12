import type { FocusedPane } from "@/lib/tui/workspace/workspace-types";

export function cycleDashboardFocus(current: FocusedPane, outputVisible: boolean): FocusedPane {
  if (outputVisible) {
    if (current === "sidebar") return "detail";
    if (current === "detail") return "output";
    return "sidebar";
  }

  return current === "sidebar" ? "detail" : "sidebar";
}

export function cycleDashboardFocusReverse(
  current: FocusedPane,
  outputVisible: boolean
): FocusedPane {
  if (outputVisible) {
    if (current === "sidebar") return "output";
    if (current === "output") return "detail";
    return "sidebar";
  }

  return current === "sidebar" ? "detail" : "sidebar";
}
