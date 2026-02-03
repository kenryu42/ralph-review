import { TUI_COLORS } from "@/lib/tui/colors";

export type FocusedPanel = "session" | "output";

interface StatusBarProps {
  hasSession: boolean;
  focusedPanel: FocusedPanel;
}

export function StatusBar({ hasSession, focusedPanel }: StatusBarProps) {
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
            <span fg={TUI_COLORS.text.muted}> Run</span>
          </text>
        )}
        {hasSession && (
          <text>
            <span fg={TUI_COLORS.accent.key}>[s]</span>
            <span fg={TUI_COLORS.text.muted}> Stop</span>
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
