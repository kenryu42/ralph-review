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

function formatElapsed(startTime: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

export function SessionItem({ session, isSelected }: SessionItemProps) {
  const { icon, color } = getStatusIcon(session.state);
  const branch = session.worktreeBranch ?? session.branch;
  const elapsed = formatElapsed(session.startTime);
  const bgColor = isSelected ? "#1e293b" : undefined;
  const textColor = isSelected ? TUI_COLORS.text.primary : TUI_COLORS.text.muted;

  return (
    <box flexDirection="row" gap={1} paddingLeft={2} paddingRight={1} backgroundColor={bgColor}>
      <text fg={color}>{icon}</text>
      <text fg={textColor} wrapMode="none" flexShrink={1}>
        {session.sessionName}
      </text>
      <text fg={TUI_COLORS.text.dim} wrapMode="none" flexShrink={1}>
        {branch}
      </text>
      <text fg={TUI_COLORS.text.dim}>{elapsed}</text>
    </box>
  );
}
