import type { ScrollBoxRenderable } from "@opentui/core";
import { useEffect, useRef, useState } from "react";
import { formatDuration } from "@/lib/format";
import { getProjectNameFromLogPath } from "@/lib/logger";
import { TUI_COLORS } from "@/lib/tui/colors";
import type {
  Finding,
  FixEntry,
  IterationEntry,
  SessionEndEntry,
  SessionStats,
  SkippedEntry,
  SystemEntry,
} from "@/lib/types";
import {
  formatHandoffSummary,
  formatLastRunIssueSummary,
  formatPriorityBreakdown,
  formatProjectNameForDisplay,
  PRIORITY_COLORS,
} from "../session-panel-utils";
import { FindingsList, SectionHeader, SkippedList, toSingleLine } from "./session-detail-parts";

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

function IterationDivider({ iteration, duration }: { iteration: number; duration?: number }) {
  const durationStr = duration !== undefined ? ` (${formatDuration(duration)})` : "";
  return (
    <text fg={TUI_COLORS.text.muted}>
      {"── "}Iteration {iteration}
      {durationStr}
      {" ──"}
    </text>
  );
}

function formatLocationLine(fix: FixEntry): string | null {
  const baseFile = fix.file?.trim() || fix.code_location?.absolute_file_path?.trim() || "";
  if (!baseFile) {
    return null;
  }

  if (!fix.code_location) {
    return baseFile;
  }

  const range = fix.code_location.line_range;
  return `${baseFile}:${range.start}-${range.end}`;
}

