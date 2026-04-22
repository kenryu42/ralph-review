import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FindingSelectionMode } from "@/lib/review-workflow/findings/selection";
import type { FindingId, StoredFinding } from "@/lib/review-workflow/findings/types";
import { toSingleLine } from "@/lib/tui/sessions/detail/session-detail-parts";
import { formatFindingTitleForDisplay } from "@/lib/tui/sessions/finding-title";
import { buildPriorityTextSegments, PriorityText } from "@/lib/tui/sessions/priority-text";
import { TUI_COLORS } from "@/lib/tui/shared/colors";
import type { Priority } from "@/lib/types";
import { VALID_PRIORITIES as PRIORITIES } from "@/lib/types/domain";

export interface FixIssuesOverlayProps {
  sessionId: string;
  projectPath: string;
  findings: StoredFinding[];
  onSubmit: (args: string[]) => void;
  onClose: () => void;
}

type OverlayFocus = "list" | "filter";
type OverlayPane = "selection" | "details";

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

interface PrioritySelectionRow {
  priority: Priority;
  lines: FindingRowLine[];
}

type NavigableRowId = "all" | `priority:${Priority}` | `issue:${FindingId}`;

type NavigableRow =
  | { kind: "header"; id: string; label: string }
  | { kind: "all"; id: "all"; lines: FindingRowLine[] }
  | {
      kind: "priority";
      id: `priority:${Priority}`;
      priority: Priority;
      lines: FindingRowLine[];
    }
  | {
      kind: "issue";
      id: `issue:${FindingId}`;
      finding: StoredFinding;
      lines: FindingRowLine[];
    };

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
  const title = toSingleLine(formatFindingTitleForDisplay(finding.title));
  const availableWidth = Math.max(1, options.contentWidth - 2);
  const firstLineTitleWidth = Math.max(
    0,
    availableWidth - findingIdPrefix.length - "[P0]".length - 1
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
          ...buildPriorityTextSegments(finding.priority, { bracketed: true }),
          ...(firstTitleLine.length > 0 ? [{ text: ` ${firstTitleLine}` }] : []),
        ],
      },
      ...continuationLines.map((line) => ({
        segments: [{ text: line }],
      })),
    ],
  };
}

function buildPrioritySelectionRow(
  priority: Priority,
  count: number,
  isSelected: boolean
): PrioritySelectionRow {
  return {
    priority,
    lines: [
      {
        segments: [
          { text: `${isSelected ? "[x]" : "[ ]"} ` },
          ...buildPriorityTextSegments(priority),
          { text: ` · ${formatCountLabel(count)}` },
        ],
      },
    ],
  };
}

function buildAllSelectionRow(totalCount: number, isSelected: boolean): FindingRowLine[] {
  return [
    {
      segments: [
        { text: `${isSelected ? "[x]" : "[ ]"} ` },
        { text: `Fix all pending (${totalCount})` },
      ],
    },
  ];
}

function formatConfidenceScore(value: number): string {
  return `${Math.round(value * 100)}%`;
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
  mode: FindingSelectionMode,
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
  mode: FindingSelectionMode,
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
  mode: FindingSelectionMode,
  allSelected: boolean,
  selectedPriorities: Priority[],
  selectedFindingIds: FindingId[]
): string | null {
  if (!allSelected && selectedPriorities.length === 0 && selectedFindingIds.length === 0) {
    return "Select a scope to enable Run.";
  }

  if (mode === "priority" && selectedPriorities.length === 0) {
    return "Select at least one priority to enable Run.";
  }

  if (mode === "id" && selectedFindingIds.length === 0) {
    return "Select at least one finding to enable Run.";
  }

  return null;
}

function rowLineCount(row: NavigableRow): number {
  switch (row.kind) {
    case "header":
      return 1;
    case "all":
    case "priority":
    case "issue":
      return row.lines.length;
  }
}

