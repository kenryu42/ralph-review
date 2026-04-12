import type { ScrollBoxRenderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { useEffect, useRef } from "react";
import { TUI_COLORS } from "@/lib/tui/shared/colors";

interface OutputDrawerProps {
  output: string;
  sessionName: string | null;
  visible: boolean;
  focused?: boolean;
}

function hashLine(line: string, index: number): string {
  let hash = index;
  for (let i = 0; i < line.length; i++) {
    hash = (hash * 31 + line.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

export function OutputDrawer({ output, sessionName, visible, focused = false }: OutputDrawerProps) {
  const { height: terminalHeight } = useTerminalDimensions();
  const scrollboxRef = useRef<ScrollBoxRenderable>(null);

  const drawerHeight = Math.max(8, Math.floor(terminalHeight * 0.4));
  const lines = sessionName ? output.split("\n").filter((line) => line.trim()) : [];

  useEffect(() => {
    if (scrollboxRef.current && lines.length > 0) {
      scrollboxRef.current.scrollTop = scrollboxRef.current.scrollHeight;
    }
  }, [lines.length]);

  if (!visible) {
    return null;
  }

  const borderColor = focused ? TUI_COLORS.ui.borderFocused : TUI_COLORS.ui.border;
  const title = sessionName ? `Output · ${sessionName}` : "Output";

  return (
    <box
      border
      borderStyle="rounded"
      borderColor={borderColor}
      title={title}
      titleAlignment="left"
      padding={1}
      height={drawerHeight}
      flexDirection="column"
      marginLeft={1}
      marginRight={1}
    >
      {!sessionName ? (
        <text fg={TUI_COLORS.text.dim}>No active session output</text>
      ) : lines.length === 0 ? (
        <text fg={TUI_COLORS.text.dim}>Waiting for output...</text>
      ) : (
        <scrollbox ref={scrollboxRef} flexGrow={1} height={drawerHeight - 4} focused={focused}>
          {lines.map((line, idx) => (
            <text key={hashLine(line, idx)} fg={TUI_COLORS.text.faint}>
              {line}
            </text>
          ))}
        </scrollbox>
      )}
    </box>
  );
}
