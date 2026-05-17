import type { ActiveSession } from "@/lib/session-state";
import { TUI_COLORS } from "@/lib/tui/shared/colors";

interface SessionItemProps {
  session: ActiveSession;
  projectName?: string;
}

function shortSessionLabel(sessionName: string, projectName: string | undefined): string {
  if (!projectName) return sessionName;
  const prefix = `rr-${projectName}-`;
  return sessionName.startsWith(prefix) ? sessionName.slice(prefix.length) : sessionName;
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

export function SessionItem({ session, projectName }: SessionItemProps) {
  const { icon, color } = getStatusIcon(session.state);
  const label = shortSessionLabel(session.sessionName, projectName);

  return (
    <box flexDirection="row" gap={1} paddingLeft={2} paddingRight={1}>
      <text fg={color}>{icon}</text>
      <text fg={TUI_COLORS.text.muted} wrapMode="none" flexShrink={1}>
        {label}
      </text>
    </box>
  );
}
