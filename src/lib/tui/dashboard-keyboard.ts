export type DashboardCloseAction =
  | "close-stop-picker"
  | "close-help"
  | "delegate-session-overlay"
  | "shutdown";

interface ResolveDashboardCloseActionInput {
  showStopPicker: boolean;
  showHelp: boolean;
  showSession: boolean;
}

export function resolveDashboardCloseAction({
  showStopPicker,
  showHelp,
  showSession,
}: ResolveDashboardCloseActionInput): DashboardCloseAction {
  if (showStopPicker) {
    return "close-stop-picker";
  }

  if (showHelp) {
    return "close-help";
  }

  if (showSession) {
    return "delegate-session-overlay";
  }

  return "shutdown";
}
