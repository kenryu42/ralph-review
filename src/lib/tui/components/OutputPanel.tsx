import type { ScrollBoxRenderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { useEffect, useRef } from "react";
import { TUI_COLORS } from "@/lib/tui/colors";

interface OutputPanelProps {
  output: string;
  sessionName: string | null;
}

function hashLine(line: string, index: number): string {
  let hash = index;
  for (let i = 0; i < line.length; i++) {
    hash = (hash * 31 + line.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

export function OutputPanel({ output, sessionName }: OutputPanelProps) {
  const { height: terminalHeight } = useTerminalDimensions();
  const scrollboxRef = useRef<ScrollBoxRenderable>(null);

  const availableLines = Math.max(10, terminalHeight - 15);

  const lines = sessionName ? output.split("\n").filter((line) => line.trim()) : [];

  useEffect(() => {
    if (scrollboxRef.current && lines.length > 0) {
      scrollboxRef.current.scrollTop = scrollboxRef.current.scrollHeight;
    }
  }, [lines.length]);

  if (!sessionName) {
    return (
      <box border borderColor={TUI_COLORS.ui.border} padding={1} flexGrow={2} minHeight={10}>
        <text fg={TUI_COLORS.text.dim}>No active session output</text>
      </box>
    );
  }

  return (
    <box
      border
      borderColor={TUI_COLORS.ui.border}
      padding={1}
      flexGrow={2}
      flexDirection="column"
      minHeight={10}
    >
      <text fg={TUI_COLORS.text.muted} marginBottom={1}>
        Output ({sessionName}): [↑/↓ to scroll]
      </text>
      <scrollbox ref={scrollboxRef} flexGrow={1} height={availableLines} focused>
        {lines.length === 0 ? (
          <text fg={TUI_COLORS.text.dim}>Waiting for output...</text>
        ) : (
          lines.map((line, idx) => (
            <text key={hashLine(line, idx)} fg={TUI_COLORS.text.faint}>
              {line}
            </text>
          ))
        )}
      </scrollbox>
    </box>
  );
}
