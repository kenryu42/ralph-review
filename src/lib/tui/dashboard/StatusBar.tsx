import { TUI_COLORS } from "@/lib/tui/shared/colors";
import { ShortcutHint } from "@/lib/tui/shared/ShortcutHint";
import type { FocusedPane } from "@/lib/tui/workspace/workspace-types";

interface StatusBarProps {
  hasSession: boolean;
  canFixPendingSession: boolean;
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
  canFixPendingSession,
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
          <ShortcutHint keys="[↑/↓]" label="Choose" />
          <ShortcutHint keys="[Enter]" label="Stop" />
          <ShortcutHint keys="[Esc]" label="Cancel" />
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
        <ShortcutHint keys="[Esc/q]" label="Quit" />
        {!hasSession && <ShortcutHint keys="[r]" label="Run Review" />}
        {hasSession && <ShortcutHint keys="[s]" label="Stop Review" />}
        <ShortcutHint keys="[o]" label={outputVisible ? "Hide Output" : "Output"} />
        <ShortcutHint keys="[Tab ←/→]" label="Switch" />
        <ShortcutHint keys="[l]" label="Logs" />
        {canFixPendingSession && <ShortcutHint keys="[f]" label="Fix" />}
        <ShortcutHint keys="[h]" label="Help" />
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
