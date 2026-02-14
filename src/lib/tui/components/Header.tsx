import { getVersion } from "@/cli-core";
import { getAgentDisplayInfo } from "@/lib/agents/display";
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

export interface HeaderAgentDisplays {
  reviewerDisplay: string;
  fixerDisplay: string;
  simplifierDisplay?: string;
}

const APP_VERSION = getVersion();

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

export function getHeaderAgentDisplays(config?: Config | null): HeaderAgentDisplays {
  if (!config) {
    return {
      reviewerDisplay: "Unknown (Default, Default)",
      fixerDisplay: "Unknown (Default, Default)",
    };
  }

  const reviewer = getAgentDisplayInfo(config.reviewer);
  const fixer = getAgentDisplayInfo(config.fixer);
  const reviewerDisplay = `${reviewer.agentName} (${reviewer.modelName} • ${reviewer.reasoning})`;
  const fixerDisplay = `${fixer.agentName} (${fixer.modelName} • ${fixer.reasoning})`;

  if (config.run?.simplifier !== true) {
    return { reviewerDisplay, fixerDisplay };
  }

  const simplifierSettings = config["code-simplifier"] ?? config.reviewer;
  const simplifier = getAgentDisplayInfo(simplifierSettings);
  const simplifierDisplay = `${simplifier.agentName} (${simplifier.modelName} • ${simplifier.reasoning})`;

  return { reviewerDisplay, fixerDisplay, simplifierDisplay };
}

export function Header({ branch, elapsed, session, projectPath, config }: HeaderProps) {
  const statusIcon = session ? "●" : "○";
  const statusColor = session ? TUI_COLORS.status.success : TUI_COLORS.status.inactive;

  const homeDir = process.env.HOME || "";
  const displayPath =
    projectPath.startsWith(homeDir) && homeDir !== ""
      ? projectPath.replace(homeDir, "~")
      : projectPath;

  const { reviewerDisplay, fixerDisplay, simplifierDisplay } = getHeaderAgentDisplays(config);

  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      paddingLeft={1}
      paddingRight={1}
      flexShrink={0}
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
              <span fg={TUI_COLORS.text.subtle}> v{APP_VERSION}</span>
            </span>
          </text>
          <text>
            <span fg={TUI_COLORS.text.subtle}>Reviewer: </span>
            <span fg={TUI_COLORS.text.subtle}>{reviewerDisplay}</span>
          </text>
          <text>
            <span fg={TUI_COLORS.text.subtle}>Fixer: </span>
            <span fg={TUI_COLORS.text.subtle}>{fixerDisplay}</span>
          </text>
          {simplifierDisplay && (
            <text>
              <span fg={TUI_COLORS.text.subtle}>Simplifier: </span>
              <span fg={TUI_COLORS.text.subtle}>{simplifierDisplay}</span>
            </text>
          )}
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
