import type { ScrollBoxRenderable } from "@opentui/core";
import { type ReactNode, useRef } from "react";
import { formatDuration } from "@/lib/format";
import { getProjectNameFromLogPath } from "@/lib/logger";
import { TUI_COLORS } from "@/lib/tui/colors";
import {
  formatHandoffSummary,
  formatLastRunIssueSummary,
  formatPriorityBreakdown,
  formatProjectNameForDisplay,
  PRIORITY_COLORS,
} from "@/lib/tui/session-display-formatters";
import type {
  Finding,
  FixEntry,
  IterationEntry,
  SessionEndEntry,
  SessionStats,
  SkippedEntry,
  SystemEntry,
} from "@/lib/types";
import { FindingsList, SectionHeader, SkippedList, toSingleLine } from "./session-detail-parts";
import { buildScrollBarRows, useScrollMetrics } from "./session-detail-scroll";

const META_LABEL_WIDTH = 16;
const LOCATION_MAX_LENGTH = 92;

function statusColor(status: string): string {
  switch (status) {
    case "completed":
      return TUI_COLORS.status.success;
    case "running":
      return TUI_COLORS.status.pending;
    case "failed":
      return TUI_COLORS.status.error;
    case "interrupted":
      return TUI_COLORS.status.warning;
    default:
      return TUI_COLORS.status.inactive;
  }
}

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength || maxLength < 9) {
    return value;
  }

  const visible = maxLength - 3;
  const leftLength = Math.ceil(visible / 2);
  const rightLength = Math.floor(visible / 2);
  return `${value.slice(0, leftLength)}...${value.slice(-rightLength)}`;
}

function formatSessionTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function IterationHeading({ iteration, duration }: { iteration: number; duration?: number }) {
  return (
    <box flexDirection="row" justifyContent="space-between" gap={1}>
      <text fg={TUI_COLORS.text.faint}>
        <strong>Iteration {iteration}</strong>
      </text>
      {duration !== undefined && <text fg={TUI_COLORS.text.dim}>{formatDuration(duration)}</text>}
    </box>
  );
}

function formatLocationLine(fix: FixEntry): string | null {
  const baseFile = fix.file?.trim() || fix.code_location?.absolute_file_path?.trim() || "";
  if (!baseFile) {
    return null;
  }

  if (!fix.code_location) {
    return truncateMiddle(baseFile, LOCATION_MAX_LENGTH);
  }

  const range = fix.code_location.line_range;
  return truncateMiddle(`${baseFile}:${range.start}-${range.end}`, LOCATION_MAX_LENGTH);
}

function MetadataRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <box flexDirection="row" gap={1} alignItems="flex-start">
      <box width={META_LABEL_WIDTH} flexShrink={0}>
        <text fg={TUI_COLORS.text.muted}>{label}</text>
      </box>
      <box flexDirection="row" flexShrink={1} flexWrap="wrap">
        {children}
      </box>
    </box>
  );
}

function HeaderSectionTitle({ title }: { title: string }) {
  return (
    <text fg={TUI_COLORS.text.faint}>
      <strong>{title}</strong>
    </text>
  );
}

function PrioritySummaryRow({
  priorityCounts,
}: {
  priorityCounts: SessionStats["priorityCounts"];
}) {
  return (
    <box flexDirection="row" flexWrap="wrap" gap={1}>
      {formatPriorityBreakdown(priorityCounts).map((item) => (
        <text key={item.priority}>
          <span fg={TUI_COLORS.text.dim}>[</span>
          <span fg={PRIORITY_COLORS[item.priority]}>{item.priority}</span>
          <span fg={TUI_COLORS.text.muted}> {item.count}</span>
          <span fg={TUI_COLORS.text.dim}>]</span>
        </text>
      ))}
    </box>
  );
}

function LabeledFixDetail({ label, value }: { label: string; value: string }) {
  const text = value.trim().length > 0 ? toSingleLine(value) : "None provided";
  const textColor = value.trim().length > 0 ? TUI_COLORS.text.secondary : TUI_COLORS.text.dim;

  return (
    <box flexDirection="column" gap={0} paddingLeft={5}>
      <text fg={TUI_COLORS.text.muted}>{label}:</text>
      <text fg={textColor} paddingLeft={2}>
        {text}
      </text>
    </box>
  );
}

