import { useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useRef } from "react";
import { formatReviewType } from "@/lib/format";
import type { SessionState } from "@/lib/session-state";
import { TUI_COLORS } from "@/lib/tui/colors";
import type {
  AgentRole,
  Finding,
  FixEntry,
  Priority,
  ReviewOptions,
  ReviewSummary,
  SkippedEntry,
} from "@/lib/types";
import { parseCodexReviewText } from "@/lib/types";
import { VALID_PRIORITIES } from "@/lib/types/domain";
import {
  extractLatestReviewSummary,
  findLatestReviewerPhaseStart,
  formatSessionIdentityDisplay,
  PRIORITY_COLORS,
  resolveIssuesFoundDisplay,
  UNKNOWN_PRIORITY_COLOR,
} from "../session-panel-utils";
import { ProgressBar } from "./ProgressBar";
import { Spinner } from "./Spinner";

interface SessionDetailViewProps {
  session: SessionState;
  fixes: FixEntry[];
  skipped: SkippedEntry[];
  findings: Finding[];
  latestReviewIteration: number | null;
  codexReviewText: string | null;
  tmuxOutput: string;
  maxIterations: number;
  currentAgent: AgentRole | null;
  reviewOptions: ReviewOptions | undefined;
  isStopping: boolean;
  activeSessionCount: number;
  focused?: boolean;
}

function getStatusDisplay(
  status: string,
  currentAgent: AgentRole | null,
  isPreparing = false
): { text: string; color: string } {
  switch (status) {
    case "completed":
      return { text: "completed", color: TUI_COLORS.status.success };
    case "failed":
      return { text: "failed", color: TUI_COLORS.status.error };
    case "interrupted":
      return { text: "interrupted", color: TUI_COLORS.status.warning };
    case "running":
      if (currentAgent) {
        if (currentAgent === "code-simplifier") {
          return { text: "running code simplifier agent", color: TUI_COLORS.status.success };
        }
        return { text: `running ${currentAgent} agent`, color: TUI_COLORS.status.success };
      }
      if (isPreparing) {
        return { text: "preparing session worktree", color: TUI_COLORS.status.pending };
      }
      return { text: "running", color: TUI_COLORS.status.success };
    case "pending":
      return { text: "starting review", color: TUI_COLORS.status.pending };
    default:
      return { text: "unknown", color: TUI_COLORS.status.inactive };
  }
}

function toSingleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function priorityToString(priority: number | undefined): Priority | "P?" {
  if (priority === undefined) return "P?";
  const key = `P${priority}` as Priority;
  return VALID_PRIORITIES.includes(key) ? key : "P?";
}

