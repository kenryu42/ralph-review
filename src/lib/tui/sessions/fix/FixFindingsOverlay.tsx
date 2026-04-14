import { useKeyboard, useRenderer } from "@opentui/react";
import { useCallback, useMemo, useState } from "react";
import { CLI_PATH } from "@/lib/paths";
import type { FindingId, StoredFinding } from "@/lib/review-workflow/findings/types";
import { TUI_COLORS } from "@/lib/tui/shared/colors";
import type { Priority } from "@/lib/types";

export interface FixFindingsOverlayProps {
  sessionId: string;
  projectPath: string;
  findings: StoredFinding[];
  onClose: () => void;
}

type FixSelectionMode = "all" | "priority" | "id";

const PRIORITIES: Priority[] = ["P0", "P1", "P2", "P3"];

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

function formatSelectionSummary(
  mode: FixSelectionMode,
  selectedPriorities: Priority[],
  selectedFindingIds: FindingId[]
): string {
  if (mode === "all") {
    return "All findings will be fixed in one batch run.";
  }

  if (mode === "priority") {
    if (selectedPriorities.length === 0) {
      return "Choose one or more priorities to fix.";
    }

    return `Selected priorities: ${selectedPriorities.join(", ")}`;
  }

  if (selectedFindingIds.length === 0) {
    return "Choose one or more findings by ID.";
  }

  return `Selected IDs: ${selectedFindingIds.join(", ")}`;
}