function LabeledFixDetail({ label, value }: { label: string; value: string }) {
  const text = value.trim().length > 0 ? toSingleLine(value) : "None provided";
  const textColor = value.trim().length > 0 ? TUI_COLORS.text.secondary : TUI_COLORS.text.dim;

  return (
    <box flexDirection="row" gap={1} paddingLeft={5}>
      <text fg={TUI_COLORS.text.muted}>{label}:</text>
      <text fg={textColor}>{text}</text>
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
    <box flexDirection="column" paddingLeft={2}>
      {fixes.map((fix, index) => {
        const locationLine = formatLocationLine(fix);
        return (
          <box key={`${index}-${fix.id}`} flexDirection="column">
            <box flexDirection="row">
              <text fg={PRIORITY_COLORS[fix.priority]}>{fix.priority}</text>
              <text fg={TUI_COLORS.text.dim}> ▸ </text>
              <text fg={TUI_COLORS.text.secondary}>{toSingleLine(fix.title)}</text>
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
  const fixes: FixEntry[] = entry.fixes?.fixes ?? [];
  const skipped: SkippedEntry[] = entry.fixes?.skipped ?? [];
  const hasContent = findings.length > 0 || fixes.length > 0 || skipped.length > 0;

  return (
    <box flexDirection="column" gap={1}>
      <IterationDivider iteration={entry.iteration} duration={entry.duration} />

      {entry.fixes && (
        <box flexDirection="column" paddingLeft={2}>
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

      {!hasContent && !entry.error && !entry.rollback && (
        <text fg={TUI_COLORS.text.dim} paddingLeft={2}>
          No issues found
        </text>
      )}

      {findings.length > 0 && (
        <box flexDirection="column">
          <SectionHeader title="Issues Found" count={findings.length} />
          <FindingsList findings={findings} scrollable={false} />
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

      {entry.rollback && (
        <box flexDirection="row" gap={1} paddingLeft={2}>
          <text fg={TUI_COLORS.status.warning}>Rollback:</text>
          <text fg={TUI_COLORS.text.secondary}>
            {entry.rollback.success
              ? "succeeded"
              : `failed${entry.rollback.reason ? ` — ${entry.rollback.reason}` : ""}`}
          </text>
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
    <box flexDirection="column" gap={1}>
      <text fg={TUI_COLORS.text.muted}>
        {"── "}Result{" ──"}
      </text>
      <text fg={TUI_COLORS.text.secondary} paddingLeft={2}>
        {entry.status} — {entry.reason}
      </text>
    </box>
  );
}

interface ScrollMetrics {
  scrollTop: number;
  viewportHeight: number;
  scrollHeight: number;
}

const DEFAULT_SCROLL_METRICS: ScrollMetrics = {
  scrollTop: 0,
  viewportHeight: 1,
  scrollHeight: 1,
};

export function SessionDetailPane({ stats }: { stats: SessionStats }) {
  const scrollboxRef = useRef<ScrollBoxRenderable | null>(null);
  const [scrollMetrics, setScrollMetrics] = useState<ScrollMetrics>(DEFAULT_SCROLL_METRICS);

  useEffect(() => {
    const timer = setInterval(() => {
      const scrollbox = scrollboxRef.current;
      if (!scrollbox) {
        return;
      }

      const nextMetrics: ScrollMetrics = {
        scrollTop: scrollbox.scrollTop,
        viewportHeight: Math.max(1, scrollbox.viewport.height),
        scrollHeight: Math.max(1, scrollbox.scrollHeight),
      };

      setScrollMetrics((current) => {
        if (
          current.scrollTop === nextMetrics.scrollTop &&
          current.viewportHeight === nextMetrics.viewportHeight &&
          current.scrollHeight === nextMetrics.scrollHeight
        ) {
          return current;
        }
        return nextMetrics;
      });
    }, 33);

    return () => {
      clearInterval(timer);
    };
  }, []);

  const issueSummary = formatLastRunIssueSummary(
    stats.totalFixes,
    stats.totalSkipped,
    stats.iterations
  );

  const handoffSummary = formatHandoffSummary(stats.handoffStatus, stats.commitSha);
  const projectName = formatProjectNameForDisplay(getProjectNameFromLogPath(stats.sessionPath));

  const systemEntry = stats.entries.find((e) => e.type === "system") as SystemEntry | undefined;
  const iterationEntries = stats.entries.filter((e) => e.type === "iteration") as IterationEntry[];
  const sessionEndEntry = stats.entries.find((e) => e.type === "session_end") as
    | SessionEndEntry
    | undefined;

  const reasoningLabel = (level: string | undefined) => (level ? `[${level}]` : "");
  const viewportHeight = Math.max(1, scrollMetrics.viewportHeight);
  const totalHeight = Math.max(viewportHeight, scrollMetrics.scrollHeight);
  const maxScroll = Math.max(0, totalHeight - viewportHeight);
  const thumbSize =
    maxScroll === 0
      ? viewportHeight
      : Math.max(1, Math.floor((viewportHeight * viewportHeight) / totalHeight));
  const maxThumbStart = Math.max(0, viewportHeight - thumbSize);
  const thumbStart =
    maxScroll === 0 ? 0 : Math.round((scrollMetrics.scrollTop / maxScroll) * maxThumbStart);
  const scrollbarRows = Array.from({ length: viewportHeight }, (_, index) => {
    const inThumb = index >= thumbStart && index < thumbStart + thumbSize;
    return {
      char: inThumb ? "█" : "│",
      color: inThumb ? TUI_COLORS.text.faint : TUI_COLORS.ui.border,
      key: `scrollbar-row-${index}`,
    };
  });

  return (
    <box flexDirection="row" flexGrow={1} minHeight={0}>
      <scrollbox
        ref={scrollboxRef}
        flexDirection="column"
        flexGrow={1}
        height="100%"
        verticalScrollbarOptions={{ visible: false }}
        horizontalScrollbarOptions={{ visible: false }}
      >
        <box flexDirection="column" gap={1}>
          {/* Header section */}
          <box flexDirection="column">
            <box flexDirection="row" gap={1}>
              <text fg={TUI_COLORS.text.muted}>Project:</text>
              <text fg={TUI_COLORS.text.secondary}>{projectName}</text>
            </box>

            <box flexDirection="row" gap={1}>
              <text fg={TUI_COLORS.text.muted}>Status:</text>
              <text fg={statusColor(stats.status)}>{stats.status}</text>
              {stats.totalDuration !== undefined && (
                <text fg={TUI_COLORS.text.dim}>· {formatDuration(stats.totalDuration)}</text>
              )}
            </box>

            {stats.gitBranch && (
              <box flexDirection="row" gap={1}>
                <text fg={TUI_COLORS.text.muted}>Branch:</text>
                <text fg={TUI_COLORS.text.secondary}>
                  {stats.gitBranch}
                  {stats.worktreeBranch ? ` (worktree: ${stats.worktreeBranch})` : ""}
                </text>
              </box>
            )}

            <box flexDirection="row" gap={1}>
              <text fg={TUI_COLORS.text.muted}>Reviewer:</text>
              <text fg={TUI_COLORS.text.secondary}>
                {stats.reviewerDisplayName} ({stats.reviewerModelDisplayName}){" "}
                {reasoningLabel(stats.reviewerReasoning)}
              </text>
            </box>

            <box flexDirection="row" gap={1}>
              <text fg={TUI_COLORS.text.muted}>Fixer:</text>
              <text fg={TUI_COLORS.text.secondary}>
                {stats.fixerDisplayName} ({stats.fixerModelDisplayName}){" "}
                {reasoningLabel(stats.fixerReasoning)}
              </text>
            </box>

            {(stats.reviewOutcome || handoffSummary || stats.commitSha) && (
              <box flexDirection="row" gap={1}>
                <text fg={TUI_COLORS.text.muted}>Outcome:</text>
                <text fg={TUI_COLORS.text.secondary}>
                  {[stats.reviewOutcome, handoffSummary].filter(Boolean).join(" · ")}
                </text>
              </box>
            )}

            <box flexDirection="row" gap={1}>
              <text fg={TUI_COLORS.text.muted}>Result:</text>
              <text fg={TUI_COLORS.text.secondary}>{issueSummary}</text>
            </box>

            <box flexDirection="row" gap={1}>
              {formatPriorityBreakdown(stats.priorityCounts).map((item, idx, arr) => (
                <box key={item.priority} flexDirection="row">
                  <text fg={PRIORITY_COLORS[item.priority]}>{item.priority} </text>
                  <text fg={TUI_COLORS.text.muted}>{item.count}</text>
                  {idx < arr.length - 1 && <text fg={TUI_COLORS.text.dim}> · </text>}
                </box>
              ))}
            </box>

            {systemEntry?.reviewOptions && (
              <box flexDirection="row" gap={1}>
                <text fg={TUI_COLORS.text.muted}>Max iterations:</text>
                <text fg={TUI_COLORS.text.secondary}>{systemEntry.maxIterations}</text>
              </box>
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
