import { CenteredModal } from "@/lib/tui/shared/CenteredModal";
import { ShortcutHintList } from "@/lib/tui/shared/ShortcutHint";

interface KeyboardShortcutsModalProps {
  shortcuts: readonly { keys: string; label: string }[];
}

export function KeyboardShortcutsModal({ shortcuts }: KeyboardShortcutsModalProps) {
  return (
    <CenteredModal title="Keyboard Shortcuts" width={44}>
      <ShortcutHintList shortcuts={shortcuts} />
    </CenteredModal>
  );
}
