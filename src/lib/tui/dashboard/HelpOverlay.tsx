import { useKeyboard } from "@opentui/react";
import { TUI_COLORS } from "@/lib/tui/shared/colors";

interface HelpOverlayProps {
  onClose: () => void;
}

export function HelpOverlay({ onClose }: HelpOverlayProps) {
  useKeyboard((key) => {
    if (key.name === "?" || key.name === "h") {
      onClose();
    }
  });

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
    >
      <box
        border
        borderStyle="double"
        title="Keyboard Shortcuts"
        titleAlignment="left"
        padding={2}
        width={44}
        backgroundColor="#1a1a2e"
      >
        <box flexDirection="column" gap={1}>
          <text>
            <span fg={TUI_COLORS.accent.key}>[r]</span>
            <span fg={TUI_COLORS.text.muted}> Run new review session</span>
          </text>
          <text>
            <span fg={TUI_COLORS.accent.key}>[s]</span>
            <span fg={TUI_COLORS.text.muted}> Stop running review session</span>
          </text>
          <text>
            <span fg={TUI_COLORS.accent.key}>[o]</span>
            <span fg={TUI_COLORS.text.muted}> Toggle output drawer</span>
          </text>
          <text>
            <span fg={TUI_COLORS.accent.key}>[Tab ←/→]</span>
            <span fg={TUI_COLORS.text.muted}> Switch panel focus</span>
          </text>
          <text>
            <span fg={TUI_COLORS.accent.key}>[↑/↓ j/k]</span>
            <span fg={TUI_COLORS.text.muted}> Scroll focused panel</span>
          </text>
          <text>
            <span fg={TUI_COLORS.accent.key}>[l]</span>
            <span fg={TUI_COLORS.text.muted}> View logs</span>
          </text>
          <text>
            <span fg={TUI_COLORS.accent.key}>[Esc/q]</span>
            <span fg={TUI_COLORS.text.muted}> Quit TUI (Won't stop review)</span>
          </text>
          <text>
            <span fg={TUI_COLORS.accent.key}>[h/?]</span>
            <span fg={TUI_COLORS.text.muted}> Toggle help</span>
          </text>
        </box>
      </box>
    </box>
  );
}
