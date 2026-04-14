import { useKeyboard, useRenderer } from "@opentui/react";
import { useCallback, useMemo, useState } from "react";
import type { LogSession } from "@/lib/logger";
import { formatProjectNameForDisplay } from "@/lib/tui/sessions/session-display";
import { TUI_COLORS } from "@/lib/tui/shared/colors";
import { SessionDetailPane } from "./SessionListDetailPane";
import {
  buildSessionOverlayOptions,
  resolveSessionOverlayKeyAction,
} from "./session-overlay-utils";
import { useSessionOverlayState } from "./use-session-overlay-state";

interface SessionOverlayProps {
  onClose: () => void;
}

function sessionLabel(session: LogSession): string {
  return session.name.replace(/\.jsonl$/, "");
}

function SessionHelpModal({ onClose }: { onClose: () => void }) {
  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "q" || key.name === "?" || key.name === "h") {
      onClose();
    }
  });

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
        title="Keyboard Shortcuts"
        titleAlignment="left"
        padding={2}
        width={44}
        backgroundColor="#1a1a2e"
      >
        <box flexDirection="column" gap={1}>
          <text>
            <span fg={TUI_COLORS.accent.key}>[Tab ←/→]</span>
            <span fg={TUI_COLORS.text.muted}> Switch pane focus</span>
          </text>
          <text>
            <span fg={TUI_COLORS.accent.key}>[↑/↓ j/k]</span>
            <span fg={TUI_COLORS.text.muted}> Navigate / Scroll</span>
          </text>
          <text>
            <span fg={TUI_COLORS.accent.key}>[d]</span>
            <span fg={TUI_COLORS.text.muted}> Delete selected log</span>
          </text>
          <text>
            <span fg={TUI_COLORS.accent.key}>[h/?]</span>
            <span fg={TUI_COLORS.text.muted}> Toggle help</span>
          </text>
        </box>
      </box>
    </box>
  );
}

interface SessionDeleteModalProps {
  sessionName: string;
  error: string | null;
  isDeleting: boolean;
}

function SessionDeleteModal({ sessionName, error, isDeleting }: SessionDeleteModalProps) {
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
        title="Delete Session Log"
        titleAlignment="left"
        padding={2}
        width={58}
        backgroundColor="#1a1a2e"
        flexDirection="column"
        gap={1}
      >
        <text fg={TUI_COLORS.text.primary}>{sessionName}</text>
        <text fg={TUI_COLORS.status.error}>This cannot be undone.</text>
        <text>
          <span fg={TUI_COLORS.accent.key}>[y]</span>
          <span fg={TUI_COLORS.status.error}> Delete</span>
          <span fg={TUI_COLORS.text.muted}> </span>
          <span fg={TUI_COLORS.accent.key}>[n/Esc]</span>
          <span fg={TUI_COLORS.text.muted}> Cancel</span>
        </text>
        {isDeleting && <text fg={TUI_COLORS.text.muted}>Deleting...</text>}
        {error && <text fg={TUI_COLORS.status.error}>{error}</text>}
      </box>
    </box>
  );
}

type OverlayPane = "list" | "detail";