function DetailedFixList({ fixes }: { fixes: FixEntry[] }) {
  if (fixes.length === 0) {
    return (
      <text fg={TUI_COLORS.text.dim} paddingLeft={2}>
        None yet
      </text>
    );
  }

  return (
    <box flexDirection="column" paddingLeft={2} gap={1}>
      {fixes.map((fix, index) => {
        const locationLine = formatLocationLine(fix);
        return (
          <box key={`${index}-${fix.id}`} flexDirection="column" paddingLeft={1} gap={0}>
            <box flexDirection="row" gap={1}>
              <text fg={PRIORITY_COLORS[fix.priority]}>{fix.priority}</text>
              <text fg={TUI_COLORS.text.dim}>▸</text>
              <text fg={TUI_COLORS.text.secondary}>
                <strong>{toSingleLine(fix.title)}</strong>
              </text>
            </box>
            {locationLine && (
              <text fg={TUI_COLORS.text.dim} paddingLeft={5}>
                {toSingleLine(locationLine)}
              </text>
            )}
            <LabeledFixDetail label="Claim" value={fix.claim} />
            <LabeledFixDetail label="Evidence" value={fix.evidence} />
            <LabeledFixDetail label="Fix" value={fix.fix} />
          </box>
        );
      })}
    </box>
  );
}

function IterationSection({ entry }: { entry: IterationEntry }) {
  const findings: Finding[] = entry.review?.findings ?? [];
  const displayFindings: Finding[] = findings.map((finding) => ({
    ...finding,
    code_location: {
      ...finding.code_location,
      absolute_file_path: truncateMiddle(
        finding.code_location.absolute_file_path,
        LOCATION_MAX_LENGTH
      ),
    },
  }));
  const fixes: FixEntry[] = entry.fixes?.fixes ?? [];
  const skipped: SkippedEntry[] = entry.fixes?.skipped ?? [];
  const hasContent = findings.length > 0 || fixes.length > 0 || skipped.length > 0;

  return (
    <box
      flexDirection="column"
      gap={1}
      border
      borderStyle="single"
      borderColor={TUI_COLORS.ui.border}
      paddingLeft={1}
      paddingRight={1}
      paddingBottom={1}
    >
      <IterationHeading iteration={entry.iteration} duration={entry.duration} />

      {entry.fixes && (
        <box flexDirection="column" gap={0} paddingLeft={2}>
          <box flexDirection="row" gap={1}>
            <text fg={TUI_COLORS.text.muted}>Decision:</text>
            <text fg={TUI_COLORS.text.secondary}>{entry.fixes.decision}</text>
          </box>
          {entry.fixes.stop_iteration !== undefined && (
            <box flexDirection="row" gap={1}>
              <text fg={TUI_COLORS.text.muted}>Stop iteration:</text>
              <text fg={TUI_COLORS.text.secondary}>{String(entry.fixes.stop_iteration)}</text>
            </box>
          )}
        </box>
      )}

      {!hasContent && !entry.error && (
        <text fg={TUI_COLORS.text.dim} paddingLeft={2}>
          No issues found
        </text>
      )}

      {findings.length > 0 && (
        <box flexDirection="column">
          <SectionHeader title="Issues Found" count={findings.length} />
          <FindingsList findings={displayFindings} scrollable={false} />
        </box>
      )}

      {fixes.length > 0 && (
        <box flexDirection="column">
          <SectionHeader title="Fixes Applied" count={fixes.length} />
          <DetailedFixList fixes={fixes} />
        </box>
      )}

      {skipped.length > 0 && (
        <box flexDirection="column">
          <SectionHeader title="Skipped" count={skipped.length} />
          <SkippedList skipped={skipped} scrollable={false} />
        </box>
      )}

      {entry.error && (
        <box flexDirection="row" gap={1} paddingLeft={2}>
          <text fg={TUI_COLORS.status.error}>Error:</text>
          <text fg={TUI_COLORS.text.secondary}>{entry.error.message}</text>
        </box>
      )}
    </box>
  );
}

function SessionEndSection({ entry }: { entry: SessionEndEntry }) {
  return (
    <box
      flexDirection="column"
      gap={1}
      border
      borderStyle="single"
      borderColor={TUI_COLORS.ui.border}
      paddingLeft={1}
      paddingRight={1}
      paddingBottom={1}
    >
      <text fg={TUI_COLORS.text.faint}>
        <strong>Result</strong>
      </text>
      <text fg={statusColor(entry.status)} paddingLeft={2}>
        <strong>{entry.status}</strong>
      </text>
      <text fg={TUI_COLORS.text.secondary} paddingLeft={2}>
        {entry.reason}
      </text>
    </box>
  );
}

