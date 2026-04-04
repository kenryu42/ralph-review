import type { ActiveSession } from "@/lib/session-state";
import { TUI_COLORS } from "@/lib/tui/colors";
import { SessionItem } from "./SessionItem";

export interface SessionGroupData {
  projectPath: string;
  projectName: string;
  isCurrentProject: boolean;
  sessions: ActiveSession[];
}

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
