import { TUI_COLORS } from "@/lib/tui/shared/colors";
import type { SessionGroupData } from "@/lib/tui/workspace/workspace-types";
import { SessionItem } from "./SessionItem";

interface SessionGroupProps {
  group: SessionGroupData;
  selectedSessionId: string | null;
}

export function SessionGroup({ group, selectedSessionId }: SessionGroupProps) {
  const icon = group.isCurrentProject ? "◆" : "○";
  const nameColor = group.isCurrentProject ? TUI_COLORS.text.primary : TUI_COLORS.text.muted;

  return (
    <box flexDirection="column">
      <box flexDirection="row" gap={1} paddingLeft={1}>
        <text fg={nameColor}>{icon}</text>
        <text fg={nameColor} wrapMode="none">
          <strong>{group.projectName}</strong>
        </text>
        {group.sessions.length > 0 && (
          <text fg={TUI_COLORS.text.dim}>({group.sessions.length})</text>
        )}
      </box>
      {group.sessions.map((session) => (
        <SessionItem
          key={session.sessionId}
          session={session}
          isSelected={session.sessionId === selectedSessionId}
          projectName={group.projectName}
        />
      ))}
      {group.sessions.length === 0 && (
        <text fg={TUI_COLORS.text.dim} paddingLeft={4}>
          No active sessions
        </text>
      )}
    </box>
  );
}
