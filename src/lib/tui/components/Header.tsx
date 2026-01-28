/**
 * Header component - displays title, elapsed time, and help
 */

import type { LockData } from "@/lib/lockfile";

interface HeaderProps {
  projectName: string;
  branch?: string;
  elapsed: number;
  session: LockData | null;
}

/**
 * Format duration in human readable form
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

export function Header({ projectName, branch, elapsed, session }: HeaderProps) {
  const branchDisplay = branch || "default";
  const statusIcon = session ? "●" : "○";
  const statusColor = session ? "#22c55e" : "#6b7280";

  return (
    <box flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1}>
      <text>
        <span fg={statusColor}>{statusIcon}</span>{" "}
        <span fg="#60a5fa">
          <strong>Ralph Review</strong>
        </span>
        <span fg="#9ca3af"> - </span>
        <span fg="#f9fafb">{projectName}</span>
        <span fg="#6b7280"> [{branchDisplay}]</span>
      </text>
      <text>
        <span fg="#9ca3af">Elapsed: </span>
        <span fg="#fbbf24">{formatDuration(elapsed)}</span>
      </text>
    </box>
  );
}
