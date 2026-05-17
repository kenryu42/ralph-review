import type { DetailPaneProps } from "@/lib/tui/sessions/detail/DetailPane";
import { DetailPane } from "@/lib/tui/sessions/detail/DetailPane";
import { SessionSidebar } from "@/lib/tui/sessions/sidebar/SessionSidebar";
import { OutputDrawer } from "@/lib/tui/shared/OutputDrawer";
import { resolveWorkspaceFocusState } from "./workspace-focus";
import type { FocusedPane, SessionGroupData } from "./workspace-types";

interface WorkspaceProps extends DetailPaneProps {
  sessionGroups: SessionGroupData[];
  selectedGroupPath: string | null;
  outputVisible: boolean;
  focusedPane: FocusedPane;
  overlayBlocked?: boolean;
}

export function Workspace({
  sessionGroups,
  selectedGroupPath,
  outputVisible,
  focusedPane,
  overlayBlocked = false,
  ...detailPaneProps
}: WorkspaceProps) {
  const { sidebarFocused, detailFocused, outputFocused } = resolveWorkspaceFocusState(
    focusedPane,
    overlayBlocked
  );

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <box flexDirection="row" flexGrow={1} minHeight={0} gap={1} paddingLeft={1} paddingRight={1}>
        <SessionSidebar
          groups={sessionGroups}
          selectedGroupPath={selectedGroupPath}
          focused={sidebarFocused}
        />
        <DetailPane {...detailPaneProps} focused={detailFocused} />
      </box>
      <OutputDrawer
        output={detailPaneProps.tmuxOutput}
        sessionName={detailPaneProps.session?.sessionName ?? null}
        visible={outputVisible}
        focused={outputFocused}
      />
    </box>
  );
}
