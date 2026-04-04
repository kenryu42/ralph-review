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
import { FindingsList, FixList, SectionHeader, SkippedList } from "./session-detail-parts";

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

function IterationSection({ entry }: { entry: IterationEntry }) {
  const findings: Finding[] = entry.review?.findings ?? [];
  const fixes: FixEntry[] = entry.fixes?.fixes ?? [];
  const skipped: SkippedEntry[] = entry.fixes?.skipped ?? [];
  const hasContent = findings.length > 0 || fixes.length > 0 || skipped.length > 0;

  return (
    <box flexDirection="column" gap={1}>
      <IterationDivider iteration={entry.iteration} duration={entry.duration} />

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
          <FixList fixes={fixes} showFiles={true} scrollable={false} />
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

export function SessionDetailPane({ stats }: { stats: SessionStats }) {
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

  return (
    <scrollbox flexDirection="column" gap={1}>
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
    </scrollbox>
  );
}