function DetailField({
  label,
  value,
  color = TUI_COLORS.text.secondary,
}: {
  label: string;
  value: React.ReactNode;
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
  onSubmit,
  onClose,
}: FixIssuesOverlayProps) {
  const { width: terminalWidth, height: terminalHeight } = useTerminalDimensions();
  const selectionListRef = useRef<ScrollBoxRenderable>(null);
  const [allSelected, setAllSelected] = useState(true);
  const [selectedPriorities, setSelectedPriorities] = useState<Priority[]>([]);
  const [selectedFindingIds, setSelectedFindingIds] = useState<FindingId[]>([]);
  const [cursorRowId, setCursorRowId] = useState<NavigableRowId>("all");
  const [focusArea, setFocusArea] = useState<OverlayFocus>("list");
  const [focusedPane, setFocusedPane] = useState<OverlayPane>("selection");
  const [filterQuery, setFilterQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isWideLayout = terminalWidth >= 110 && terminalHeight >= 28;
  const contentWidth = Math.max(40, terminalWidth - 2);
  const contentHeight = Math.max(18, terminalHeight - 2);
  const selectionPanelWidth = isWideLayout
    ? Math.min(56, Math.max(44, Math.floor(contentWidth * 0.36)))
    : undefined;
  const stackedSelectionHeight = Math.max(12, Math.floor(contentHeight * 0.48));
  const selectionPanelContentWidth = Math.max(18, (selectionPanelWidth ?? contentWidth) - 8);

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
  const selectedPrioritySet = useMemo(() => new Set(selectedPriorities), [selectedPriorities]);
  const orderedSelectedFindingIds = useMemo(
    () => sortSelectedFindingIds(selectedFindingIds, findings),
    [selectedFindingIds, findings]
  );
  const selectedFindingIdSet = useMemo(
    () => new Set(orderedSelectedFindingIds),
    [orderedSelectedFindingIds]
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

  const mode: FindingSelectionMode = allSelected
    ? "all"
    : selectedPriorities.length > 0
      ? "priority"
      : "id";

  const selectedCount = useMemo(() => {
    if (mode === "all") {
      return findings.length;
    }

    if (mode === "priority") {
      return findings.filter((finding) => selectedPrioritySet.has(finding.priority)).length;
    }

    return orderedSelectedFindingIds.length;
  }, [findings, mode, orderedSelectedFindingIds, selectedPrioritySet]);

  const rows = useMemo<NavigableRow[]>(() => {
    const allRow: NavigableRow = {
      kind: "all",
      id: "all",
      lines: buildAllSelectionRow(findings.length, allSelected),
    };

    const priorityRows: NavigableRow[] = priorityCounts.map(({ priority, count }) => ({
      kind: "priority",
      id: `priority:${priority}` as const,
      priority,
      lines: buildPrioritySelectionRow(priority, count, selectedPrioritySet.has(priority)).lines,
    }));

    const issueRows: NavigableRow[] = filteredFindings.map((finding) => ({
      kind: "issue",
      id: `issue:${finding.id}` as const,
      finding,
      lines: buildWrappedFindingRow(finding, {
        isSelected: selectedFindingIdSet.has(finding.id),
        contentWidth: selectionPanelContentWidth,
      }).lines,
    }));

    return [
      { kind: "header", id: "header:quick", label: "Quick action" },
      allRow,
      { kind: "header", id: "header:priority", label: "By priority" },
      ...priorityRows,
      { kind: "header", id: "header:issue", label: "By issue" },
      ...issueRows,
    ];
  }, [
    allSelected,
    filteredFindings,
    findings.length,
    priorityCounts,
    selectedFindingIdSet,
    selectedPrioritySet,
    selectionPanelContentWidth,
  ]);

  const navigableIds = useMemo(
    () => rows.filter((row) => row.kind !== "header").map((row) => row.id),
    [rows]
  );

  useEffect(() => {
    if (!navigableIds.includes(cursorRowId)) {
      const fallback =
        navigableIds.find((id) => id.startsWith("issue:")) ?? navigableIds[0] ?? "all";
      setCursorRowId(fallback);
    }
  }, [cursorRowId, navigableIds]);

  const currentRow = useMemo(
    () => rows.find((row) => row.id === cursorRowId) ?? null,
    [cursorRowId, rows]
  );

  const pendingCountLabel = `${findings.length} pending`;
  const selectedCountLabel = `Selected ${selectedCount} of ${findings.length}`;
  const baseCommandPreview = `rr fix --session ${sessionId}`;
  const commandPreview = buildFixCommandPreview(
    sessionId,
    mode,
    selectedPriorities,
    orderedSelectedFindingIds
  );
  const disabledReason = getSelectionDisabledReason(
    mode,
    allSelected,
    selectedPriorities,
    selectedFindingIds
  );
  const fullCommand = commandPreview ?? baseCommandPreview;
  const commandTail = fullCommand.slice("rr fix".length);

  const pathReservedRight = selectedCountLabel.length + 3;
  const maxPathWidth = Math.max(10, terminalWidth - 2 - pathReservedRight);

  useEffect(() => {
    if (focusArea !== "list" || rows.length === 0) {
      return;
    }

    const list = selectionListRef.current;
    if (!list) {
      return;
    }

    const currentIndex = rows.findIndex((row) => row.id === cursorRowId);
    if (currentIndex < 0) {
      return;
    }

    let top = 0;
    for (let i = 0; i < currentIndex; i++) {
      const row = rows[i];
      if (!row) {
        continue;
      }
      top += rowLineCount(row);
      if (row.kind === "header" && i > 0) {
        top += 1;
      }
    }
    const currentRow = rows[currentIndex];
    const currentHeight = currentRow ? rowLineCount(currentRow) : 1;
    const bottom = top + currentHeight;
    const viewportHeight = Math.max(1, list.height);

    if (top < list.scrollTop) {
      list.scrollTop = top;
      return;
    }

    if (bottom > list.scrollTop + viewportHeight) {
      list.scrollTop = Math.max(0, bottom - viewportHeight);
    }
  }, [cursorRowId, focusArea, rows]);

  const cycleFocusedPane = useCallback(() => {
    setFocusedPane((current) => (current === "selection" ? "details" : "selection"));
  }, []);

  const closeOverlay = useCallback(() => {
    onClose();
  }, [onClose]);

  const moveCursor = useCallback(
    (direction: -1 | 1) => {
      if (rows.length === 0) {
        return;
      }

      let nextIndex = rows.findIndex((row) => row.id === cursorRowId);
      if (nextIndex < 0) {
        nextIndex = direction > 0 ? -1 : rows.length;
      }

      while (true) {
        const candidateIndex = clampIndex(nextIndex + direction, rows.length);
        if (candidateIndex === nextIndex) {
          return;
        }

        nextIndex = candidateIndex;
        const candidate = rows[nextIndex];
        if (!candidate || candidate.kind === "header") {
          continue;
        }

        setCursorRowId(candidate.id);
        setError(null);
        return;
      }
    },
    [cursorRowId, rows]
  );

  const toggleRow = useCallback(
    (row: NavigableRow) => {
      if (row.kind === "all") {
        if (allSelected) {
          setAllSelected(false);
        } else {
          setAllSelected(true);
          setSelectedPriorities([]);
          setSelectedFindingIds([]);
        }
        setError(null);
        return;
      }

      if (row.kind === "priority") {
        setAllSelected(false);
        setSelectedFindingIds([]);
        setSelectedPriorities((current) =>
          sortSelectedPriorities(
            current.includes(row.priority)
              ? current.filter((value) => value !== row.priority)
              : [...current, row.priority]
          )
        );
        setError(null);
        return;
      }

      if (row.kind === "issue") {
        setAllSelected(false);
        setSelectedPriorities([]);
        setSelectedFindingIds((current) =>
          sortSelectedFindingIds(
            current.includes(row.finding.id)
              ? current.filter((value) => value !== row.finding.id)
              : [...current, row.finding.id],
            findings
          )
        );
        setError(null);
      }
    },
    [allSelected, findings]
  );

  const confirmFixSelection = useCallback(() => {
    const commandArgs = buildFixCommandArgs(
      sessionId,
      mode,
      selectedPriorities,
      orderedSelectedFindingIds
    );
    if (!commandArgs) {
      setError(disabledReason ?? "Choose a valid fix selection.");
      return;
    }

    setError(null);
    onSubmit(commandArgs);
    onClose();
  }, [
    disabledReason,
    mode,
    onSubmit,
    onClose,
    orderedSelectedFindingIds,
    selectedPriorities,
    sessionId,
  ]);

  const focusFilter = useCallback(() => {
    setFocusedPane("selection");
    setFocusArea("filter");
    setError(null);
  }, []);

  const handleKeyDown = useCallback(
    (key: { name: string }) => {
      if (key.name === "tab") {
        cycleFocusedPane();
        return;
      }

      if (focusedPane === "selection" && focusArea === "filter") {
        return;
      }

      if (key.name === "escape" || key.name === "q") {
        closeOverlay();
        return;
      }

      if (findings.length === 0) {
        return;
      }

      if (key.name === "/" && focusedPane === "selection") {
        focusFilter();
        return;
      }

      if (focusedPane !== "selection") {
        if (key.name === "enter" || key.name === "return") {
          confirmFixSelection();
        }
        return;
      }

      const isMoveUp = key.name === "up" || key.name === "k";
      const isMoveDown = key.name === "down" || key.name === "j";

      if (isMoveUp || isMoveDown) {
        moveCursor(isMoveUp ? -1 : 1);
        return;
      }

      if (key.name === "enter" || key.name === "return") {
        confirmFixSelection();
        return;
      }

      if (key.name === "space") {
        if (currentRow && currentRow.kind !== "header") {
          toggleRow(currentRow);
        }
      }
    },
    [
      closeOverlay,
      confirmFixSelection,
      currentRow,
      cycleFocusedPane,
      findings.length,
      focusArea,
      focusedPane,
      focusFilter,
      moveCursor,
      toggleRow,
    ]
  );

  useKeyboard(handleKeyDown);

  const actionMessage = error
    ? error
    : disabledReason
      ? disabledReason
      : "Press Enter to run the selected fix batch.";

  const actionColor = error
    ? TUI_COLORS.status.error
    : disabledReason
      ? TUI_COLORS.status.warning
      : TUI_COLORS.text.muted;

  const selectionBorderColor =
    focusedPane === "selection" ? TUI_COLORS.ui.borderFocused : TUI_COLORS.ui.border;
  const detailsBorderColor =
    focusedPane === "details" ? TUI_COLORS.ui.borderFocused : TUI_COLORS.ui.border;
  const isFilterFocused = focusedPane === "selection" && focusArea === "filter";

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

  function renderRow(row: NavigableRow, index: number) {
    const isHighlighted = focusArea === "list" && row.id === cursorRowId && row.kind !== "header";
    const isHeader = row.kind === "header";
    const needsSpacer = isHeader && index > 0;

    if (row.kind === "header") {
      return (
        <box key={row.id} flexDirection="column">
          {needsSpacer ? <text> </text> : null}
          <text fg={TUI_COLORS.text.dim}>
            <strong>{row.label}</strong>
          </text>
        </box>
      );
    }

    const textColor = isHighlighted ? TUI_COLORS.text.primary : TUI_COLORS.text.secondary;

    return (
      <box
        key={row.id}
        flexDirection="column"
        backgroundColor={isHighlighted ? "#1f2940" : undefined}
        paddingLeft={1}
      >
        {row.lines.map((line, lineIndex) => (
          <text key={`${row.id}-${lineIndex}`} fg={textColor} wrapMode="none">
            <span>{lineIndex === 0 && isHighlighted ? "▶ " : "  "}</span>
            {line.segments.map((segment, segmentIndex) => (
              <span key={`${row.id}-${lineIndex}-${segmentIndex}`} fg={segment.color ?? textColor}>
                {segment.text}
              </span>
            ))}
          </text>
        ))}
      </box>
    );
  }

  function renderAllDetail() {
    return (
      <scrollbox focused={focusedPane === "details"} flexGrow={1} scrollY>
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

  function renderPriorityDetail(priority: Priority) {
    const isPrioritySelected = selectedPrioritySet.has(priority);
    const priorityFindings = findings.filter((finding) => finding.priority === priority);

    return (
      <scrollbox focused={focusedPane === "details"} flexGrow={1} scrollY>
        <box flexDirection="column" gap={1}>
          <DetailField label="Priority" value={<PriorityText priority={priority} />} />
          <DetailField
            label="Selection"
            value={isPrioritySelected ? "Included in this batch" : "Not selected"}
            color={isPrioritySelected ? TUI_COLORS.status.success : TUI_COLORS.text.muted}
          />
          <DetailField label="Matches" value={formatCountLabel(priorityFindings.length)} />
          <text fg={TUI_COLORS.text.dim}>
            <strong>Matching Issues</strong>
          </text>
          {priorityFindings.length === 0 ? (
            <text fg={TUI_COLORS.text.dim}>No issues in this priority.</text>
          ) : (
            priorityFindings.map((finding) => (
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

  function renderFindingDetail(finding: StoredFinding) {
    const isSelected = selectedFindingIdSet.has(finding.id);

    return (
      <scrollbox focused={focusedPane === "details"} flexGrow={1} scrollY>
        <box flexDirection="column" gap={1}>
          <DetailField
            label="Issue"
            value={
              <>
                <span>{finding.id} </span>
                <PriorityText priority={finding.priority} bracketed />
              </>
            }
          />
          <DetailField label="Title" value={formatFindingTitleForDisplay(finding.title)} />
          <DetailField label="Confidence" value={formatConfidenceScore(finding.confidenceScore)} />
          <text fg={TUI_COLORS.text.dim}>
            <strong>Body</strong>
          </text>
          {finding.body.split("\n").map((line, index) => (
            <text key={`${finding.id}-body-${index}`} fg={TUI_COLORS.text.secondary}>
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
            value={`${finding.filePath}:${finding.startLine}-${finding.endLine}`}
          />
        </box>
      </scrollbox>
    );
  }

  function renderFilterDetail() {
    return (
      <scrollbox focused={focusedPane === "details"} flexGrow={1} scrollY>
        <box flexDirection="column" gap={1}>
          <DetailField label="Scope" value="Filter the issue list" />
          <text fg={TUI_COLORS.text.secondary}>
            Narrow the "By issue" section by ID, title, path, or priority.
          </text>
          <text fg={TUI_COLORS.text.muted}>
            {filterQuery.trim().length === 0
              ? `Showing ${filteredFindings.length} of ${findings.length} issues`
              : `Showing ${filteredFindings.length} of ${findings.length} issues · "${filterQuery.trim()}"`}
          </text>
          <text fg={TUI_COLORS.text.dim}>
            Press <span fg={TUI_COLORS.accent.key}>/</span> to jump back to the filter input.
          </text>
        </box>
      </scrollbox>
    );
  }

  function renderDetailsPanel() {
    if (isFilterFocused) {
      return renderFilterDetail();
    }

    if (!currentRow) {
      return renderAllDetail();
    }

    switch (currentRow.kind) {
      case "all":
        return renderAllDetail();
      case "priority":
        return renderPriorityDetail(currentRow.priority);
      case "issue":
        return renderFindingDetail(currentRow.finding);
      default:
        return renderAllDetail();
    }
  }

  const footerKeys: Array<[string, string]> = [
    ["Tab", "Focus pane"],
    ["↑/↓ j/k", "Move"],
    ["Space", "Toggle"],
    ["/", "Filter"],
    ["Enter", "Run"],
    ["Esc", isFilterFocused ? "Back" : "Close"],
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
                <PriorityText priority={item.priority} bracketed />
                <span fg={TUI_COLORS.text.muted}> {item.count}</span>
              </text>
            </box>
          ))}
        </box>
      </box>

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
          <box flexDirection="column" flexShrink={0}>
            <text fg={TUI_COLORS.text.dim}>
              <strong>Issue filter</strong>
            </text>
            <box flexDirection="row" paddingLeft={1}>
              <box flexShrink={0}>
                <text
                  fg={isFilterFocused ? TUI_COLORS.text.primary : TUI_COLORS.text.muted}
                  wrapMode="none"
                >
                  <span>{isFilterFocused ? "▶ " : "  "}</span>
                </text>
              </box>
              <input
                value={filterQuery}
                onChange={updateFilterQuery}
                onInput={updateFilterQuery}
                onSubmit={() => {
                  setFocusArea("list");
                }}
                onKeyDown={(key) => {
                  if (key.name === "tab") {
                    key.preventDefault();
                    key.stopPropagation();
                    cycleFocusedPane();
                    return;
                  }

                  if (key.name === "escape") {
                    key.preventDefault();
                    key.stopPropagation();
                    setFocusArea("list");
                    return;
                  }

                  if (key.name === "up" || key.name === "down") {
                    key.preventDefault();
                    key.stopPropagation();
                    return;
                  }

                  if (key.name === "j" || key.name === "k" || key.name === "space") {
                    key.stopPropagation();
                  }
                }}
                placeholder="Type / to search"
                focused={isFilterFocused}
                flexGrow={1}
                backgroundColor="#111827"
                focusedBackgroundColor="#0f172a"
                textColor={TUI_COLORS.text.primary}
                placeholderColor={TUI_COLORS.text.dim}
              />
            </box>
          </box>

          <box height={1} flexShrink={0}>
            <text> </text>
          </box>

          <scrollbox
            ref={selectionListRef}
            focused={focusedPane === "selection" && focusArea === "list"}
            flexGrow={1}
            scrollY
          >
            <box flexDirection="column">{rows.map((row, index) => renderRow(row, index))}</box>
          </scrollbox>
        </box>

        <box
          border
          borderStyle="rounded"
          borderColor={detailsBorderColor}
          title="Details"
          titleAlignment="left"
          flexGrow={1}
          minHeight={0}
          flexDirection="column"
          padding={1}
        >
          {renderDetailsPanel()}
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
        justifyContent="space-between"
        backgroundColor="#0f172a"
        paddingLeft={1}
        paddingRight={1}
        height={1}
        flexShrink={0}
      >
        <box flexDirection="row" gap={2}>
          {footerKeys.map(([key, label]) => (
            <text key={key}>
              <span fg={TUI_COLORS.accent.key}>[{key}]</span>
              <span fg={TUI_COLORS.text.muted}> {label}</span>
            </text>
          ))}
        </box>
        <text fg={TUI_COLORS.text.dim}>
          Focus: {focusedPane === "selection" ? "Selection" : "Details"}
        </text>
      </box>
    </box>
  );
}
