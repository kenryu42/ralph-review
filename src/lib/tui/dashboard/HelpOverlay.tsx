import { useKeyboard } from "@opentui/react";
import { KeyboardShortcutsModal } from "@/lib/tui/shared/KeyboardShortcutsModal";

interface HelpOverlayProps {
  onClose: () => void;
}

export function HelpOverlay({ onClose }: HelpOverlayProps) {
  useKeyboard((key) => {
    if (key.name === "?" || key.name === "h") {
      onClose();
    }
  });

  return <KeyboardShortcutsModal shortcuts={DASHBOARD_SHORTCUTS} />;
}

const DASHBOARD_SHORTCUTS = [
  { keys: "[r]", label: "Run new review session" },
  { keys: "[s]", label: "Stop running review session" },
  { keys: "[o]", label: "Toggle output drawer" },
  { keys: "[Tab ←/→]", label: "Switch panel focus" },
  { keys: "[↑/↓ j/k]", label: "Scroll focused panel" },
  { keys: "[l]", label: "View logs" },
  { keys: "[Esc/q]", label: "Quit TUI (Won't stop review)" },
  { keys: "[h/?]", label: "Toggle help" },
] as const;