export function FixFindingsOverlay({
  sessionId,
  projectPath,
  findings,
  onClose,
}: FixFindingsOverlayProps) {
  const renderer = useRenderer();
  const [mode, setMode] = useState<FixSelectionMode>("all");
  const [cursorIndex, setCursorIndex] = useState(0);
  const [selectedPriorities, setSelectedPriorities] = useState<Priority[]>([]);
  const [selectedFindingIds, setSelectedFindingIds] = useState<FindingId[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isFixing, setIsFixing] = useState(false);

  const priorityCounts = useMemo(() => {
    return PRIORITIES.map((priority) => ({
      priority,
      count: findings.filter((finding) => finding.priority === priority).length,
    }));
  }, [findings]);

  const infoHeight = Math.max(10, renderer.height - 12);
  const listHeight = Math.max(10, renderer.height - 16);

  const closeOverlay = useCallback(() => {
    if (isFixing) {
      return;
    }

    onClose();
  }, [isFixing, onClose]);

  const toggleCurrentPriority = useCallback(() => {
    const priority = PRIORITIES[cursorIndex];
    if (!priority) {
      return;
    }

    setSelectedPriorities((current) =>
      current.includes(priority)
        ? current.filter((value) => value !== priority)
        : [...current, priority]
    );
  }, [cursorIndex]);

  const toggleCurrentFindingId = useCallback(() => {
    const finding = findings[cursorIndex];
    if (!finding) {
      return;
    }

    setSelectedFindingIds((current) =>
      current.includes(finding.id)
        ? current.filter((value) => value !== finding.id)
        : [...current, finding.id]
    );
  }, [cursorIndex, findings]);

  const confirmFixSelection = useCallback(async () => {
    if (isFixing) {
      return;
    }

    const commandArgs = buildFixCommandArgs(
      sessionId,
      mode,
      selectedPriorities,
      selectedFindingIds
    );
    if (!commandArgs) {
      setError("Choose at least one priority or finding ID, or switch to All.");
      return;
    }

    setError(null);
    setIsFixing(true);

    try {
      const subprocess = Bun.spawn([process.execPath, CLI_PATH, ...commandArgs], {
        cwd: projectPath,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "pipe",
      });
      const exitCode = await subprocess.exited;

      if (exitCode !== 0) {
        const stderr = await new Response(subprocess.stderr).text();
        setError(stderr.trim() || `rr fix failed with exit code ${exitCode}`);
        setIsFixing(false);
        return;
      }

      onClose();
    } catch (spawnError) {
      setError(spawnError instanceof Error ? spawnError.message : String(spawnError));
      setIsFixing(false);
    }
  }, [isFixing, mode, onClose, projectPath, selectedFindingIds, selectedPriorities, sessionId]);

  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "q") {
      closeOverlay();
      return;
    }

    if (key.name === "enter" || key.name === "return") {
      void confirmFixSelection();
      return;
    }

    if (key.name === "left") {
      setMode((current) => {
        if (current === "priority") {
          setCursorIndex(0);
          return "all";
        }

        if (current === "id") {
          setCursorIndex(clampIndex(cursorIndex, PRIORITIES.length));
          return "priority";
        }

        return current;
      });
      return;
    }

    if (key.name === "right") {
      setMode((current) => {
        if (current === "all") {
          setCursorIndex(0);
          return "priority";
        }

        if (current === "priority") {
          setCursorIndex(0);
          return "id";
        }

        return current;
      });
      return;
    }

    if (key.name === "up" || key.name === "k") {
      setCursorIndex((current) =>
        clampIndex(current - 1, mode === "priority" ? PRIORITIES.length : findings.length)
      );
      return;
    }

    if (key.name === "down" || key.name === "j") {
      setCursorIndex((current) =>
        clampIndex(current + 1, mode === "priority" ? PRIORITIES.length : findings.length)
      );
      return;
    }

    if (key.name === "space") {
      if (mode === "priority") {
        toggleCurrentPriority();
      } else if (mode === "id") {
        toggleCurrentFindingId();
      }
    }
  });

  const modeColor = (value: FixSelectionMode) =>
    value === mode ? TUI_COLORS.text.primary : TUI_COLORS.text.muted;
  const itemBackground = (index: number) => (index === cursorIndex ? "#1f2940" : undefined);

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor="#0d0d1a"
      padding={1}
    >
      <box
        border
        borderStyle="rounded"
        borderColor={TUI_COLORS.ui.borderFocused}
        title="Fix Findings"
        titleAlignment="left"
        width="100%"
        height="100%"
        flexDirection="column"
        padding={1}
      >
        <box flexDirection="row" justifyContent="space-between">
          <box flexDirection="column">
            <text fg={TUI_COLORS.text.primary}>
              <strong>Session {sessionId}</strong>
            </text>
            <text fg={TUI_COLORS.text.dim}>{projectPath}</text>
          </box>
          <text fg={TUI_COLORS.text.dim}>{findings.length} findings pending</text>
        </box>

        <box flexDirection="row" gap={1}>
          <text fg={modeColor("all")}>[All]</text>
          <text fg={modeColor("priority")}>[Priority]</text>
          <text fg={modeColor("id")}>[IDs]</text>
        </box>

        <box flexDirection="row" gap={1} flexGrow={1} minHeight={0}>
          <box
            border
            borderStyle="rounded"
            borderColor={TUI_COLORS.ui.border}
            width={34}
            flexDirection="column"
            padding={1}
            gap={1}
          >
            <text fg={TUI_COLORS.text.faint}>
              <strong>Selection</strong>
            </text>
            <text fg={TUI_COLORS.text.secondary}>
              {formatSelectionSummary(mode, selectedPriorities, selectedFindingIds)}
            </text>
            <text fg={TUI_COLORS.text.muted}>
              <span fg={TUI_COLORS.accent.key}>[←/→]</span>
              <span> Mode </span>
              <span fg={TUI_COLORS.accent.key}>[↑/↓]</span>
              <span> Navigate</span>
            </text>
            <text fg={TUI_COLORS.text.muted}>
              <span fg={TUI_COLORS.accent.key}>[Space]</span>
              <span> Toggle </span>
              <span fg={TUI_COLORS.accent.key}>[Enter]</span>
              <span> Run </span>
              <span fg={TUI_COLORS.accent.key}>[Esc]</span>
              <span> Cancel</span>
            </text>

            <box flexDirection="column" gap={0}>
              <text fg={TUI_COLORS.text.faint}>
                <strong>Priority counts</strong>
              </text>
              <scrollbox height={infoHeight}>
                {priorityCounts.map((item) => (
                  <box key={item.priority} flexDirection="row" gap={1}>
                    <text fg={TUI_COLORS.text.primary}>{item.priority}</text>
                    <text fg={TUI_COLORS.text.dim}>{item.count}</text>
                  </box>
                ))}
              </scrollbox>
            </box>
          </box>

          <box
            border
            borderStyle="rounded"
            borderColor={TUI_COLORS.ui.border}
            flexGrow={1}
            minHeight={0}
            flexDirection="column"
            padding={1}
            gap={1}
          >
            <text fg={TUI_COLORS.text.faint}>
              <strong>
                {mode === "all"
                  ? "Batch scope"
                  : mode === "priority"
                    ? "Choose priorities"
                    : "Choose findings"}
              </strong>
            </text>

            {mode === "all" ? (
              <box flexDirection="column" gap={1}>
                <text fg={TUI_COLORS.text.primary}>
                  Fix all discovered findings in one batch run.
                </text>
                <text fg={TUI_COLORS.text.dim}>
                  The fixer will be invoked as `rr fix --session {sessionId} --all`.
                </text>
              </box>
            ) : mode === "priority" ? (
              <scrollbox height={listHeight}>
                {PRIORITIES.map((priority, index) => {
                  const selected = selectedPriorities.includes(priority);
                  const count =
                    priorityCounts.find((item) => item.priority === priority)?.count ?? 0;

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
                      <text fg={TUI_COLORS.text.dim}>{count} findings</text>
                    </box>
                  );
                })}
              </scrollbox>
            ) : (
              <scrollbox height={listHeight}>
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
      </box>
    </box>
  );
}
