import { TUI_COLORS } from "@/lib/tui/colors";

export type FocusedPanel = "session" | "output";

interface StatusBarProps {
  hasSession: boolean;
  focusedPanel: FocusedPanel;
  stopPickerOpen?: boolean;
}

export function StatusBar({ hasSession, focusedPanel, stopPickerOpen = false }: StatusBarProps) {
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
    >
      <box flexDirection="row" gap={2}>
        <text>
          <span fg={TUI_COLORS.accent.key}>[q]</span>
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
          <span fg={TUI_COLORS.accent.key}>[Tab]</span>
          <span fg={TUI_COLORS.text.muted}> Switch</span>
        </text>
        <text>
          <span fg={TUI_COLORS.accent.key}>[?]</span>
          <span fg={TUI_COLORS.text.muted}> Help</span>
        </text>
      </box>
      <text fg={TUI_COLORS.text.dim}>
        Focus: {focusedPanel === "session" ? "Session" : "Output"}
      </text>
    </box>
  );
}
