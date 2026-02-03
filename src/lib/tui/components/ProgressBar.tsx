import { TUI_COLORS } from "@/lib/tui/colors";

interface ProgressBarProps {
  current: number;
  max: number;
}

export function ProgressBar({ current, max }: ProgressBarProps) {
  const barWidth = 20;
  const progress = max > 0 ? current / max : 0;
  const filled = Math.min(Math.max(Math.round(progress * barWidth), 0), barWidth);
  const empty = barWidth - filled;

  return (
    <box flexDirection="row" gap={1}>
      <text fg={TUI_COLORS.text.muted}>Iteration:</text>
      <text fg={TUI_COLORS.text.dim}>[</text>
      <text fg={TUI_COLORS.status.success}>{"█".repeat(filled)}</text>
      <text fg={TUI_COLORS.text.dim}>{"░".repeat(empty)}</text>
      <text fg={TUI_COLORS.text.dim}>]</text>
      <text fg={TUI_COLORS.text.primary}>
        {current}/{max || "?"}
      </text>
    </box>
  );
}
