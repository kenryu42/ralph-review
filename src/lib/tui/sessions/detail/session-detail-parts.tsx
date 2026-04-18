import type { FindingFixResult, StoredFinding } from "@/lib/review-workflow/findings/types";
import { storedFindingToFinding } from "@/lib/review-workflow/presentation";
import { formatFindingTitleForDisplay } from "@/lib/tui/sessions/finding-title";
import { PriorityText } from "@/lib/tui/sessions/priority-text";
import { TUI_COLORS } from "@/lib/tui/shared/colors";
import type { Finding, FixEntry, SkippedEntry } from "@/lib/types";

type BoxHeight = number | "auto" | `${number}%`;

export function toSingleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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
  height = 8,
  focused = false,
  scrollable = true,
}: {
  findings: Finding[];
  height?: BoxHeight;
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
    const location = finding.code_location;
    const lineRange = `${location.line_range.start}-${location.line_range.end}`;
    const key = `${index}-${location.absolute_file_path}:${lineRange}`;

    return (
      <box key={key} flexDirection="column">
        <box flexDirection="row">
          <text>
            <PriorityText priority={finding.priority} />
          </text>
          <text fg={TUI_COLORS.text.dim}> ▸ </text>
          <text fg={TUI_COLORS.text.secondary} wrapMode="none">
            {toSingleLine(formatFindingTitleForDisplay(finding.title))}
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
    <scrollbox paddingLeft={2} height={height} focused={focused}>
      {content}
    </scrollbox>
  );
}

export function StoredFindingsList({
  findings,
  height = 8,
  focused = false,
  scrollable = true,
}: {
  findings: StoredFinding[];
  height?: BoxHeight;
  focused?: boolean;
  scrollable?: boolean;
}) {
  return (
    <FindingsList
      findings={findings.map(storedFindingToFinding)}
      height={height}
      focused={focused}
      scrollable={scrollable}
    />
  );
}

export function FixList({
  fixes,
  showFiles,
  height = 8,
  focused = false,
  scrollable = true,
}: {
  fixes: FixEntry[];
  showFiles: boolean;
  height?: BoxHeight;
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
        <text>
          <PriorityText priority={fix.priority} />
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
    <scrollbox paddingLeft={2} height={height} focused={focused}>
      {content}
    </scrollbox>
  );
}

export function SkippedList({
  skipped,
  height = 6,
  focused = false,
  scrollable = true,
}: {
  skipped: SkippedEntry[];
  height?: BoxHeight;
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
        <text>
          <PriorityText priority={entry.priority} />
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
    <scrollbox paddingLeft={2} height={height} focused={focused}>
      {content}
    </scrollbox>
  );
}

function getFixResultColor(status: FindingFixResult["status"]): string {
  switch (status) {
    case "resolved":
      return TUI_COLORS.status.success;
    case "unresolved":
      return TUI_COLORS.status.error;
    default:
      return TUI_COLORS.text.dim;
  }
}

export function FindingFixResultList({
  results,
  findingsById,
  height = 6,
  focused = false,
  scrollable = true,
}: {
  results: FindingFixResult[];
  findingsById: Map<string, StoredFinding>;
  height?: BoxHeight;
  focused?: boolean;
  scrollable?: boolean;
}) {
  if (results.length === 0) {
    return (
      <text fg={TUI_COLORS.text.dim} paddingLeft={2}>
        None yet
      </text>
    );
  }

  const content = results.map((result) => {
    const finding = findingsById.get(result.findingId);
    const location = finding ? `${finding.filePath}:${finding.startLine}-${finding.endLine}` : null;

    return (
      <box key={`${result.findingId}-${result.status}`} flexDirection="column">
        <box flexDirection="row">
          <text fg={getFixResultColor(result.status)}>{result.status.toUpperCase()}</text>
          <text fg={TUI_COLORS.text.dim}> ▸ </text>
          <text fg={TUI_COLORS.text.secondary} wrapMode="none">
            {toSingleLine(finding ? formatFindingTitleForDisplay(finding.title) : result.findingId)}
          </text>
        </box>
        {location && (
          <text fg={TUI_COLORS.text.dim} paddingLeft={5} wrapMode="none">
            {toSingleLine(location)}
          </text>
        )}
        <text fg={TUI_COLORS.text.dim} paddingLeft={5}>
          {toSingleLine(result.summary)}
        </text>
      </box>
    );
  });

  if (!scrollable) {
    return <box paddingLeft={2}>{content}</box>;
  }

  return (
    <scrollbox paddingLeft={2} height={height} focused={focused}>
      {content}
    </scrollbox>
  );
}