function SectionHeader({
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

function FindingsList({
  findings,
  maxHeight = 8,
  focused = false,
}: {
  findings: Finding[];
  maxHeight?: number;
  focused?: boolean;
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

  return (
    <scrollbox paddingLeft={2} height={maxHeight} focused={focused}>
      {content}
    </scrollbox>
  );
}

function FixList({
  fixes,
  showFiles,
  maxHeight = 8,
  focused = false,
}: {
  fixes: FixEntry[];
  showFiles: boolean;
  maxHeight?: number;
  focused?: boolean;
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

  return (
    <scrollbox paddingLeft={2} height={maxHeight} focused={focused}>
      {content}
    </scrollbox>
  );
}

function SkippedList({
  skipped,
  maxHeight = 6,
  focused = false,
}: {
  skipped: SkippedEntry[];
  maxHeight?: number;
  focused?: boolean;
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

  return (
    <scrollbox paddingLeft={2} height={maxHeight} focused={focused}>
      {content}
    </scrollbox>
  );
}

function countCodexReviewLines(text: string): number {
  return text.split("\n").filter((line) => line.trim() !== "").length;
}

function CodexReviewDisplay({
  text,
  maxHeight = 6,
  focused = false,
}: {
  text: string;
  maxHeight?: number;
  focused?: boolean;
}) {
  const lines = text.split("\n").filter((line) => line.trim() !== "");

  if (lines.length === 0) {
    return (
      <text fg={TUI_COLORS.text.dim} paddingLeft={2}>
        No review text
      </text>
    );
  }

  const content = lines.map((line, index) => (
    <text key={`${index}-${line.slice(0, 20)}`} fg={TUI_COLORS.text.secondary} wrapMode="none">
      {line}
    </text>
  ));

  return (
    <scrollbox paddingLeft={2} height={maxHeight} focused={focused}>
      {content}
    </scrollbox>
  );
}

export function SessionDetailView({
  session,
  fixes,
  skipped,
  findings,
  latestReviewIteration,
  codexReviewText,
  tmuxOutput,
  maxIterations,
  currentAgent,
  reviewOptions,
  isStopping,
  activeSessionCount,
  focused = false,
}: SessionDetailViewProps) {
  const { height: terminalHeight } = useTerminalDimensions();
  const sessionIteration = session.iteration ?? 0;

  const parsedCodexSummary = useMemo(() => {
    if (!codexReviewText) return null;
    return parseCodexReviewText(codexReviewText);
  }, [codexReviewText]);

  const reviewerPhaseStart = useMemo(() => findLatestReviewerPhaseStart(tmuxOutput), [tmuxOutput]);

  const liveReviewSummary = useMemo(() => {
    if (!tmuxOutput.trim()) return null;
    const minIndex = reviewerPhaseStart >= 0 ? reviewerPhaseStart : 0;
    return extractLatestReviewSummary(tmuxOutput, minIndex);
  }, [tmuxOutput, reviewerPhaseStart]);

  const lastLiveReviewSummaryRef = useRef<{ iteration: number; summary: ReviewSummary } | null>(
    null
  );

  useEffect(() => {
    if (liveReviewSummary) {
      lastLiveReviewSummaryRef.current = {
        iteration: sessionIteration,
        summary: liveReviewSummary,
      };
      return;
    }
    if (
      lastLiveReviewSummaryRef.current &&
      lastLiveReviewSummaryRef.current.iteration !== sessionIteration
    ) {
      lastLiveReviewSummaryRef.current = null;
    }
  }, [sessionIteration, liveReviewSummary]);

  const iteration = sessionIteration;
  const statusDisplay = getStatusDisplay(
    session.state ?? "unknown",
    currentAgent,
    session.state === "running" && currentAgent === null && session.iteration === undefined
  );

  const cachedLiveReviewSummary =
    lastLiveReviewSummaryRef.current?.iteration === iteration
      ? lastLiveReviewSummaryRef.current.summary
      : null;

  const { findings: displayFindings, codexText: displayCodexText } = resolveIssuesFoundDisplay({
    sessionStatus: session.state,
    sessionIteration: iteration,
    latestReviewIteration,
    persistedFindings: findings,
    persistedCodexText: codexReviewText,
    parsedCodexSummary,
    liveReviewSummary,
    cachedLiveReviewSummary,
    sessionStateReviewSummary: session.reviewSummary ?? null,
  });

  const showingCodex = displayCodexText !== null && displayFindings.length === 0;
  const verifyCount =
    showingCodex && displayCodexText
      ? countCodexReviewLines(displayCodexText)
      : displayFindings.length;
  const appliedCount = fixes.length;
  const skippedCount = skipped.length;

  const sessionIdentity = formatSessionIdentityDisplay(session, activeSessionCount);

  const listHeightBudget = Math.max(8, terminalHeight - 25);
  const verifyMaxHeight = Math.max(3, Math.floor(listHeightBudget * 0.5));
  const appliedMaxHeight = Math.max(2, Math.floor(listHeightBudget * 0.3));
  const skippedMaxHeight = Math.max(2, listHeightBudget - verifyMaxHeight - appliedMaxHeight);

  return (
    <box flexDirection="column" gap={1} flexGrow={1}>
      <box flexDirection="row" gap={1}>
        <text fg={TUI_COLORS.text.muted}>Status:</text>
        {isStopping ? (
          <>
            <Spinner color={TUI_COLORS.status.warning} />
            <text fg={TUI_COLORS.status.warning}>
              <strong>Stopping review...</strong>
            </text>
          </>
        ) : (
          <>
            {(session.state === "running" || session.state === "pending") && (
              <Spinner color={statusDisplay.color} />
            )}
            <text fg={statusDisplay.color}>
              <strong>{statusDisplay.text}</strong>
            </text>
          </>
        )}
      </box>

      <box flexDirection="row" gap={1}>
        <text fg={TUI_COLORS.text.muted}>Review Type:</text>
        <text fg={TUI_COLORS.text.primary} wrapMode="none">
          {toSingleLine(formatReviewType(reviewOptions))}
        </text>
      </box>

      <box flexDirection="column">
        <box flexDirection="row" gap={1}>
          <text fg={TUI_COLORS.text.muted}>Session:</text>
          <text fg={TUI_COLORS.text.primary} wrapMode="none">
            {sessionIdentity.primary}
          </text>
        </box>
        {sessionIdentity.details.map((detail) => (
          <text key={detail} fg={TUI_COLORS.text.dim} paddingLeft={2} wrapMode="none">
            {detail}
          </text>
        ))}
      </box>

      <ProgressBar current={iteration} max={maxIterations} />

      <box flexDirection="column">
        <SectionHeader
          title="Issues found"
          count={verifyCount}
          suffix={showingCodex ? <span fg={TUI_COLORS.text.dim}> · codex</span> : undefined}
        />
        {showingCodex ? (
          <CodexReviewDisplay
            text={displayCodexText ?? ""}
            maxHeight={verifyMaxHeight}
            focused={focused}
          />
        ) : (
          <FindingsList findings={displayFindings} maxHeight={verifyMaxHeight} focused={focused} />
        )}
      </box>

      <box flexDirection="column">
        <SectionHeader title="Fix applied" count={appliedCount} />
        <FixList fixes={fixes} showFiles={true} maxHeight={appliedMaxHeight} focused={false} />
      </box>

      <box flexDirection="column">
        <SectionHeader title="Skipped" count={skippedCount} />
        <SkippedList skipped={skipped} maxHeight={skippedMaxHeight} focused={false} />
      </box>
    </box>
  );
}