export function SessionDetailPane({
  stats,
  focused,
  height,
}: {
  stats: SessionStats;
  focused?: boolean;
  height?: number;
}) {
  const scrollboxRef = useRef<ScrollBoxRenderable | null>(null);
  const scrollMetrics = useScrollMetrics(scrollboxRef, focused);

  const issueSummary = formatLastRunIssueSummary(
    stats.totalFixes,
    stats.totalSkipped,
    stats.iterations
  );

  const handoffSummary = formatHandoffSummary(stats.handoffStatus, stats.commitSha);
  const outcomeSummary = [stats.reviewOutcome, handoffSummary].filter(Boolean).join(" · ");
  const projectName = formatProjectNameForDisplay(getProjectNameFromLogPath(stats.sessionPath));
  const sessionTimestamp = formatSessionTimestamp(stats.timestamp);

  const systemEntry = stats.entries.find((e) => e.type === "system") as SystemEntry | undefined;
  const iterationEntries = stats.entries.filter((e) => e.type === "iteration") as IterationEntry[];
  const sessionEndEntry = stats.entries.find((e) => e.type === "session_end") as
    | SessionEndEntry
    | undefined;

  const reasoningLabel = (level: string | undefined) => (level ? `[${level}]` : "");
  const scrollbarRows = buildScrollBarRows(scrollMetrics);

  return (
    <box flexDirection="row" flexGrow={1} minHeight={0} height={height}>
      <scrollbox
        ref={scrollboxRef}
        focused={focused}
        flexDirection="column"
        flexGrow={1}
        height="100%"
        verticalScrollbarOptions={{ visible: false }}
        horizontalScrollbarOptions={{ visible: false }}
      >
        <box flexDirection="column" gap={1}>
          <box flexDirection="column" gap={1}>
            <HeaderSectionTitle title="Overview" />
            <MetadataRow label="Project:">
              <text fg={TUI_COLORS.text.primary}>
                <strong>{projectName}</strong>
              </text>
            </MetadataRow>
            <MetadataRow label="Timestamp:">
              <text fg={TUI_COLORS.text.secondary}>{sessionTimestamp}</text>
            </MetadataRow>
            <MetadataRow label="Status:">
              <box flexDirection="row" gap={1}>
                <text fg={statusColor(stats.status)}>
                  <strong>{stats.status}</strong>
                </text>
                {stats.totalDuration !== undefined && (
                  <text fg={TUI_COLORS.text.dim}>· {formatDuration(stats.totalDuration)}</text>
                )}
              </box>
            </MetadataRow>
            <MetadataRow label="Result:">
              <text fg={TUI_COLORS.text.secondary}>{issueSummary}</text>
            </MetadataRow>
            <MetadataRow label="Priorities:">
              <PrioritySummaryRow priorityCounts={stats.priorityCounts} />
            </MetadataRow>
            {outcomeSummary && (
              <MetadataRow label="Outcome:">
                <text fg={TUI_COLORS.text.secondary}>{outcomeSummary}</text>
              </MetadataRow>
            )}
            {stats.commitSha && (
              <MetadataRow label="Commit:">
                <text fg={TUI_COLORS.text.secondary}>{stats.commitSha}</text>
              </MetadataRow>
            )}
          </box>

          <box flexDirection="column" gap={1}>
            <HeaderSectionTitle title="Run setup" />
            {stats.gitBranch && (
              <MetadataRow label="Branch:">
                <text fg={TUI_COLORS.text.secondary}>
                  {stats.gitBranch}
                  {stats.worktreeBranch ? ` (worktree: ${stats.worktreeBranch})` : ""}
                </text>
              </MetadataRow>
            )}
            <MetadataRow label="Reviewer:">
              <text fg={TUI_COLORS.text.secondary}>
                {stats.reviewerDisplayName} ({stats.reviewerModelDisplayName}){" "}
                {reasoningLabel(stats.reviewerReasoning)}
              </text>
            </MetadataRow>
            <MetadataRow label="Fixer:">
              <text fg={TUI_COLORS.text.secondary}>
                {stats.fixerDisplayName} ({stats.fixerModelDisplayName}){" "}
                {reasoningLabel(stats.fixerReasoning)}
              </text>
            </MetadataRow>
            {systemEntry && (
              <MetadataRow label="Max iterations:">
                <text fg={TUI_COLORS.text.secondary}>{systemEntry.maxIterations}</text>
              </MetadataRow>
            )}
          </box>

          {/* Iteration timeline */}
          {iterationEntries.map((entry) => (
            <IterationSection key={entry.iteration} entry={entry} />
          ))}

          {/* Session end */}
          {sessionEndEntry && <SessionEndSection entry={sessionEndEntry} />}
        </box>
      </scrollbox>
      <box flexDirection="column" width={1} flexShrink={0} height="100%" alignItems="center">
        {scrollbarRows.map((row) => (
          <text key={row.key} fg={row.color}>
            {row.char}
          </text>
        ))}
      </box>
    </box>
  );
}
