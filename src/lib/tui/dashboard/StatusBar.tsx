import { TUI_COLORS } from "@/lib/tui/shared/colors";
import type { FocusedPane } from "@/lib/tui/workspace/workspace-types";

interface StatusBarProps {
  hasSession: boolean;
  focusedPane: FocusedPane;
  outputVisible: boolean;
  stopPickerOpen?: boolean;
  liveRefreshError?: string | null;
  configWarning?: string | null;
}

function focusPaneLabel(pane: FocusedPane): string {
  switch (pane) {
    case "sidebar":
      return "Sessions";
    case "detail":
      return "Detail";
    case "output":
      return "Output";
  }
}

export function StatusBar({
  hasSession,
  focusedPane,
  outputVisible,
  stopPickerOpen = false,
  liveRefreshError = null,
  configWarning = null,
}: StatusBarProps) {
  if (stopPickerOpen) {
    return (
      <box
        flexDirection="row"
        justifyContent="space-between"
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
      >
        <box flexDirection="row" gap={2}>
          <text>
            <span fg={TUI_COLORS.accent.key}>[↑/↓]</span>
            <span fg={TUI_COLORS.text.muted}> Choose</span>
          </text>
          <text>
            <span fg={TUI_COLORS.accent.key}>[Enter]</span>
            <span fg={TUI_COLORS.text.muted}> Stop</span>
          </text>
          <text>
            <span fg={TUI_COLORS.accent.key}>[Esc]</span>
            <span fg={TUI_COLORS.text.muted}> Cancel</span>
          </text>
        </box>
        <text fg={TUI_COLORS.text.dim}>Focus: Session Picker</text>
      </box>
    );
  }

  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
    >
      <box flexDirection="row" gap={2}>
        <text>
          <span fg={TUI_COLORS.accent.key}>[Esc/q]</span>
          <span fg={TUI_COLORS.text.muted}> Quit</span>
        </text>
        {!hasSession && (
          <text>
            <span fg={TUI_COLORS.accent.key}>[r]</span>
            <span fg={TUI_COLORS.text.muted}> Run Review</span>
          </text>
        )}
        {hasSession && (
          <text>
            <span fg={TUI_COLORS.accent.key}>[s]</span>
            <span fg={TUI_COLORS.text.muted}> Stop Review</span>
          </text>
        )}
        <text>
          <span fg={TUI_COLORS.accent.key}>[o]</span>
          <span fg={TUI_COLORS.text.muted}> {outputVisible ? "Hide Output" : "Output"}</span>
        </text>
        <text>
          <span fg={TUI_COLORS.accent.key}>[Tab ←/→]</span>
          <span fg={TUI_COLORS.text.muted}> Switch</span>
        </text>
        <text>
          <span fg={TUI_COLORS.accent.key}>[l]</span>
          <span fg={TUI_COLORS.text.muted}> Logs</span>
        </text>
        <text>
          <span fg={TUI_COLORS.accent.key}>[h]</span>
          <span fg={TUI_COLORS.text.muted}> Help</span>
        </text>
      </box>
      <box flexDirection="column" alignItems="flex-end">
        {liveRefreshError && (
          <text fg={TUI_COLORS.status.warning}>Live warning: {liveRefreshError}</text>
        )}
        {configWarning && (
          <text fg={TUI_COLORS.status.warning}>Config warning: {configWarning}</text>
        )}
        <text fg={TUI_COLORS.text.dim}>Focus: {focusPaneLabel(focusedPane)}</text>
      </box>
    </box>
  );
}
