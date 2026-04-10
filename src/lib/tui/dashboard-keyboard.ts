export type DashboardCloseAction =
  | "close-stop-picker"
  | "close-help"
  | "delegate-run-overlay"
  | "delegate-session-overlay"
  | "shutdown";

interface ResolveDashboardCloseActionInput {
  showStopPicker: boolean;
  showHelp: boolean;
  showRunOverlay: boolean;
  showSession: boolean;
}

export function resolveDashboardCloseAction({
  showStopPicker,
  showHelp,
  showRunOverlay,
  showSession,
}: ResolveDashboardCloseActionInput): DashboardCloseAction {
  if (showStopPicker) {
    return "close-stop-picker";
  }

  if (showHelp) {
    return "close-help";
  }

  if (showRunOverlay) {
    return "delegate-run-overlay";
  }

  if (showSession) {
    return "delegate-session-overlay";
  }

  return "shutdown";
}
