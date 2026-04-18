import { getVersion } from "@/cli-core";
import { getAgentDisplayInfo } from "@/lib/agents/display";
import { formatDuration } from "@/lib/format";
import type { SessionState } from "@/lib/session-state";
import { TUI_COLORS } from "@/lib/tui/shared/colors";
import type { Config } from "@/lib/types";

interface HeaderProps {
  projectName: string;
  branch?: string;
  elapsed: number;
  session: SessionState | null;
  projectPath: string;
  config?: Config | null;
}

export interface HeaderAgentDisplays {
  reviewerDisplay: string;
  fixerDisplay: string;
}

const APP_VERSION = getVersion();

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

  return { reviewerDisplay, fixerDisplay };
}

export function Header({ branch, elapsed, session, projectPath, config }: HeaderProps) {
  const statusIcon = session ? "●" : "○";
  const statusColor = session ? TUI_COLORS.status.success : TUI_COLORS.status.inactive;

  const homeDir = process.env.HOME || "";
  const displayPath =
    projectPath.startsWith(homeDir) && homeDir !== ""
      ? projectPath.replace(homeDir, "~")
      : projectPath;

  const { reviewerDisplay, fixerDisplay } = getHeaderAgentDisplays(config);

  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      paddingLeft={1}
      paddingRight={1}
      flexShrink={0}
    >
      <box flexDirection="row">
        <box flexDirection="column" width={20}>
          <text>
            <span fg={TUI_COLORS.brand.title}>{" ██████╗ ██████╗ "}</span>
          </text>
          <text>
            <span fg={TUI_COLORS.brand.title}>{" ██╔══██╗██╔══██╗"}</span>
          </text>
          <text>
            <span fg={TUI_COLORS.brand.title}>{" ██████╔╝██████╔╝"}</span>
          </text>
          <text>
            <span fg={TUI_COLORS.brand.title}>{" ██║  ██║██║  ██║"}</span>
          </text>
          <text>
            <span fg={TUI_COLORS.brand.title}>{" ╚═╝  ╚═╝╚═╝  ╚═╝"}</span>
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
