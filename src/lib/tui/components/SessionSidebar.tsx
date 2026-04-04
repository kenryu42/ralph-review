import { TUI_COLORS } from "@/lib/tui/colors";
import { SessionGroup, type SessionGroupData } from "./SessionGroup";

interface SessionSidebarProps {
  groups: SessionGroupData[];
  selectedSessionId: string | null;
  focused?: boolean;
}

export function SessionSidebar({
  groups,
  selectedSessionId,
  focused = false,
}: SessionSidebarProps) {
  const borderColor = focused ? TUI_COLORS.ui.borderFocused : TUI_COLORS.ui.border;

  return (
    <box
      border
      borderStyle="rounded"
      borderColor={borderColor}
      title="Sessions"
      titleAlignment="left"
      flexDirection="column"
      flexGrow={2}
      minWidth={24}
      gap={1}
      paddingTop={1}
      paddingBottom={1}
    >
      {groups.length === 0 ? (
        <text fg={TUI_COLORS.text.dim} paddingLeft={2}>
          No sessions
        </text>
      ) : (
        groups.map((group) => (
          <SessionGroup
            key={group.projectPath}
            group={group}
            selectedSessionId={selectedSessionId}
          />
        ))
      )}
    </box>
  );
}
