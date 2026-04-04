import { TUI_COLORS } from "@/lib/tui/colors";
import type { Finding, FixEntry, Priority, SkippedEntry } from "@/lib/types";
import { VALID_PRIORITIES } from "@/lib/types/domain";
import { PRIORITY_COLORS, UNKNOWN_PRIORITY_COLOR } from "../session-panel-utils";

export function toSingleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function priorityToString(priority: number | undefined): Priority | "P?" {
  if (priority === undefined) return "P?";
  const key = `P${priority}` as Priority;
  return VALID_PRIORITIES.includes(key) ? key : "P?";
}

export function SectionHeader({
  title,
  count,
  suffix,
}: {
  title: string;
  count?: number;
  suffix?: React.ReactNode;
}) {
  return (
    <text>
      <span fg={TUI_COLORS.text.muted}>
        <strong>{title}</strong>
      </span>
      {count !== undefined && <span fg={TUI_COLORS.text.dim}> ({count})</span>}
      {suffix}
    </text>
  );
}

export function FindingsList({
  findings,
  maxHeight = 8,
  focused = false,
  scrollable = true,
}: {
  findings: Finding[];
  maxHeight?: number;
  focused?: boolean;
  scrollable?: boolean;
}) {
  if (findings.length === 0) {
    return (
      <text fg={TUI_COLORS.text.dim} paddingLeft={2}>
        None yet
      </text>
    );
  }

  const content = findings.map((finding, index) => {
    const priorityStr = priorityToString(finding.priority);
    const priorityColor =
      finding.priority !== undefined
        ? (PRIORITY_COLORS[`P${finding.priority}` as Priority] ?? UNKNOWN_PRIORITY_COLOR)
        : UNKNOWN_PRIORITY_COLOR;
    const location = finding.code_location;
    const lineRange = `${location.line_range.start}-${location.line_range.end}`;
    const key = `${index}-${location.absolute_file_path}:${lineRange}`;

    return (
      <box key={key} flexDirection="column">
        <box flexDirection="row">
          <text fg={priorityColor}>{priorityStr}</text>
          <text fg={TUI_COLORS.text.dim}> ▸ </text>
          <text fg={TUI_COLORS.text.secondary} wrapMode="none">
            {toSingleLine(finding.title)}
          </text>
        </box>
        <text fg={TUI_COLORS.text.dim} paddingLeft={5} wrapMode="none">
          {toSingleLine(location.absolute_file_path)}:{lineRange}
        </text>
      </box>
    );
  });

  if (!scrollable) {
    return <box paddingLeft={2}>{content}</box>;
  }

  return (
    <scrollbox paddingLeft={2} height={maxHeight} focused={focused}>
      {content}
    </scrollbox>
  );
}

export function FixList({
  fixes,
  showFiles,
  maxHeight = 8,
  focused = false,
  scrollable = true,
}: {
  fixes: FixEntry[];
  showFiles: boolean;
  maxHeight?: number;
  focused?: boolean;
  scrollable?: boolean;
}) {
  if (fixes.length === 0) {
    return (
      <text fg={TUI_COLORS.text.dim} paddingLeft={2}>
        None yet
      </text>
    );
  }

  const content = fixes.map((fix, index) => (
    <box key={`${index}-${fix.id}`} flexDirection="column">
      <box flexDirection="row">
        <text fg={PRIORITY_COLORS[fix.priority as Priority] ?? UNKNOWN_PRIORITY_COLOR}>
          {fix.priority}
        </text>
        <text fg={TUI_COLORS.text.dim}> ▸ </text>
        <text fg={TUI_COLORS.text.secondary} wrapMode="none">
          {toSingleLine(fix.title)}
        </text>
      </box>
      {showFiles && fix.file && (
        <text fg={TUI_COLORS.text.dim} paddingLeft={5} wrapMode="none">
          {toSingleLine(fix.file)}
        </text>
      )}
    </box>
  ));

  if (!scrollable) {
    return <box paddingLeft={2}>{content}</box>;
  }

  return (
    <scrollbox paddingLeft={2} height={maxHeight} focused={focused}>
      {content}
    </scrollbox>
  );
}

export function SkippedList({
  skipped,
  maxHeight = 6,
  focused = false,
  scrollable = true,
}: {
  skipped: SkippedEntry[];
  maxHeight?: number;
  focused?: boolean;
  scrollable?: boolean;
}) {
  if (skipped.length === 0) {
    return (
      <text fg={TUI_COLORS.text.dim} paddingLeft={2}>
        None yet
      </text>
    );
  }

  const content = skipped.map((entry, index) => (
    <box key={`${index}-${entry.id}`} flexDirection="column">
      <box flexDirection="row">
        <text fg={PRIORITY_COLORS[entry.priority as Priority] ?? UNKNOWN_PRIORITY_COLOR}>
          {entry.priority ?? "P?"}
        </text>
        <text fg={TUI_COLORS.text.dim}> ▸ </text>
        <text fg={TUI_COLORS.text.secondary} wrapMode="none">
          {toSingleLine(entry.title)}
        </text>
      </box>
      <text fg={TUI_COLORS.text.dim} paddingLeft={5} wrapMode="none">
        {toSingleLine(entry.reason)}
      </text>
    </box>
  ));

  if (!scrollable) {
    return <box paddingLeft={2}>{content}</box>;
  }

  return (
    <scrollbox paddingLeft={2} height={maxHeight} focused={focused}>
      {content}
    </scrollbox>
  );
}
