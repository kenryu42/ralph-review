import { useKeyboard, useRenderer } from "@opentui/react";
import { useCallback, useMemo, useState } from "react";
import type { LogSession } from "@/lib/logger";
import { CLI_PATH } from "@/lib/paths";
import type { FindingId, StoredFinding } from "@/lib/review-workflow/findings/types";
import { deriveWorkflowPresentationData } from "@/lib/review-workflow/presentation";
import { formatProjectNameForDisplay } from "@/lib/tui/sessions/session-display";
import { TUI_COLORS } from "@/lib/tui/shared/colors";
import type { Priority, SessionStats } from "@/lib/types";
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
            <span fg={TUI_COLORS.accent.key}>[f]</span>
            <span fg={TUI_COLORS.text.muted}> Fix pending findings</span>
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

type FixSelectionMode = "all" | "priority" | "id";

const PRIORITIES: Priority[] = ["P0", "P1", "P2", "P3"];

function getProjectPath(stats: SessionStats | null): string | null {
  if (!stats) {
    return null;
  }

  const systemEntry = stats.entries.find((entry) => entry.type === "system");
  return systemEntry?.projectPath ?? null;
}

function clampIndex(index: number, max: number): number {
  if (max <= 0) {
    return 0;
  }

  return Math.min(Math.max(index, 0), max - 1);
}

function buildFixCommandArgs(
  sessionId: string,
  mode: FixSelectionMode,
  selectedPriorities: Priority[],
  selectedFindingIds: FindingId[]
): string[] | null {
  const args = ["fix", "--session", sessionId];

  if (mode === "all") {
    args.push("--all");
    return args;
  }

  if (mode === "priority") {
    if (selectedPriorities.length === 0) {
      return null;
    }

    for (const priority of selectedPriorities) {
      args.push("--priority", priority);
    }
    return args;
  }

  if (selectedFindingIds.length === 0) {
    return null;
  }

  for (const findingId of selectedFindingIds) {
    args.push("--id", findingId);
  }
  return args;
}

interface SessionFixModalProps {
  findings: StoredFinding[];
  mode: FixSelectionMode;
  cursorIndex: number;
  selectedPriorities: Priority[];
  selectedFindingIds: FindingId[];
  isFixing: boolean;
  error: string | null;
}

