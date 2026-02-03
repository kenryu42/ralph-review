import { TUI_COLORS } from "@/lib/tui/colors";

interface StatusBarProps {
  hasSession: boolean;
}

export function StatusBar({ hasSession }: StatusBarProps) {
  return (
    <box flexDirection="row" justifyContent="center" gap={3} paddingTop={1}>
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
    </box>
  );
}
