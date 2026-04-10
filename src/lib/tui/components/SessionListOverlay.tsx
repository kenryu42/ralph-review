import { useKeyboard, useRenderer } from "@opentui/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LogSession } from "@/lib/logger";
import { computeSessionStats, deleteSessionFiles, listLogSessions } from "@/lib/logger";
import { listAllActiveSessions } from "@/lib/session-state";
import { TUI_COLORS } from "@/lib/tui/colors";
import type { SessionStats } from "@/lib/types";
import { formatProjectNameForDisplay, formatRelativeTime } from "../session-panel-utils";
import { SessionDetailPane } from "./SessionListDetailPane";

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
  const [sessions, setSessions] = useState<LogSession[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedStats, setSelectedStats] = useState<SessionStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [focusedPane, setFocusedPane] = useState<OverlayPane>("list");

  const cycleFocus = useCallback(() => {
    setFocusedPane((prev) => (prev === "list" ? "detail" : "list"));
  }, []);

  useEffect(() => {
    listLogSessions().then((s) => {
      setSessions(s);
      const firstSession = s[0];
      if (firstSession) setSelectedPath(firstSession.path);
      setIsLoading(false);
    });
  }, []);

  useEffect(() => {
    const session = sessions.find((s) => s.path === selectedPath);
    if (!session) return;

    setStatsLoading(true);
    setSelectedStats(null);
    computeSessionStats(session).then((stats) => {
      setSelectedStats(stats);
      setStatsLoading(false);
    });
  }, [sessions, selectedPath]);

  const { selectOptions, sessionSlots } = useMemo(() => {
    const grouped = new Map<string, LogSession[]>();
    for (const s of sessions) {
      const bucket = grouped.get(s.projectName) ?? [];
      bucket.push(s);
      grouped.set(s.projectName, bucket);
    }

    const selectOptions: Array<{ name: string; description: string; value: string }> = [];
    const sessionSlots: Array<LogSession | null> = [];

    for (const [_, projectSessions] of grouped) {
      for (const s of projectSessions) {
        const name = s.name.replace(/\.jsonl$/, "");
        selectOptions.push({
          name: `${name} (${formatRelativeTime(s.timestamp)})`,
          description: "",
          value: s.path,
        });
        sessionSlots.push(s);
      }
    }

    return { selectOptions, sessionSlots };
  }, [sessions]);

  const selectedSession = selectedPath
    ? (sessions.find((s) => s.path === selectedPath) ?? null)
    : null;
  const sessionTitle = selectedSession
    ? `${formatProjectNameForDisplay(selectedSession.projectName)} Logs`
    : "Logs";

  const confirmDeleteSelectedSession = useCallback(async () => {
    if (!selectedPath || isDeleting) {
      return;
    }

    setIsDeleting(true);
    setDeleteError(null);

    try {
      const activeSessions = await listAllActiveSessions();
      if (activeSessions.some((session) => session.sessionPath === selectedPath)) {
        setDeleteError("Cannot delete a running session");
        return;
      }

      await deleteSessionFiles(selectedPath);

      const removedIndex = sessions.findIndex((session) => session.path === selectedPath);
      const remainingSessions = sessions.filter((session) => session.path !== selectedPath);
      const nextSelectedSession =
        removedIndex >= 0
          ? (remainingSessions[removedIndex] ?? remainingSessions[Math.max(removedIndex - 1, 0)])
          : (remainingSessions[0] ?? null);

      setSessions(remainingSessions);
      setSelectedPath(nextSelectedSession?.path ?? null);
      setSelectedStats(null);
      setStatsLoading(false);
      setShowDeleteConfirm(false);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsDeleting(false);
    }
  }, [isDeleting, selectedPath, sessions]);

  const closeDeleteConfirm = useCallback(() => {
    if (isDeleting) {
      return;
    }

    setShowDeleteConfirm(false);
    setDeleteError(null);
  }, [isDeleting]);

  useKeyboard((key) => {
    if (showDeleteConfirm) {
      if (key.name === "escape" || key.name === "n" || key.name === "q") {
        closeDeleteConfirm();
        return;
      }

      if (key.name === "y") {
        void confirmDeleteSelectedSession();
        return;
      }

      return;
    }

    if (key.name === "?" || key.name === "h") {
      setShowHelp((prev) => !prev);
      return;
    }

    if (showHelp) {
      if (key.name === "escape" || key.name === "q") {
        setShowHelp(false);
      }
      return;
    }

    if (key.name === "d") {
      if (selectedSession) {
        setDeleteError(null);
        setShowDeleteConfirm(true);
      }
      return;
    }

    if (key.name === "tab" || key.name === "left" || key.name === "right") {
      cycleFocus();
      return;
    }

    if (key.name === "escape" || key.name === "l" || key.name === "q") {
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
          ) : selectOptions.length === 0 ? (
            <text fg={TUI_COLORS.text.muted}>No sessions found</text>
          ) : (
            <select
              options={selectOptions}
              height={selectHeight}
              focused={focusedPane === "list" && !isOverlayBlocked}
              showScrollIndicator
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
            <span fg={TUI_COLORS.accent.key}>[Esc/l]</span>
            <span fg={TUI_COLORS.text.muted}> Close</span>
          </text>
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
