import type { ScrollBoxRenderable, TabSelectRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CLI_PATH } from "@/lib/paths";
import type { FindingId, StoredFinding } from "@/lib/review-workflow/findings/types";
import { toSingleLine } from "@/lib/tui/sessions/detail/session-detail-parts";
import { formatFindingTitleForDisplay } from "@/lib/tui/sessions/finding-title";
import { PRIORITY_COLORS } from "@/lib/tui/sessions/session-display";
import { TUI_COLORS } from "@/lib/tui/shared/colors";
import type { Priority } from "@/lib/types";

export interface FixIssuesOverlayProps {
  sessionId: string;
  projectPath: string;
  findings: StoredFinding[];
  onClose: () => void;
}

type FixSelectionMode = "all" | "priority" | "id";
type OverlayFocus = "list" | "filter";

const PRIORITIES: Priority[] = ["P0", "P1", "P2", "P3"];
const MODE_ORDER: FixSelectionMode[] = ["all", "priority", "id"];

interface FindingRowSegment {
  text: string;
  color?: string;
}

interface FindingRowLine {
  segments: FindingRowSegment[];
}

interface WrappedFindingRow {
  finding: StoredFinding;
  lines: FindingRowLine[];
}

function clampIndex(index: number, max: number): number {
  if (max <= 0) {
    return 0;
  }

  return Math.min(Math.max(index, 0), max - 1);
}

function formatCountLabel(count: number): string {
  return `${count} finding${count === 1 ? "" : "s"}`;
}