export function SessionOverlay({ onClose }: SessionOverlayProps) {
  const renderer = useRenderer();
  const {
    sessions,
    selectedPath,
    selectedStats,
    isLoading,
    sessionsError,
    statsLoading,
    statsError,
    isDeleting,
    deleteError,
    setSelectedPath,
    clearDeleteError,
    deleteSelectedSession,
  } = useSessionOverlayState();
  const [showHelp, setShowHelp] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [focusedPane, setFocusedPane] = useState<OverlayPane>("list");

  const cycleFocus = useCallback(() => {
    setFocusedPane((prev) => (prev === "list" ? "detail" : "list"));
  }, []);

  const { selectOptions, sessionSlots } = useMemo(
    () => buildSessionOverlayOptions(sessions),
    [sessions]
  );

  const selectedSession = selectedPath
    ? (sessions.find((s) => s.path === selectedPath) ?? null)
    : null;
  const sessionTitle = selectedSession
    ? `${formatProjectNameForDisplay(selectedSession.projectName)} Logs`
    : "Logs";

  const confirmDeleteSelectedSession = useCallback(async () => {
    const result = await deleteSelectedSession();
    if (result.deleted) {
      setShowDeleteConfirm(false);
    }
  }, [deleteSelectedSession]);

  const closeDeleteConfirm = useCallback(() => {
    if (isDeleting) {
      return;
    }

    setShowDeleteConfirm(false);
    clearDeleteError();
  }, [clearDeleteError, isDeleting]);

  useKeyboard((key) => {
    const action = resolveSessionOverlayKeyAction({
      keyName: key.name,
      showHelp,
      showDeleteConfirm,
      hasSelectedSession: Boolean(selectedSession),
    });

    if (action === "close-delete-confirm") {
      closeDeleteConfirm();
      return;
    }

    if (action === "confirm-delete") {
      void confirmDeleteSelectedSession();
      return;
    }

    if (action === "toggle-help") {
      setShowHelp((prev) => !prev);
      return;
    }

    if (action === "close-help") {
      setShowHelp(false);
      return;
    }

    if (action === "open-delete-confirm") {
      clearDeleteError();
      setShowDeleteConfirm(true);
      return;
    }

    if (action === "cycle-focus") {
      cycleFocus();
      return;
    }

    if (action === "close-overlay") {
      onClose();
      return;
    }
  });

  // Overhead: outer padding (2) + panel border (2) + panel padding (2) + status bar (2) = 8
  const selectHeight = Math.max(3, renderer.height - 8);
  const isOverlayBlocked = showHelp || showDeleteConfirm;

  const listBorderColor =
    focusedPane === "list" ? TUI_COLORS.ui.borderFocused : TUI_COLORS.ui.border;
  const detailBorderColor =
    focusedPane === "detail" ? TUI_COLORS.ui.borderFocused : TUI_COLORS.ui.border;

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor="#0d0d1a"
    >
      <box flexDirection="row" width="100%" flexGrow={1} minHeight={0} gap={1} padding={1}>
        <box
          border
          borderStyle="rounded"
          borderColor={listBorderColor}
          title={sessionTitle}
          titleAlignment="left"
          width={70}
          flexShrink={0}
          flexDirection="column"
          padding={1}
        >
          {isLoading ? (
            <text fg={TUI_COLORS.text.muted}>Loading...</text>
          ) : sessionsError ? (
            <text fg={TUI_COLORS.status.error}>{sessionsError}</text>
          ) : selectOptions.length === 0 ? (
            <text fg={TUI_COLORS.text.muted}>No sessions found</text>
          ) : (
            <select
              options={selectOptions}
              height={selectHeight}
              focused={focusedPane === "list" && !isOverlayBlocked}
              showScrollIndicator
              showDescription={false}
              itemSpacing={1}
              selectedIndex={sessionSlots.findIndex((s) => s?.path === selectedPath)}
              onChange={(idx) => {
                const slot = sessionSlots[idx];
                if (slot) setSelectedPath(slot.path);
              }}
            />
          )}
        </box>

        <box
          border
          borderStyle="rounded"
          borderColor={detailBorderColor}
          title={selectedSession ? sessionLabel(selectedSession) : "Session Detail"}
          titleAlignment="left"
          flexGrow={1}
          minHeight={0}
          flexDirection="column"
          padding={1}
        >
          {statsLoading ? (
            <text fg={TUI_COLORS.text.muted}>Loading...</text>
          ) : statsError ? (
            <text fg={TUI_COLORS.status.error}>{statsError}</text>
          ) : !selectedStats ? (
            <text fg={TUI_COLORS.text.muted}>Select a session to view details</text>
          ) : (
            <SessionDetailPane
              stats={selectedStats}
              focused={focusedPane === "detail" && !isOverlayBlocked}
              height={selectHeight}
            />
          )}
        </box>
      </box>

      <box
        flexDirection="row"
        justifyContent="space-between"
        paddingLeft={1}
        paddingRight={1}
        paddingBottom={1}
      >
        <box flexDirection="row" gap={2}>
          <text>
            <span fg={TUI_COLORS.accent.key}>[d]</span>
            <span fg={TUI_COLORS.text.muted}> Delete</span>
          </text>
          <text>
            <span fg={TUI_COLORS.accent.key}>[h]</span>
            <span fg={TUI_COLORS.text.muted}> Help</span>
          </text>
        </box>
        <text fg={TUI_COLORS.text.dim}>Focus: {focusedPane === "list" ? "List" : "Detail"}</text>
      </box>

      {showHelp && <SessionHelpModal onClose={() => setShowHelp(false)} />}
      {showDeleteConfirm && (
        <SessionDeleteModal
          sessionName={selectedSession ? sessionLabel(selectedSession) : "Unknown session"}
          error={deleteError}
          isDeleting={isDeleting}
        />
      )}
    </box>
  );
}
