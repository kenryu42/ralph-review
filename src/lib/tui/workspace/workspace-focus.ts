import type { FocusedPane } from "./workspace-types";

export interface WorkspaceFocusState {
  sidebarFocused: boolean;
  detailFocused: boolean;
  outputFocused: boolean;
}

export function resolveWorkspaceFocusState(
  focusedPane: FocusedPane,
  overlayBlocked: boolean
): WorkspaceFocusState {
  return {
    sidebarFocused: focusedPane === "sidebar" && !overlayBlocked,
    detailFocused: focusedPane === "detail" && !overlayBlocked,
    outputFocused: focusedPane === "output" && !overlayBlocked,
  };
}