function truncateHead(value: string, maxLength: number): string {
  if (maxLength <= 1) {
    return "…";
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `…${value.slice(-(maxLength - 1))}`;
}

function takeWrappedLine(value: string, maxWidth: number): { line: string; rest: string } {
  const normalized = toSingleLine(value);
  if (normalized.length === 0 || maxWidth <= 0) {
    return { line: "", rest: normalized };
  }

  if (normalized.length <= maxWidth) {
    return { line: normalized, rest: "" };
  }

  const slice = normalized.slice(0, maxWidth + 1);
  const breakIndex = slice.lastIndexOf(" ");
  if (breakIndex > 0) {
    return {
      line: normalized.slice(0, breakIndex).trimEnd(),
      rest: normalized.slice(breakIndex + 1).trimStart(),
    };
  }

  return {
    line: normalized.slice(0, maxWidth),
    rest: normalized.slice(maxWidth).trimStart(),
  };
}

function wrapText(value: string, maxWidth: number): string[] {
  const normalized = toSingleLine(value);
  if (normalized.length === 0) {
    return [""];
  }

  if (maxWidth <= 0) {
    return [normalized];
  }

  const lines: string[] = [];
  let remaining = normalized;

  while (remaining.length > 0) {
    const { line, rest } = takeWrappedLine(remaining, maxWidth);
    if (line.length === 0 && rest.length === remaining.length) {
      break;
    }
    lines.push(line);
    remaining = rest;
  }

  return lines;
}

function wrapTextWithInitialWidth(
  value: string,
  firstLineWidth: number,
  remainingWidth: number
): string[] {
  const normalized = toSingleLine(value);
  if (normalized.length === 0) {
    return [""];
  }

  if (firstLineWidth <= 0) {
    return wrapText(normalized, remainingWidth);
  }

  const firstLine = takeWrappedLine(normalized, firstLineWidth);
  if (firstLine.rest.length === 0) {
    return [firstLine.line];
  }

  return [firstLine.line, ...wrapText(firstLine.rest, remainingWidth)];
}

export function buildWrappedFindingRow(
  finding: StoredFinding,
  options: {
    isSelected: boolean;
    contentWidth: number;
  }
): WrappedFindingRow {
  const checkbox = options.isSelected ? "[x]" : "[ ]";
  const findingIdPrefix = `${checkbox} ${finding.id} `;
  const priorityText = `[${finding.priority}]`;
  const title = toSingleLine(formatFindingTitleForDisplay(finding.title));
  const availableWidth = Math.max(1, options.contentWidth - 2);
  const firstLineTitleWidth = Math.max(
    0,
    availableWidth - findingIdPrefix.length - priorityText.length - 1
  );
  const titleLines = wrapTextWithInitialWidth(title, firstLineTitleWidth, availableWidth);
  const firstTitleLine = firstLineTitleWidth > 0 ? (titleLines[0] ?? "") : "";
  const continuationLines = firstLineTitleWidth > 0 ? titleLines.slice(1) : titleLines;

  return {
    finding,
    lines: [
      {
        segments: [
          { text: findingIdPrefix },
          { text: priorityText, color: PRIORITY_COLORS[finding.priority] },
          ...(firstTitleLine.length > 0 ? [{ text: ` ${firstTitleLine}` }] : []),
        ],
      },
      ...continuationLines.map((line) => ({
        segments: [{ text: line }],
      })),
    ],
  };
}

function sortSelectedPriorities(selectedPriorities: Priority[]): Priority[] {
  return PRIORITIES.filter((priority) => selectedPriorities.includes(priority));
}

function sortSelectedFindingIds(
  selectedFindingIds: FindingId[],
  findings: StoredFinding[]
): FindingId[] {
  const selectedIds = new Set(selectedFindingIds);
  return findings.map((finding) => finding.id).filter((findingId) => selectedIds.has(findingId));
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

function buildFixCommandPreview(
  sessionId: string,
  mode: FixSelectionMode,
  selectedPriorities: Priority[],
  selectedFindingIds: FindingId[]
): string | null {
  const args = buildFixCommandArgs(sessionId, mode, selectedPriorities, selectedFindingIds);
  return args ? `rr ${args.join(" ")}` : null;
}

function buildFindingFilterText(finding: StoredFinding): string {
  return [
    finding.id,
    finding.priority,
    formatFindingTitleForDisplay(finding.title),
    finding.filePath,
    `${finding.startLine}-${finding.endLine}`,
  ]
    .join(" ")
    .toLowerCase();
}

function filterFindings(findings: StoredFinding[], query: string): StoredFinding[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return findings;
  }

  return findings.filter((finding) => buildFindingFilterText(finding).includes(normalizedQuery));
}

function getSelectionDisabledReason(
  mode: FixSelectionMode,
  selectedPriorities: Priority[],
  selectedFindingIds: FindingId[]
): string | null {
  if (mode === "priority" && selectedPriorities.length === 0) {
    return "Select at least one priority to enable Run.";
  }

  if (mode === "id" && selectedFindingIds.length === 0) {
    return "Select at least one finding to enable Run.";
  }

  return null;
}

function DetailField({
  label,
  value,
  color = TUI_COLORS.text.secondary,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <box flexDirection="column">
      <text fg={TUI_COLORS.text.dim}>
        <strong>{label}</strong>
      </text>
      <text fg={color}>{value}</text>
    </box>
  );
}

export function FixIssuesOverlay({
  sessionId,
  projectPath,
  findings,
  onClose,
}: FixIssuesOverlayProps) {
  const { width: terminalWidth, height: terminalHeight } = useTerminalDimensions();
  const tabSelectRef = useRef<TabSelectRenderable>(null);
  const findingListRef = useRef<ScrollBoxRenderable>(null);
  const [mode, setMode] = useState<FixSelectionMode>("all");
  const [focusArea, setFocusArea] = useState<OverlayFocus>("list");
  const [priorityIndex, setPriorityIndex] = useState(0);
  const [findingIndex, setFindingIndex] = useState(0);
  const [selectedPriorities, setSelectedPriorities] = useState<Priority[]>([]);
  const [selectedFindingIds, setSelectedFindingIds] = useState<FindingId[]>([]);
  const [filterQuery, setFilterQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isFixing, setIsFixing] = useState(false);

  const isWideLayout = terminalWidth >= 110 && terminalHeight >= 28;
  const contentWidth = Math.max(40, terminalWidth - 2);
  const contentHeight = Math.max(18, terminalHeight - 2);
  const selectionPanelWidth = isWideLayout
    ? Math.min(56, Math.max(44, Math.floor(contentWidth * 0.36)))
    : undefined;
  const stackedSelectionHeight = Math.max(
    mode === "id" ? 12 : 7,
    Math.floor(contentHeight * (mode === "id" ? 0.48 : 0.3))
  );
  const selectionPanelContentWidth = Math.max(
    18,
    (selectionPanelWidth ?? contentWidth) - (mode === "id" ? 8 : 6)
  );

  const priorityCounts = useMemo(
    () =>
      PRIORITIES.map((priority) => ({
        priority,
        count: findings.filter((finding) => finding.priority === priority).length,
      })),
    [findings]
  );

  const filteredFindings = useMemo(
    () => filterFindings(findings, filterQuery),
    [filterQuery, findings]
  );

  const impactedFiles = useMemo(() => {
    const counts = new Map<string, number>();
    for (const finding of findings) {
      counts.set(finding.filePath, (counts.get(finding.filePath) ?? 0) + 1);
    }

    return [...counts.entries()]
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => {
        if (b.count !== a.count) {
          return b.count - a.count;
        }
        return a.path.localeCompare(b.path);
      });
  }, [findings]);

  const selectedPriorityFindingIds = useMemo(() => {
    const activePriorities = new Set(selectedPriorities);
    return findings
      .filter((finding) => activePriorities.has(finding.priority))
      .map((finding) => finding.id);
  }, [findings, selectedPriorities]);

  const effectiveSelectedFindingIds = useMemo(() => {
    if (mode === "all") {
      return findings.map((finding) => finding.id);
    }

    if (mode === "priority") {
      return selectedPriorityFindingIds;
    }

    return sortSelectedFindingIds(selectedFindingIds, findings);
  }, [findings, mode, selectedFindingIds, selectedPriorityFindingIds]);

  const currentPriority = PRIORITIES[clampIndex(priorityIndex, PRIORITIES.length)] ?? "P0";
  const currentFinding =
    filteredFindings.length === 0
      ? null
      : filteredFindings[clampIndex(findingIndex, filteredFindings.length)];

  const currentPriorityFindings = useMemo(
    () => findings.filter((finding) => finding.priority === currentPriority),
    [currentPriority, findings]
  );
  const wrappedFindingRows = useMemo(
    () =>
      filteredFindings.map((finding) =>
        buildWrappedFindingRow(finding, {
          isSelected: selectedFindingIds.includes(finding.id),
          contentWidth: selectionPanelContentWidth,
        })
      ),
    [filteredFindings, selectedFindingIds, selectionPanelContentWidth]
  );

  const pendingCountLabel = `${findings.length} pending`;
  const selectedCountLabel = `Selected ${effectiveSelectedFindingIds.length} of ${findings.length}`;
  const baseCommandPreview = `rr fix --session ${sessionId}`;
  const commandPreview = buildFixCommandPreview(
    sessionId,
    mode,
    selectedPriorities,
    sortSelectedFindingIds(selectedFindingIds, findings)
  );
  const disabledReason = getSelectionDisabledReason(mode, selectedPriorities, selectedFindingIds);
  const fullCommand = commandPreview ?? baseCommandPreview;
  const commandTail = fullCommand.startsWith("rr fix")
    ? fullCommand.slice("rr fix".length)
    : ` ${fullCommand}`;

  const pathReservedRight = selectedCountLabel.length + 3;
  const maxPathWidth = Math.max(10, terminalWidth - 2 - pathReservedRight);

  useEffect(() => {
    if (mode !== "id" && focusArea === "filter") {
      setFocusArea("list");
    }
  }, [focusArea, mode]);

  useEffect(() => {
    tabSelectRef.current?.setSelectedIndex(MODE_ORDER.indexOf(mode));
  }, [mode]);

  useEffect(() => {
    if (filteredFindings.length === 0) {
      if (findingIndex !== 0) {
        setFindingIndex(0);
      }
      return;
    }

    const nextIndex = clampIndex(findingIndex, filteredFindings.length);
    if (nextIndex !== findingIndex) {
      setFindingIndex(nextIndex);
    }
  }, [filteredFindings.length, findingIndex]);

  useEffect(() => {
    if (mode !== "id" || focusArea !== "list" || wrappedFindingRows.length === 0) {
      return;
    }

    const list = findingListRef.current;
    if (!list) {
      return;
    }

    const currentIndex = clampIndex(findingIndex, wrappedFindingRows.length);
    const top = wrappedFindingRows
      .slice(0, currentIndex)
      .reduce((total, row) => total + row.lines.length, 0);
    const currentHeight = wrappedFindingRows[currentIndex]?.lines.length ?? 1;
    const bottom = top + currentHeight;
    const viewportHeight = Math.max(1, list.height);

    if (top < list.scrollTop) {
      list.scrollTop = top;
      return;
    }

    if (bottom > list.scrollTop + viewportHeight) {
      list.scrollTop = Math.max(0, bottom - viewportHeight);
    }
  }, [findingIndex, focusArea, mode, wrappedFindingRows]);

  const setActiveMode = useCallback((nextMode: FixSelectionMode) => {
    setMode(nextMode);
    setError(null);
    setFocusArea((currentFocus) => (nextMode === "id" ? currentFocus : "list"));
  }, []);

  const cycleMode = useCallback(
    (direction: -1 | 1) => {
      const currentIndex = MODE_ORDER.indexOf(mode);
      const nextIndex = clampIndex(currentIndex + direction, MODE_ORDER.length);
      const nextMode = MODE_ORDER[nextIndex];
      if (nextMode) {
        setActiveMode(nextMode);
      }
    },
    [mode, setActiveMode]
  );

  const closeOverlay = useCallback(() => {
    if (isFixing) {
      return;
    }

    onClose();
  }, [isFixing, onClose]);

  const toggleCurrentPriority = useCallback(() => {
    const priority = PRIORITIES[clampIndex(priorityIndex, PRIORITIES.length)];
    if (!priority) {
      return;
    }

    setSelectedPriorities((current) => {
      const next = current.includes(priority)
        ? current.filter((value) => value !== priority)
        : [...current, priority];
      return sortSelectedPriorities(next);
    });
    setError(null);
  }, [priorityIndex]);

  const toggleCurrentFindingId = useCallback(() => {
    const highlightedFinding =
      filteredFindings.length === 0
        ? null
        : filteredFindings[clampIndex(findingIndex, filteredFindings.length)];
    if (!highlightedFinding) {
      return;
    }

    setSelectedFindingIds((current) => {
      const next = current.includes(highlightedFinding.id)
        ? current.filter((value) => value !== highlightedFinding.id)
        : [...current, highlightedFinding.id];
      return sortSelectedFindingIds(next, findings);
    });
    setError(null);
  }, [filteredFindings, findingIndex, findings]);

  const confirmFixSelection = useCallback(async () => {
    if (isFixing) {
      return;
    }

    const commandArgs = buildFixCommandArgs(
      sessionId,
      mode,
      selectedPriorities,
      sortSelectedFindingIds(selectedFindingIds, findings)
    );
    if (!commandArgs) {
      setError(disabledReason ?? "Choose a valid fix selection.");
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
  }, [
    disabledReason,
    findings,
    isFixing,
    mode,
    onClose,
    projectPath,
    selectedFindingIds,
    selectedPriorities,
    sessionId,
  ]);

  const handleListKeyDown = useCallback(
    (key: { name: string }) => {
      if (focusArea === "filter") {
        return;
      }

      if (key.name === "escape" || key.name === "q") {
        closeOverlay();
        return;
      }

      if (findings.length === 0) {
        return;
      }

      if (key.name === "left") {
        cycleMode(-1);
        return;
      }

      if (key.name === "right") {
        cycleMode(1);
        return;
      }

      if (mode === "id" && (key.name === "/" || key.name === "tab")) {
        setFocusArea("filter");
        return;
      }

      if (mode === "id" && key.name === "up") {
        setFindingIndex((current) => clampIndex(current - 1, filteredFindings.length));
        setError(null);
        return;
      }

      if (mode === "id" && key.name === "down") {
        setFindingIndex((current) => clampIndex(current + 1, filteredFindings.length));
        setError(null);
        return;
      }

      if (key.name === "enter" || key.name === "return") {
        void confirmFixSelection();
        return;
      }

      if (key.name === "space") {
        if (mode === "priority") {
          toggleCurrentPriority();
          return;
        }

        if (mode === "id") {
          toggleCurrentFindingId();
        }
      }
    },
    [
      closeOverlay,
      confirmFixSelection,
      cycleMode,
      findings.length,
      focusArea,
      filteredFindings.length,
      mode,
      toggleCurrentFindingId,
      toggleCurrentPriority,
    ]
  );

  useKeyboard(handleListKeyDown);

  const actionMessage = error
    ? error
    : isFixing
      ? "Starting rr fix..."
      : disabledReason
        ? disabledReason
        : "Press Enter to run the selected fix batch.";

  const actionColor = error
    ? TUI_COLORS.status.error
    : isFixing
      ? TUI_COLORS.status.pending
      : disabledReason
        ? TUI_COLORS.status.warning
        : TUI_COLORS.text.muted;

  const selectionBorderColor =
    focusArea === "filter" || mode !== "all" ? TUI_COLORS.ui.borderFocused : TUI_COLORS.ui.border;

  const priorityOptions = priorityCounts.map((item) => ({
    name: `${selectedPriorities.includes(item.priority) ? "[x]" : "[ ]"} ${item.priority} · ${formatCountLabel(item.count)}`,
    description: "",
    value: item.priority,
  }));

  const updateFilterQuery = useCallback((nextValue: string) => {
    setFilterQuery(nextValue);
    setError(null);
  }, []);

  if (findings.length === 0) {
    return (
      <box
        position="absolute"
        left={0}
        top={0}
        width="100%"
        height="100%"
        backgroundColor="#0d0d1a"
        justifyContent="center"
        alignItems="center"
      >
        <box flexDirection="column" gap={1} alignItems="center">
          <text fg={TUI_COLORS.text.primary}>
            <strong>Fix Issues</strong>
          </text>
          <text fg={TUI_COLORS.text.muted}>No pending findings.</text>
          <text>
            <span fg={TUI_COLORS.accent.key}>[Esc]</span>
            <span fg={TUI_COLORS.text.muted}> Close</span>
          </text>
        </box>
      </box>
    );
  }

  function renderSelectionPanel() {
    if (mode === "all") {
      return (
        <box flexDirection="column" gap={1} flexGrow={1} minHeight={0}>
          <text fg={TUI_COLORS.text.secondary}>
            <strong>Batch everything pending</strong>
          </text>
          <text fg={TUI_COLORS.text.muted}>
            The fixer receives all {formatCountLabel(findings.length)} in one run.
          </text>
          <text fg={TUI_COLORS.text.dim}>
            <span>Press </span>
            <span fg={TUI_COLORS.accent.key}>Enter</span>
            <span> to start, or switch tabs to narrow scope.</span>
          </text>
        </box>
      );
    }

    if (mode === "priority") {
      return (
        <box flexDirection="column" gap={1} flexGrow={1} minHeight={0}>
          <text fg={TUI_COLORS.text.muted}>Select one or more priorities to batch together.</text>
          <select
            options={priorityOptions}
            selectedIndex={clampIndex(priorityIndex, PRIORITIES.length)}
            focused={focusArea === "list"}
            flexGrow={1}
            showDescription={false}
            showScrollIndicator
            selectedBackgroundColor="#1f2940"
            selectedTextColor={TUI_COLORS.text.primary}
            descriptionColor={TUI_COLORS.text.dim}
            onChange={(index) => {
              setPriorityIndex(index);
              setError(null);
            }}
          />
        </box>
      );
    }

    return (
      <box flexDirection="column" gap={1} flexGrow={1} minHeight={0}>
        <text fg={TUI_COLORS.text.dim}>
          <strong>Filter issues</strong>
        </text>
        <input
          value={filterQuery}
          onChange={updateFilterQuery}
          onInput={updateFilterQuery}
          onSubmit={() => {
            setFocusArea("list");
          }}
          onKeyDown={(key) => {
            if (key.name === "escape" || key.name === "down" || key.name === "tab") {
              setFocusArea("list");
            }
          }}
          placeholder="Type ID, title, path, or priority"
          focused={focusArea === "filter"}
          width="100%"
          backgroundColor="#111827"
          focusedBackgroundColor="#0f172a"
          textColor={TUI_COLORS.text.primary}
          placeholderColor={TUI_COLORS.text.dim}
        />
        <text fg={TUI_COLORS.text.muted}>
          {filterQuery.trim().length === 0
            ? `Showing ${filteredFindings.length} issues`
            : `Showing ${filteredFindings.length} of ${findings.length} issues`}
        </text>
        {filteredFindings.length === 0 ? (
          <box flexGrow={1} justifyContent="center">
            <text fg={TUI_COLORS.text.dim}>No issues match the current filter.</text>
          </box>
        ) : (
          <scrollbox ref={findingListRef} focused={focusArea === "list"} flexGrow={1} scrollY>
            <box flexDirection="column">
              {wrappedFindingRows.map((row, index) => {
                const isHighlighted = index === clampIndex(findingIndex, wrappedFindingRows.length);
                const textColor = isHighlighted
                  ? TUI_COLORS.text.primary
                  : TUI_COLORS.text.secondary;

                return (
                  <box
                    key={row.finding.id}
                    flexDirection="column"
                    backgroundColor={isHighlighted ? "#1f2940" : undefined}
                    paddingLeft={1}
                  >
                    {row.lines.map((line, lineIndex) => (
                      <text key={`${row.finding.id}-${lineIndex}`} fg={textColor} wrapMode="none">
                        <span>{lineIndex === 0 && isHighlighted ? "▶ " : "  "}</span>
                        {line.segments.map((segment, segmentIndex) => (
                          <span
                            key={`${row.finding.id}-${lineIndex}-${segmentIndex}`}
                            fg={segment.color ?? textColor}
                          >
                            {segment.text}
                          </span>
                        ))}
                      </text>
                    ))}
                  </box>
                );
              })}
            </box>
          </scrollbox>
        )}
      </box>
    );
  }

  function renderPriorityDetail() {
    const isPrioritySelected = selectedPriorities.includes(currentPriority);

    return (
      <scrollbox flexGrow={1}>
        <box flexDirection="column" gap={1}>
          <DetailField
            label="Scope"
            value={`Priority ${currentPriority}`}
            color={PRIORITY_COLORS[currentPriority]}
          />
          <DetailField
            label="Status"
            value={disabledReason ?? "Ready to run this priority batch."}
            color={disabledReason ? TUI_COLORS.status.warning : TUI_COLORS.text.secondary}
          />
          <DetailField
            label="Selection"
            value={isPrioritySelected ? "Included in this batch" : "Not selected"}
            color={isPrioritySelected ? TUI_COLORS.status.success : TUI_COLORS.text.muted}
          />
          <DetailField label="Matches" value={formatCountLabel(currentPriorityFindings.length)} />
          <text fg={TUI_COLORS.text.dim}>
            <strong>Matching Issues</strong>
          </text>
          {currentPriorityFindings.length === 0 ? (
            <text fg={TUI_COLORS.text.dim}>No issues in this priority.</text>
          ) : (
            currentPriorityFindings.map((finding) => (
              <box key={finding.id} flexDirection="column">
                <text fg={TUI_COLORS.text.secondary}>
                  {finding.id} {toSingleLine(formatFindingTitleForDisplay(finding.title))}
                </text>
                <text fg={TUI_COLORS.text.dim}>
                  {finding.filePath}:{finding.startLine}-{finding.endLine}
                </text>
              </box>
            ))
          )}
        </box>
      </scrollbox>
    );
  }

  function renderFindingDetail() {
    if (!currentFinding) {
      return (
        <scrollbox flexGrow={1}>
          <box flexDirection="column" gap={1}>
            <DetailField label="Scope" value="Issue selection" />
            <text fg={TUI_COLORS.text.dim}>No issues match the current filter.</text>
          </box>
        </scrollbox>
      );
    }

    const isSelected = selectedFindingIds.includes(currentFinding.id);

    return (
      <scrollbox flexGrow={1}>
        <box flexDirection="column" gap={1}>
          <DetailField
            label="Issue"
            value={`${currentFinding.id} [${currentFinding.priority}]`}
            color={PRIORITY_COLORS[currentFinding.priority]}
          />
          <DetailField label="Title" value={formatFindingTitleForDisplay(currentFinding.title)} />
          <text fg={TUI_COLORS.text.dim}>
            <strong>Body</strong>
          </text>
          {currentFinding.body.split("\n").map((line, index) => (
            <text key={`${currentFinding.id}-body-${index}`} fg={TUI_COLORS.text.secondary}>
              {line}
            </text>
          ))}
          <DetailField
            label="Selection"
            value={isSelected ? "Included in this batch" : "Not selected"}
            color={isSelected ? TUI_COLORS.status.success : TUI_COLORS.text.muted}
          />
          <DetailField
            label="Location"
            value={`${currentFinding.filePath}:${currentFinding.startLine}-${currentFinding.endLine}`}
          />
        </box>
      </scrollbox>
    );
  }

  function renderAllDetail() {
    return (
      <scrollbox flexGrow={1}>
        <box flexDirection="column" gap={1}>
          <DetailField label="Scope" value="All pending issues" />
          <text fg={TUI_COLORS.text.dim}>
            <strong>What runs</strong>
          </text>
          <text fg={TUI_COLORS.text.secondary}>
            Every pending finding, passed together via --all.
          </text>
          <text fg={TUI_COLORS.text.dim}>
            <strong>Impacted files</strong>
          </text>
          {impactedFiles.length === 0 ? (
            <text fg={TUI_COLORS.text.dim}>No findings.</text>
          ) : (
            impactedFiles.map(({ path, count }) => (
              <box key={path} flexDirection="row" justifyContent="space-between">
                <text fg={TUI_COLORS.text.secondary} wrapMode="none">
                  {path}
                </text>
                <text fg={TUI_COLORS.text.muted}>{formatCountLabel(count)}</text>
              </box>
            ))
          )}
        </box>
      </scrollbox>
    );
  }

  const tabOptions = [
    { name: "All", description: "Fix every pending issue", value: "all" },
    { name: "Priority", description: "Select by priority", value: "priority" },
    { name: "Issues", description: "Select specific issues", value: "id" },
  ];

  const footerKeys: Array<[string, string]> = [
    ["←/→", "Scope"],
    ["↑/↓", "Move"],
    ["Space", "Toggle"],
    ...(mode === "id" ? ([["/", "Filter"]] as Array<[string, string]>) : []),
    ["Enter", "Run"],
    ["Esc", mode === "id" && focusArea === "filter" ? "Back" : "Close"],
  ];

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      backgroundColor="#0d0d1a"
      flexDirection="column"
      padding={1}
      gap={1}
    >
      <box flexDirection="column" height={3} flexShrink={0}>
        <box flexDirection="row" justifyContent="space-between" height={1} flexShrink={0}>
          <text>
            <span fg={TUI_COLORS.text.primary}>
              <strong>Fix Issues</strong>
            </span>
            <span fg={TUI_COLORS.text.dim}> · </span>
            <span fg={TUI_COLORS.text.secondary}>Session {sessionId}</span>
          </text>
          <text fg={TUI_COLORS.text.secondary}>{pendingCountLabel}</text>
        </box>

        <box flexDirection="row" justifyContent="space-between" height={1} flexShrink={0}>
          <text fg={TUI_COLORS.text.dim} wrapMode="none">
            {truncateHead(projectPath, maxPathWidth)}
          </text>
          <text fg={TUI_COLORS.text.muted}>{selectedCountLabel}</text>
        </box>

        <box flexDirection="row" gap={1} flexWrap="wrap" height={1} flexShrink={0}>
          {priorityCounts.map((item) => (
            <box key={item.priority}>
              <text>
                <span fg={TUI_COLORS.text.dim}>[</span>
                <span fg={PRIORITY_COLORS[item.priority]}>{item.priority}</span>
                <span fg={TUI_COLORS.text.dim}>]</span>
                <span fg={TUI_COLORS.text.muted}> {item.count}</span>
              </text>
            </box>
          ))}
        </box>
      </box>

      <tab-select
        ref={tabSelectRef}
        options={tabOptions}
        showDescription={false}
        showUnderline
        tabWidth={isWideLayout ? 18 : 14}
        onChange={(index) => {
          const nextMode = MODE_ORDER[index];
          if (nextMode) {
            setActiveMode(nextMode);
          }
        }}
        onSelect={(index) => {
          const nextMode = MODE_ORDER[index];
          if (nextMode) {
            setActiveMode(nextMode);
          }
        }}
      />

      <box flexDirection={isWideLayout ? "row" : "column"} gap={1} flexGrow={1} minHeight={0}>
        <box
          border
          borderStyle="rounded"
          borderColor={selectionBorderColor}
          title="Selection"
          titleAlignment="left"
          width={selectionPanelWidth}
          height={isWideLayout ? undefined : stackedSelectionHeight}
          flexShrink={0}
          flexDirection="column"
          padding={1}
          minHeight={0}
        >
          {renderSelectionPanel()}
        </box>

        <box
          border
          borderStyle="rounded"
          borderColor={TUI_COLORS.ui.border}
          title="Details"
          titleAlignment="left"
          flexGrow={1}
          minHeight={0}
          flexDirection="column"
          padding={1}
        >
          {mode === "all"
            ? renderAllDetail()
            : mode === "priority"
              ? renderPriorityDetail()
              : renderFindingDetail()}
        </box>
      </box>

      <box
        flexDirection="column"
        backgroundColor="#111827"
        paddingLeft={1}
        paddingRight={1}
        height={2}
        flexShrink={0}
      >
        <box height={1} flexShrink={0}>
          <text wrapMode="none">
            <span fg={TUI_COLORS.accent.key}>
              <strong>rr fix</strong>
            </span>
            <span fg={TUI_COLORS.text.faint}>{commandTail}</span>
          </text>
        </box>
        <box height={1} flexShrink={0}>
          <text fg={actionColor}>{actionMessage}</text>
        </box>
      </box>

      <box
        flexDirection="row"
        gap={2}
        backgroundColor="#0f172a"
        paddingLeft={1}
        paddingRight={1}
        height={1}
        flexShrink={0}
      >
        {footerKeys.map(([key, label]) => (
          <text key={key}>
            <span fg={TUI_COLORS.accent.key}>[{key}]</span>
            <span fg={TUI_COLORS.text.muted}> {label}</span>
          </text>
        ))}
      </box>
    </box>
  );
}
