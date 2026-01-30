/**
 * Header component - displays title, elapsed time, and help
 */

import { getAgentDisplayName, getModelDisplayName } from "@/lib/agents/display";
import type { LockData } from "@/lib/lockfile";
import type { Config } from "@/lib/types";

interface HeaderProps {
  projectName: string;
  branch?: string;
  elapsed: number;
  session: LockData | null;
  projectPath: string;
  config?: Config | null;
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

export function Header({ branch, elapsed, session, projectPath, config }: HeaderProps) {
  const statusIcon = session ? "●" : "○";
  const statusColor = session ? "#22c55e" : "#6b7280";

  // Format path to replace home dir with ~
  const homeDir = process.env.HOME || "";
  const displayPath =
    projectPath.startsWith(homeDir) && homeDir !== ""
      ? projectPath.replace(homeDir, "~")
      : projectPath;

  // Format agent strings using shared display utilities
  const reviewerName = config?.reviewer.agent
    ? getAgentDisplayName(config.reviewer.agent)
    : "Unknown";
  const reviewerModel = config?.reviewer.model
    ? ` (${getModelDisplayName(config.reviewer.agent, config.reviewer.model)})`
    : "";

  const fixerName = config?.fixer.agent ? getAgentDisplayName(config.fixer.agent) : "Unknown";
  const fixerModel = config?.fixer.model
    ? ` (${getModelDisplayName(config.fixer.agent, config.fixer.model)})`
    : "";

  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
    >
      <box flexDirection="row">
        {/* Logo Column */}
        <box flexDirection="column" width={12}>
          <text>
            <span fg="#8b8000"> {"   "}║ </span>
          </text>
          <text>
            <span fg="#8b8000"> ███████ </span>
          </text>
          <text>
            <span fg="#8b8000">▐██▃█▃██▌</span>
          </text>
          <text>
            <span fg="#8b8000"> ██▅▅▅██ </span>
          </text>
        </box>

        {/* Info Column */}
        <box flexDirection="column">
          <text>
            <span fg="#C5CAF5">
              <strong>Ralph Review</strong>
              <span fg="#999"> v0.1.0</span>
            </span>
          </text>
          <text>
            <span fg="#999">Reviewer: </span>
            <span fg="#999">
              {reviewerName}
              {reviewerModel}
            </span>
          </text>
          <text>
            <span fg="#999">Fixer: </span>
            <span fg="#999">
              {fixerName}
              {fixerModel}
            </span>
          </text>
          <text>
            <span fg="#999">{displayPath}</span>
            {branch && <span fg="#4b5563"> [{branch}]</span>}
          </text>
        </box>
      </box>

      {/* Status/Elapsed Column (Right aligned) */}
      <box flexDirection="column" alignItems="flex-end">
        <text>
          <span fg={statusColor}>{statusIcon} </span>
          <span fg="#9ca3af">Elapsed: </span>
          <span fg="#fbbf24">{formatDuration(elapsed)}</span>
        </text>
      </box>
    </box>
  );
}