function SessionFixModal({
  findings,
  mode,
  cursorIndex,
  selectedPriorities,
  selectedFindingIds,
  isFixing,
  error,
}: SessionFixModalProps) {
  const titleColor = (value: FixSelectionMode) =>
    value === mode ? TUI_COLORS.text.primary : TUI_COLORS.text.muted;
  const itemBackground = (index: number) => (index === cursorIndex ? "#1f2940" : undefined);

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
        title="Fix Findings"
        titleAlignment="left"
        padding={2}
        width={76}
        backgroundColor="#1a1a2e"
        flexDirection="column"
        gap={1}
      >
        <box flexDirection="row" gap={2}>
          <text fg={titleColor("all")}>[All]</text>
          <text fg={titleColor("priority")}>[Priority]</text>
          <text fg={titleColor("id")}>[IDs]</text>
        </box>
        <text fg={TUI_COLORS.text.muted}>
          <span fg={TUI_COLORS.accent.key}>[←/→]</span>
          <span> Mode </span>
          <span fg={TUI_COLORS.accent.key}>[↑/↓]</span>
          <span> Navigate </span>
          <span fg={TUI_COLORS.accent.key}>[Space]</span>
          <span> Toggle </span>
          <span fg={TUI_COLORS.accent.key}>[Enter]</span>
          <span> Run </span>
          <span fg={TUI_COLORS.accent.key}>[Esc]</span>
          <span> Cancel</span>
        </text>

        {mode === "all" ? (
          <box flexDirection="column" gap={1}>
            <text fg={TUI_COLORS.text.primary}>Fix all discovered findings in one batch run.</text>
            <text fg={TUI_COLORS.text.dim}>
              {findings.length} findings will be passed to `rr fix`.
            </text>
          </box>
        ) : mode === "priority" ? (
          <box flexDirection="column" gap={0}>
            {PRIORITIES.map((priority, index) => {
              const selected = selectedPriorities.includes(priority);
              return (
                <box
                  key={priority}
                  flexDirection="row"
                  gap={1}
                  paddingLeft={1}
                  backgroundColor={itemBackground(index)}
                >
                  <text fg={selected ? TUI_COLORS.status.success : TUI_COLORS.text.dim}>
                    {selected ? "[x]" : "[ ]"}
                  </text>
                  <text fg={TUI_COLORS.text.primary}>{priority}</text>
                </box>
              );
            })}
          </box>
        ) : (
          <scrollbox height={10}>
            {findings.map((finding, index) => {
              const selected = selectedFindingIds.includes(finding.id);
              return (
                <box
                  key={finding.id}
                  flexDirection="column"
                  paddingLeft={1}
                  backgroundColor={itemBackground(index)}
                >
                  <box flexDirection="row" gap={1}>
                    <text fg={selected ? TUI_COLORS.status.success : TUI_COLORS.text.dim}>
                      {selected ? "[x]" : "[ ]"}
                    </text>
                    <text fg={TUI_COLORS.text.primary}>{finding.id}</text>
                    <text fg={TUI_COLORS.text.muted}>[{finding.priority}]</text>
                    <text fg={TUI_COLORS.text.primary} wrapMode="none">
                      {finding.title}
                    </text>
                  </box>
                  <text fg={TUI_COLORS.text.dim} paddingLeft={5} wrapMode="none">
                    {finding.filePath}:{finding.startLine}-{finding.endLine}
                  </text>
                </box>
              );
            })}
          </scrollbox>
        )}

        {isFixing && <text fg={TUI_COLORS.text.muted}>Starting `rr fix`...</text>}
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
  const [showFixModal, setShowFixModal] = useState(false);
  const [fixMode, setFixMode] = useState<FixSelectionMode>("all");
  const [fixCursorIndex, setFixCursorIndex] = useState(0);
  const [selectedPriorities, setSelectedPriorities] = useState<Priority[]>([]);
  const [selectedFindingIds, setSelectedFindingIds] = useState<FindingId[]>([]);
  const [fixError, setFixError] = useState<string | null>(null);
  const [isFixing, setIsFixing] = useState(false);
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
  const selectedWorkflow = useMemo(
    () => (selectedStats ? deriveWorkflowPresentationData(selectedStats.entries) : null),
    [selectedStats]
  );
  const fixableFindings = selectedWorkflow?.storedFindings ?? [];
  const selectedProjectPath = getProjectPath(selectedStats);
  const canFixSession =
    selectedStats?.reviewOutcome === "findings-pending" &&
    selectedStats.sessionId !== undefined &&
    selectedProjectPath !== null &&
    fixableFindings.length > 0;
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

  const resetFixState = useCallback(() => {
    setFixMode("all");
    setFixCursorIndex(0);
    setSelectedPriorities([]);
    setSelectedFindingIds([]);
    setFixError(null);
    setIsFixing(false);
  }, []);

  const openFixModal = useCallback(() => {
    resetFixState();
    setShowFixModal(true);
  }, [resetFixState]);

  const closeFixModal = useCallback(() => {
    if (isFixing) {
      return;
    }

    setShowFixModal(false);
    resetFixState();
  }, [isFixing, resetFixState]);

  const toggleCurrentPriority = useCallback(() => {
    const priority = PRIORITIES[fixCursorIndex];
    if (!priority) {
      return;
    }

    setSelectedPriorities((current) =>
      current.includes(priority)
        ? current.filter((value) => value !== priority)
        : [...current, priority]
    );
  }, [fixCursorIndex]);

  const toggleCurrentFindingId = useCallback(() => {
    const finding = fixableFindings[fixCursorIndex];
    if (!finding) {
      return;
    }

    setSelectedFindingIds((current) =>
      current.includes(finding.id)
        ? current.filter((value) => value !== finding.id)
        : [...current, finding.id]
    );
  }, [fixCursorIndex, fixableFindings]);

  const confirmFixSelection = useCallback(async () => {
    if (!selectedStats?.sessionId || !selectedProjectPath || isFixing) {
      return;
    }

    const commandArgs = buildFixCommandArgs(
      selectedStats.sessionId,
      fixMode,
      selectedPriorities,
      selectedFindingIds
    );
    if (!commandArgs) {
      setFixError("Choose at least one priority or finding ID, or switch to All.");
      return;
    }

    setFixError(null);
    setIsFixing(true);

    try {
      const subprocess = Bun.spawn([process.execPath, CLI_PATH, ...commandArgs], {
        cwd: selectedProjectPath,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "pipe",
      });
      const exitCode = await subprocess.exited;
      if (exitCode !== 0) {
        const stderr = await new Response(subprocess.stderr).text();
        setFixError(stderr.trim() || `rr fix failed with exit code ${exitCode}`);
        setIsFixing(false);
        return;
      }

      setShowFixModal(false);
      resetFixState();
    } catch (error) {
      setFixError(error instanceof Error ? error.message : String(error));
      setIsFixing(false);
    }
  }, [
    fixMode,
    isFixing,
    resetFixState,
    selectedFindingIds,
    selectedPriorities,
    selectedProjectPath,
    selectedStats?.sessionId,
  ]);

  useKeyboard((key) => {
    const action = resolveSessionOverlayKeyAction({
      keyName: key.name,
      showHelp,
      showDeleteConfirm,
      showFixModal,
      hasSelectedSession: Boolean(selectedSession),
      canFixSession,
    });

    if (action === "close-delete-confirm") {
      closeDeleteConfirm();
      return;
    }

    if (action === "confirm-delete") {
      void confirmDeleteSelectedSession();
      return;
    }

    if (action === "close-fix-modal") {
      closeFixModal();
      return;
    }

    if (action === "confirm-fix") {
      void confirmFixSelection();
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

    if (action === "open-fix-modal") {
      openFixModal();
      return;
    }

    if (action === "cycle-focus") {
      cycleFocus();
      return;
    }

    if (showFixModal) {
      if (key.name === "left") {
        setFixMode((current) => {
          if (current === "priority") {
            setFixCursorIndex(0);
            return "all";
          }
          if (current === "id") {
            setFixCursorIndex(clampIndex(fixCursorIndex, PRIORITIES.length));
            return "priority";
          }
          return current;
        });
        return;
      }

      if (key.name === "right") {
        setFixMode((current) => {
          if (current === "all") {
            setFixCursorIndex(0);
            return "priority";
          }
          if (current === "priority") {
            setFixCursorIndex(0);
            return "id";
          }
          return current;
        });
        return;
      }

      if (key.name === "up" || key.name === "k") {
        setFixCursorIndex((current) =>
          clampIndex(
            current - 1,
            fixMode === "priority" ? PRIORITIES.length : fixableFindings.length
          )
        );
        return;
      }

      if (key.name === "down" || key.name === "j") {
        setFixCursorIndex((current) =>
          clampIndex(
            current + 1,
            fixMode === "priority" ? PRIORITIES.length : fixableFindings.length
          )
        );
        return;
      }

      if (key.name === "space") {
        if (fixMode === "priority") {
          toggleCurrentPriority();
        } else if (fixMode === "id") {
          toggleCurrentFindingId();
        }
        return;
      }
    }

    if (action === "close-overlay") {
      onClose();
      return;
    }
  });

  // Overhead: outer padding (2) + panel border (2) + panel padding (2) + status bar (2) = 8
  const selectHeight = Math.max(3, renderer.height - 8);
  const isOverlayBlocked = showHelp || showDeleteConfirm || showFixModal;

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
          {canFixSession && (
            <text>
              <span fg={TUI_COLORS.accent.key}>[f]</span>
              <span fg={TUI_COLORS.text.muted}> Fix</span>
            </text>
          )}
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
      {showFixModal && (
        <SessionFixModal
          findings={fixableFindings}
          mode={fixMode}
          cursorIndex={fixCursorIndex}
          selectedPriorities={selectedPriorities}
          selectedFindingIds={selectedFindingIds}
          isFixing={isFixing}
          error={fixError}
        />
      )}
    </box>
  );
}
