import { useKeyboard } from "@opentui/react";
import { TUI_COLORS } from "@/lib/tui/colors";

interface HelpOverlayProps {
  onClose: () => void;
}

export function HelpOverlay({ onClose }: HelpOverlayProps) {
  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "q" || key.name === "?" || key.name === "h") {
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
            <span fg={TUI_COLORS.accent.key}>[q/Esc]</span>
            <span fg={TUI_COLORS.text.muted}> Quit / Close help</span>
          </text>
          <text>
            <span fg={TUI_COLORS.accent.key}>[r]</span>
            <span fg={TUI_COLORS.text.muted}> Run review</span>
          </text>
          <text>
            <span fg={TUI_COLORS.accent.key}>[s]</span>
            <span fg={TUI_COLORS.text.muted}> Stop review</span>
          </text>
          <text>
            <span fg={TUI_COLORS.accent.key}>[Tab]</span>
            <span fg={TUI_COLORS.text.muted}> Switch panel focus</span>
          </text>
          <text>
            <span fg={TUI_COLORS.accent.key}>[↑/↓]</span>
            <span fg={TUI_COLORS.text.muted}> Scroll focused panel</span>
          </text>
          <text>
            <span fg={TUI_COLORS.accent.key}>[?]</span>
            <span fg={TUI_COLORS.text.muted}> Toggle help</span>
          </text>
        </box>
      </box>
    </box>
  );
}
