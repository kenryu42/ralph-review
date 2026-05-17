import { TUI_COLORS } from "@/lib/tui/shared/colors";
import type { SessionGroupData } from "@/lib/tui/workspace/workspace-types";
import { SessionItem } from "./SessionItem";

interface SessionGroupProps {
  group: SessionGroupData;
  isSelected: boolean;
  sidebarFocused?: boolean;
}

export function SessionGroup({ group, isSelected, sidebarFocused = false }: SessionGroupProps) {
  const icon = group.isCurrentProject ? "◆" : "○";
  const baseNameColor = group.isCurrentProject ? TUI_COLORS.text.primary : TUI_COLORS.text.muted;
  const nameColor = isSelected ? TUI_COLORS.text.primary : baseNameColor;
  const headerBg = isSelected ? (sidebarFocused ? "#1e293b" : "#111827") : undefined;
  const caret = isSelected ? "›" : " ";

  return (
    <box flexDirection="column">
      <box flexDirection="row" gap={1} paddingLeft={1} paddingRight={1} backgroundColor={headerBg}>
        <text fg={isSelected ? TUI_COLORS.accent.key : TUI_COLORS.text.dim}>{caret}</text>
        <text fg={nameColor}>{icon}</text>
        <text fg={nameColor} wrapMode="none">
          <strong>{group.projectName}</strong>
        </text>
        {group.sessions.length > 0 && (
          <text fg={TUI_COLORS.text.dim}>({group.sessions.length})</text>
        )}
      </box>
      {group.sessions.map((session) => (
        <SessionItem key={session.sessionId} session={session} projectName={group.projectName} />
      ))}
      {group.sessions.length === 0 && (
        <text fg={TUI_COLORS.text.dim} paddingLeft={4}>
          No active sessions
        </text>
      )}
    </box>
  );
}
