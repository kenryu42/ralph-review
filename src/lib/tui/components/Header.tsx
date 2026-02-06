import { getAgentDisplayName, getModelDisplayName } from "@/lib/agents/models";
import type { LockData } from "@/lib/lockfile";
import { TUI_COLORS } from "@/lib/tui/colors";
import type { Config } from "@/lib/types";

interface HeaderProps {
  projectName: string;
  branch?: string;
  elapsed: number;
  session: LockData | null;
  projectPath: string;
  config?: Config | null;
}

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
  const statusColor = session ? TUI_COLORS.status.success : TUI_COLORS.status.inactive;

  const homeDir = process.env.HOME || "";
  const displayPath =
    projectPath.startsWith(homeDir) && homeDir !== ""
      ? projectPath.replace(homeDir, "~")
      : projectPath;

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
        <box flexDirection="column" width={12}>
          <text>
            <span fg={TUI_COLORS.brand.logo}> {"   "}║ </span>
          </text>
          <text>
            <span fg={TUI_COLORS.brand.logo}> ███████ </span>
          </text>
          <text>
            <span fg={TUI_COLORS.brand.logo}>▐██▃█▃██▌</span>
          </text>
          <text>
            <span fg={TUI_COLORS.brand.logo}> ██▅▅▅██ </span>
          </text>
        </box>

        <box flexDirection="column">
          <text>
            <span fg={TUI_COLORS.brand.title}>
              <strong>Ralph Review</strong>
              <span fg={TUI_COLORS.text.subtle}> v0.1.0</span>
            </span>
          </text>
          <text>
            <span fg={TUI_COLORS.text.subtle}>Reviewer: </span>
            <span fg={TUI_COLORS.text.subtle}>
              {reviewerName}
              {reviewerModel}
            </span>
          </text>
          <text>
            <span fg={TUI_COLORS.text.subtle}>Fixer: </span>
            <span fg={TUI_COLORS.text.subtle}>
              {fixerName}
              {fixerModel}
            </span>
          </text>
          <text>
            <span fg={TUI_COLORS.text.subtle}>{displayPath}</span>
            {branch && <span fg={TUI_COLORS.accent.branch}> [{branch}]</span>}
          </text>
        </box>
      </box>

      <box flexDirection="column" alignItems="flex-end">
        <text>
          <span fg={statusColor}>{statusIcon} </span>
          <span fg={TUI_COLORS.text.muted}>Elapsed: </span>
          <span fg={TUI_COLORS.accent.elapsed}>{formatDuration(elapsed)}</span>
        </text>
      </box>
    </box>
  );
}
