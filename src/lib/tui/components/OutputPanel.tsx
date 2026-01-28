/**
 * OutputPanel component - displays live tmux output
 */

import type { ScrollBoxRenderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { useEffect, useRef } from "react";

interface OutputPanelProps {
  output: string;
  sessionName: string | null;
}

/**
 * Simple hash for stable React keys
 */
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

  // Calculate available lines for output
  // Terminal height minus: header(2) + statusbar(2) + outer padding(2) + border(2) + inner padding(2) + title(2)
  const availableLines = Math.max(10, terminalHeight - 12);

  // Split output into lines - show all, let scrollbox handle scrolling
  const lines = sessionName ? output.split("\n").filter((line) => line.trim()) : [];

  // Auto-scroll to bottom when content changes
  useEffect(() => {
    if (scrollboxRef.current && lines.length > 0) {
      // Scroll to bottom
      scrollboxRef.current.scrollTop = scrollboxRef.current.scrollHeight;
    }
  }, [lines.length]);

  if (!sessionName) {
    return (
      <box border borderColor="#374151" padding={1} flexGrow={2} minHeight={10}>
        <text fg="#6b7280">No active session output</text>
      </box>
    );
  }

  return (
    <box
      border
      borderColor="#374151"
      padding={1}
      flexGrow={2}
      flexDirection="column"
      minHeight={10}
    >
      <text fg="#9ca3af" marginBottom={1}>
        Output ({sessionName}): [↑/↓ to scroll]
      </text>
      <scrollbox ref={scrollboxRef} flexGrow={1} height={availableLines} focused>
        {lines.length === 0 ? (
          <text fg="#6b7280">Waiting for output...</text>
        ) : (
          lines.map((line, idx) => (
            <text key={hashLine(line, idx)} fg="#d1d5db">
              {line}
            </text>
          ))
        )}
      </scrollbox>
    </box>
  );
}
