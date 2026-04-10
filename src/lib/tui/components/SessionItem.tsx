import type { ActiveSession } from "@/lib/session-state";
import { TUI_COLORS } from "@/lib/tui/colors";

interface SessionItemProps {
  session: ActiveSession;
  isSelected: boolean;
}

function getStatusIcon(state: string): { icon: string; color: string } {
  switch (state) {
    case "running":
      return { icon: "●", color: TUI_COLORS.status.success };
    case "pending":
      return { icon: "◌", color: TUI_COLORS.status.pending };
    case "stopping":
      return { icon: "◍", color: TUI_COLORS.status.warning };
    case "completed":
      return { icon: "✓", color: TUI_COLORS.status.success };
    case "failed":
      return { icon: "✗", color: TUI_COLORS.status.error };
    case "interrupted":
      return { icon: "⊘", color: TUI_COLORS.status.warning };
    default:
      return { icon: "○", color: TUI_COLORS.status.inactive };
  }
}

export function SessionItem({ session, isSelected }: SessionItemProps) {
  const { icon, color } = getStatusIcon(session.state);
  const bgColor = isSelected ? "#1e293b" : undefined;
  const textColor = isSelected ? TUI_COLORS.text.primary : TUI_COLORS.text.muted;

  return (
    <box flexDirection="row" gap={1} paddingLeft={2} paddingRight={1} backgroundColor={bgColor}>
      <text fg={color}>{icon}</text>
      <text fg={textColor} wrapMode="none" flexShrink={1}>
        {session.sessionName}
      </text>
    </box>
  );
}
