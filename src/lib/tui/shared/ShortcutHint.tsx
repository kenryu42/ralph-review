import { TUI_COLORS } from "@/lib/tui/shared/colors";

interface ShortcutHintProps {
  keys: string;
  label: string;
}

interface ShortcutHintListProps {
  shortcuts: readonly ShortcutHintProps[];
}

export function ShortcutHint({ keys, label }: ShortcutHintProps) {
  return (
    <text>
      <span fg={TUI_COLORS.accent.key}>{keys}</span>
      <span fg={TUI_COLORS.text.muted}> {label}</span>
    </text>
  );
}

export function ShortcutHintList({ shortcuts }: ShortcutHintListProps) {
  return (
    <box flexDirection="column" gap={1}>
      {shortcuts.map((shortcut) => (
        <ShortcutHint key={shortcut.keys} keys={shortcut.keys} label={shortcut.label} />
      ))}
    </box>
  );
}
