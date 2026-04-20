export interface DashboardOverlayState {
  showHelp: boolean;
  showRunOverlay: boolean;
  showFixFindings: boolean;
  showSession: boolean;
  showStopPicker: boolean;
}

export function isDashboardOverlayBlockingFocus({
  showHelp,
  showRunOverlay,
  showFixFindings,
  showSession,
  showStopPicker,
}: DashboardOverlayState): boolean {
  return showHelp || showRunOverlay || showFixFindings || showSession || showStopPicker;
}
