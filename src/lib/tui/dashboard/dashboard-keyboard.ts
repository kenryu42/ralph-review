export type DashboardCloseAction =
  | "close-stop-picker"
  | "close-help"
  | "delegate-run-overlay"
  | "delegate-fix-overlay"
  | "delegate-session-overlay"
  | "shutdown";

export type DashboardKeyAction =
  | DashboardCloseAction
  | "none"
  | "cycle-focus"
  | "cycle-focus-reverse"
  | "toggle-output"
  | "open-help"
  | "open-fix-findings"
  | "open-session"
  | "stop-single-session"
  | "open-stop-picker"
  | "open-review-mode"
  | "select-prev-group"
  | "select-next-group";

interface ResolveDashboardCloseActionInput {
  showStopPicker: boolean;
  showHelp: boolean;
  showRunOverlay: boolean;
  showFixFindings: boolean;
  showSession: boolean;
}

export function resolveDashboardCloseAction({
  showStopPicker,
  showHelp,
  showRunOverlay,
  showFixFindings,
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

  if (showFixFindings) {
    return "delegate-fix-overlay";
  }

  if (showSession) {
    return "delegate-session-overlay";
  }

  return "shutdown";
}

interface ResolveDashboardKeyActionInput extends ResolveDashboardCloseActionInput {
  keyName: string;
  activeSessionCount: number;
  hasCurrentSession: boolean;
  canFixPendingSession: boolean;
  isRunSpawning: boolean;
  sidebarFocused?: boolean;
  sessionGroupCount?: number;
}

export function resolveDashboardKeyAction({
  keyName,
  showStopPicker,
  showHelp,
  showRunOverlay,
  showFixFindings,
  showSession,
  activeSessionCount,
  hasCurrentSession,
  canFixPendingSession,
  isRunSpawning,
  sidebarFocused = false,
  sessionGroupCount = 0,
}: ResolveDashboardKeyActionInput): DashboardKeyAction {
  if (keyName === "q" || keyName === "escape") {
    return resolveDashboardCloseAction({
      showStopPicker,
      showHelp,
      showRunOverlay,
      showFixFindings,
      showSession,
    });
  }

  if (showHelp || showSession || showRunOverlay || showFixFindings || showStopPicker) {
    return "none";
  }

  if (sidebarFocused && sessionGroupCount >= 2) {
    if (keyName === "up" || keyName === "k") {
      return "select-prev-group";
    }

    if (keyName === "down" || keyName === "j") {
      return "select-next-group";
    }
  }

  if (keyName === "tab" || keyName === "right") {
    return "cycle-focus";
  }

  if (keyName === "left") {
    return "cycle-focus-reverse";
  }

  if (keyName === "o") {
    return "toggle-output";
  }

  if (keyName === "?" || keyName === "h") {
    return "open-help";
  }

  if (keyName === "l") {
    return "open-session";
  }

  if (keyName === "f" && canFixPendingSession) {
    return "open-fix-findings";
  }

  if (keyName === "s") {
    if (activeSessionCount === 1) {
      return "stop-single-session";
    }

    if (activeSessionCount > 1) {
      return "open-stop-picker";
    }
  }

  if (keyName === "r" && !hasCurrentSession && !isRunSpawning) {
    return "open-review-mode";
  }

  return "none";
}
