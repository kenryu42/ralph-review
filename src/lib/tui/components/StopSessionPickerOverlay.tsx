import type { ActiveSession } from "@/lib/session-state";
import { TUI_COLORS } from "@/lib/tui/colors";

interface StopSessionPickerOverlayProps {
  sessions: ActiveSession[];
  onSelectSession: (session: ActiveSession) => void;
  onClose: () => void;
}

function formatRelativeStart(startTime: number): string {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startTime) / 1000));

  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s ago`;
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  return `${elapsedHours}h ago`;
}

function buildOptionName(session: ActiveSession): string {
  return `${session.sessionName} (${session.sessionId.slice(0, 8)})`;
}

function buildOptionDescription(session: ActiveSession): string {
  const branch = session.worktreeBranch ?? session.branch;
  return `${branch} • ${formatRelativeStart(session.startTime)}`;
}

export function StopSessionPickerOverlay({
  sessions,
  onSelectSession,
  onClose,
}: StopSessionPickerOverlayProps) {
  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
    >
      <box
        border
        borderStyle="double"
        title="Stop Review Session"
        titleAlignment="left"
        padding={1}
        width={80}
        height={16}
        backgroundColor="#1a1a2e"
        flexDirection="column"
        gap={1}
      >
        <text fg={TUI_COLORS.text.muted}>Choose which active worktree session to stop.</text>
        <select
          focused
          height={10}
          onKeyDown={(key) => {
            if (key.name === "escape" || key.name === "q") {
              onClose();
            }
          }}
          options={sessions.map((session) => ({
            name: buildOptionName(session),
            description: buildOptionDescription(session),
            value: session.sessionId,
          }))}
          onSelect={(_index, option) => {
            if (!option) {
              return;
            }
            const selected = sessions.find((session) => session.sessionId === option.value);
            if (selected) {
              onSelectSession(selected);
            }
          }}
        />
      </box>
    </box>
  );
}
