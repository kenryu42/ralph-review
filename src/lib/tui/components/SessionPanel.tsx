import { useTerminalDimensions } from "@opentui/react";
import { useMemo } from "react";
import type { LockData } from "@/lib/lockfile";
import { TUI_COLORS } from "@/lib/tui/colors";
import type {
  AgentRole,
  Finding,
  FixEntry,
  Priority,
  ProjectStats,
  ReviewOptions,
  SessionStats,
  SkippedEntry,
} from "@/lib/types";
import { parseCodexReviewText } from "@/lib/types";
import { VALID_PRIORITIES } from "@/lib/types/domain";
import {
  extractFixesFromStats,
  extractLatestReviewSummary,
  findLatestIterationMarker,
  formatPriorityBreakdown,
  formatProjectStatsSummary,
  formatRelativeTime,
  PRIORITY_COLORS,
  truncateFilePath,
  truncateText,
  UNKNOWN_PRIORITY_COLOR,
} from "../session-panel-utils";
import { ProgressBar } from "./ProgressBar";
import { Spinner } from "./Spinner";

interface SessionPanelProps {
  session: LockData | null;
  fixes: FixEntry[];
  skipped: SkippedEntry[];
  findings: Finding[];
  codexReviewText: string | null;
  tmuxOutput: string;
  maxIterations: number;
  isLoading: boolean;
  lastSessionStats: SessionStats | null;
  projectStats: ProjectStats | null;
  isGitRepo: boolean;
  currentAgent: AgentRole | null;
  reviewOptions: ReviewOptions | undefined;
  isStarting: boolean;
  isStopping: boolean;
  focused?: boolean;
}

function getStatusDisplay(
  status: string,
  currentAgent: AgentRole | null
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
        return { text: `running ${currentAgent} agent`, color: TUI_COLORS.status.success };
      }
      return { text: "running", color: TUI_COLORS.status.success };
    case "pending":
      return { text: "pending", color: TUI_COLORS.status.pending };
    default:
      return { text: "unknown", color: TUI_COLORS.status.inactive };
  }
}

function formatReviewType(reviewOptions: ReviewOptions | undefined): string {
  if (!reviewOptions) return "uncommitted changes";

  if (reviewOptions.customInstructions) {
    const instruction = reviewOptions.customInstructions.slice(0, 40);
    return reviewOptions.customInstructions.length > 40
      ? `custom (${instruction}...)`
      : `custom (${instruction})`;
  }

  if (reviewOptions.commitSha) {
    const shortSha = reviewOptions.commitSha.slice(0, 7);
    return `commit (${shortSha})`;
  }

  if (reviewOptions.baseBranch) {
    return `base (${reviewOptions.baseBranch})`;
  }

  return "uncommitted changes";
}

interface FixListProps {
  fixes: FixEntry[];
  showFiles: boolean;
  maxHeight?: number;
  focused?: boolean;
}

function priorityToString(priority: number | undefined): Priority | "P?" {
  if (priority === undefined) return "P?";
  const key = `P${priority}` as Priority;
  return VALID_PRIORITIES.includes(key) ? key : "P?";
}

function GitRepoWarning({ isGitRepo }: { isGitRepo: boolean }) {
  if (isGitRepo) return null;
  return (
    <box flexDirection="column" paddingBottom={1}>
      <text fg={TUI_COLORS.status.warning}>
        <strong>Not a git repository</strong>
      </text>
      <text fg={TUI_COLORS.text.dim}>Run "git init" to initialize</text>
    </box>
  );
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

interface FindingsListProps {
  findings: Finding[];
  maxHeight?: number;
  focused?: boolean;
}

interface SkippedListProps {
  skipped: SkippedEntry[];
  maxHeight?: number;
  focused?: boolean;
}

function countCodexReviewLines(text: string): number {
  return text.split("\n").filter((line) => line.trim() !== "").length;
}

function FindingsList({ findings, maxHeight = 8, focused = false }: FindingsListProps) {
  if (findings.length === 0) {
    return (
      <text fg={TUI_COLORS.text.dim} paddingLeft={2}>
        None yet
      </text>
    );
  }

  const linesPerFinding = 2;
  const totalLines = findings.length * linesPerFinding;
  const needsScroll = totalLines > maxHeight;

  const content = findings.map((finding, index) => {
    const priorityStr = priorityToString(finding.priority);
    const priorityColor =
      finding.priority !== undefined
        ? (PRIORITY_COLORS[`P${finding.priority}` as Priority] ?? UNKNOWN_PRIORITY_COLOR)
        : UNKNOWN_PRIORITY_COLOR;
    const location = finding.code_location;
    const lineRange = `${location.line_range.start}-${location.line_range.end}`;
    const filePath = truncateFilePath(location.absolute_file_path, 35);
    const key = `${index}-${location.absolute_file_path}:${lineRange}`;

    return (
      <box key={key} flexDirection="column">
        <box flexDirection="row">
          <text fg={priorityColor}>{priorityStr}</text>
          <text fg={TUI_COLORS.text.dim}> ▸ </text>
          <text fg={TUI_COLORS.text.secondary}>{truncateText(finding.title, 40)}</text>
        </box>
        <text fg={TUI_COLORS.text.dim} paddingLeft={5}>
          {filePath}:{lineRange}
        </text>
      </box>
    );
  });

  if (needsScroll) {
    return (
      <scrollbox paddingLeft={2} height={maxHeight} focused={focused}>
        {content}
      </scrollbox>
    );
  }

  return (
    <box flexDirection="column" paddingLeft={2}>
      {content}
    </box>
  );
}

function SkippedList({ skipped, maxHeight = 6, focused = false }: SkippedListProps) {
  if (skipped.length === 0) {
    return (
      <text fg={TUI_COLORS.text.dim} paddingLeft={2}>
        None yet
      </text>
    );
  }

  const linesPerItem = 2;
  const totalLines = skipped.length * linesPerItem;
  const needsScroll = totalLines > maxHeight;

  const content = skipped.map((entry, index) => (
    <box key={`${index}-${entry.id}`} flexDirection="column">
      <box flexDirection="row">
        <text fg={TUI_COLORS.text.dim}>SKIP</text>
        <text fg={TUI_COLORS.text.dim}> ▸ </text>
        <text fg={TUI_COLORS.text.secondary}>{truncateText(entry.title, 42)}</text>
      </box>
      <text fg={TUI_COLORS.text.dim} paddingLeft={6}>
        {truncateText(entry.reason, 54)}
      </text>
    </box>
  ));

  if (needsScroll) {
    return (
      <scrollbox paddingLeft={2} height={maxHeight} focused={focused}>
        {content}
      </scrollbox>
    );
  }

  return (
    <box flexDirection="column" paddingLeft={2}>
      {content}
    </box>
  );
}

interface CodexReviewDisplayProps {
  text: string;
  maxHeight?: number;
  focused?: boolean;
}

function CodexReviewDisplay({ text, maxHeight = 6, focused = false }: CodexReviewDisplayProps) {
  const lines = text.split("\n").filter((line) => line.trim() !== "");

  if (lines.length === 0) {
    return (
      <text fg={TUI_COLORS.text.dim} paddingLeft={2}>
        No review text
      </text>
    );
  }

  const needsScroll = lines.length > maxHeight;

  const content = lines.map((line, index) => (
    <text key={`${index}-${line.slice(0, 20)}`} fg={TUI_COLORS.text.secondary}>
      {truncateText(line, 50)}
    </text>
  ));

  if (needsScroll) {
    return (
      <scrollbox paddingLeft={2} height={maxHeight} focused={focused}>
        {content}
      </scrollbox>
    );
  }

  return (
    <box flexDirection="column" paddingLeft={2}>
      {content}
    </box>
  );
}

function FixList({ fixes, showFiles, maxHeight = 8, focused = false }: FixListProps) {
  if (fixes.length === 0) {
    return (
      <text fg={TUI_COLORS.text.dim} paddingLeft={2}>
        None yet
      </text>
    );
  }

  const linesPerFix = showFiles ? 2 : 1;
  const totalLines = fixes.length * linesPerFix;
  const needsScroll = totalLines > maxHeight;

  const content = fixes.map((fix, index) => (
    <box key={`${index}-${fix.id}`} flexDirection="column">
      <box flexDirection="row">
        <text fg={PRIORITY_COLORS[fix.priority as Priority] ?? UNKNOWN_PRIORITY_COLOR}>
          {fix.priority}
        </text>
        <text fg={TUI_COLORS.text.dim}> ▸ </text>
        <text fg={TUI_COLORS.text.secondary}>{truncateText(fix.title, 44)}</text>
      </box>
      {showFiles && fix.file && (
        <text fg={TUI_COLORS.text.dim} paddingLeft={5}>
          {truncateFilePath(fix.file, 50)}
        </text>
      )}
    </box>
  ));

  if (needsScroll) {
    return (
      <scrollbox paddingLeft={2} height={maxHeight} focused={focused}>
        {content}
      </scrollbox>
    );
  }

  return (
    <box flexDirection="column" paddingLeft={2}>
      {content}
    </box>
  );
}

export function SessionPanel({
  session,
  fixes,
  skipped,
  findings,
  codexReviewText,
  tmuxOutput,
  maxIterations,
  isLoading,
  lastSessionStats,
  projectStats,
  isGitRepo,
  currentAgent,
  reviewOptions,
  isStarting,
  isStopping,
  focused = false,
}: SessionPanelProps) {
  const minWidth = 50;
  const borderColor = focused ? TUI_COLORS.ui.borderFocused : TUI_COLORS.ui.border;
  const { height: terminalHeight } = useTerminalDimensions();
  const latestIterationMarker = useMemo(() => findLatestIterationMarker(tmuxOutput), [tmuxOutput]);
  const parsedCodexSummary = useMemo(() => {
    if (!codexReviewText) return null;
    return parseCodexReviewText(codexReviewText);
  }, [codexReviewText]);
  const liveReviewSummary = useMemo(() => {
    if (!tmuxOutput.trim()) return null;

    const minIndex =
      currentAgent === "reviewer" && latestIterationMarker ? latestIterationMarker.index : 0;

    return extractLatestReviewSummary(tmuxOutput, minIndex);
  }, [tmuxOutput, currentAgent, latestIterationMarker]);

  if (isLoading) {
    return (
      <box
        border
        borderStyle="rounded"
        borderColor={borderColor}
        title="Session"
        titleAlignment="left"
        padding={1}
        flexGrow={1}
        minWidth={minWidth}
      >
        <text fg={TUI_COLORS.text.muted}>Loading...</text>
      </box>
    );
  }

  if (!session) {
    if (!lastSessionStats) {
      return (
        <box
          border
          borderStyle="rounded"
          borderColor={borderColor}
          title="Session"
          titleAlignment="left"
          padding={1}
          flexGrow={1}
          minWidth={minWidth}
          flexDirection="column"
          gap={1}
        >
          <GitRepoWarning isGitRepo={isGitRepo} />
          {isStopping ? (
            <box flexDirection="row" gap={1}>
              <Spinner color={TUI_COLORS.status.warning} />
              <text fg={TUI_COLORS.status.warning}>Stopping review...</text>
            </box>
          ) : isStarting ? (
            <box flexDirection="row" gap={1}>
              <Spinner color={TUI_COLORS.status.pending} />
              <text fg={TUI_COLORS.status.pending}>Starting review...</text>
            </box>
          ) : (
            <text fg={TUI_COLORS.text.muted}>No active session</text>
          )}

          <text fg={TUI_COLORS.text.dim}>Start a review with "rr run"</text>
        </box>
      );
    }

    const statusDisplay = getStatusDisplay(lastSessionStats.status, null);
    const lastSessionFixes = extractFixesFromStats(lastSessionStats);

    return (
      <box
        border
        borderStyle="rounded"
        borderColor={borderColor}
        title="Session"
        titleAlignment="left"
        padding={1}
        flexGrow={1}
        minWidth={minWidth}
        flexDirection="column"
        gap={1}
      >
        <GitRepoWarning isGitRepo={isGitRepo} />
        {isStopping ? (
          <box flexDirection="row" gap={1}>
            <Spinner color={TUI_COLORS.status.warning} />
            <text fg={TUI_COLORS.status.warning}>Stopping review...</text>
          </box>
        ) : isStarting ? (
          <box flexDirection="row" gap={1}>
            <Spinner color={TUI_COLORS.status.pending} />
            <text fg={TUI_COLORS.status.pending}>Starting review...</text>
          </box>
        ) : (
          <text fg={TUI_COLORS.text.muted}>No active session</text>
        )}

        {projectStats && projectStats.totalFixes > 0 && (
          <box flexDirection="column">
            <text fg={TUI_COLORS.text.muted}>Project stats:</text>
            <box flexDirection="row" paddingLeft={2}>
              {formatPriorityBreakdown(projectStats.priorityCounts).map((item, idx, arr) => (
                <box key={item.priority} flexDirection="row">
                  <text fg={PRIORITY_COLORS[item.priority]}>{item.priority} </text>
                  <text fg={TUI_COLORS.text.muted}>{item.count}</text>
                  {idx < arr.length - 1 && <text fg={TUI_COLORS.text.dim}> · </text>}
                </box>
              ))}
            </box>
            <text fg={TUI_COLORS.text.dim} paddingLeft={2}>
              {formatProjectStatsSummary(projectStats.totalFixes, projectStats.sessionCount)}
            </text>
          </box>
        )}

        <box flexDirection="column">
          <box flexDirection="row" gap={1}>
            <text fg={TUI_COLORS.text.muted}>Last run:</text>
            <text fg={statusDisplay.color}>{statusDisplay.text}</text>
            <text fg={TUI_COLORS.text.dim}>({formatRelativeTime(lastSessionStats.timestamp)})</text>
          </box>
          <text fg={TUI_COLORS.text.dim} paddingLeft={2}>
            {lastSessionStats.totalFixes} fix{lastSessionStats.totalFixes !== 1 ? "es" : ""} in{" "}
            {lastSessionStats.iterations} iteration{lastSessionStats.iterations !== 1 ? "s" : ""}
          </text>
          {lastSessionStats.stop_iteration !== undefined && (
            <text fg={TUI_COLORS.text.dim} paddingLeft={2}>
              Stop iteration: {lastSessionStats.stop_iteration ? "yes" : "no"}
            </text>
          )}
        </box>

        {lastSessionFixes.length > 0 && (
          <box flexDirection="column">
            <text fg={TUI_COLORS.text.muted}>Recent fixes:</text>
            <FixList fixes={lastSessionFixes} showFiles={true} />
          </box>
        )}
      </box>
    );
  }

  const iteration = session.iteration ?? 0;
  const statusDisplay = getStatusDisplay(session.status ?? "unknown", currentAgent);

  const shouldClearForNewReview = currentAgent === "reviewer" && !liveReviewSummary;

  let displayFindings = findings;
  let displayCodexText = codexReviewText;

  if (liveReviewSummary) {
    displayFindings = liveReviewSummary.findings;
    displayCodexText = null;
  } else if (shouldClearForNewReview) {
    displayFindings = [];
    displayCodexText = null;
  } else if (findings.length > 0) {
    displayCodexText = null;
  } else if (parsedCodexSummary && parsedCodexSummary.findings.length > 0) {
    displayFindings = parsedCodexSummary.findings;
    displayCodexText = null;
  }

  const showingCodex = displayCodexText !== null && displayFindings.length === 0;
  const verifyCount =
    showingCodex && displayCodexText
      ? countCodexReviewLines(displayCodexText)
      : displayFindings.length;
  const appliedCount = fixes.length;
  const skippedCount = skipped.length;

  const listHeightBudget = Math.max(10, terminalHeight - 23);
  const verifyMaxHeight = Math.max(4, Math.floor(listHeightBudget * 0.5));
  const appliedMaxHeight = Math.max(3, Math.floor(listHeightBudget * 0.3));
  const skippedMaxHeight = Math.max(3, listHeightBudget - verifyMaxHeight - appliedMaxHeight);

  return (
    <box
      border
      borderStyle="rounded"
      borderColor={borderColor}
      title="Session"
      titleAlignment="left"
      padding={1}
      flexGrow={1}
      minWidth={minWidth}
      flexDirection="column"
      gap={1}
    >
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
            {(session.status === "running" || session.status === "pending") && (
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
        <text fg={TUI_COLORS.text.primary}>{formatReviewType(reviewOptions)}</text>
      </box>

      <ProgressBar current={iteration} max={maxIterations} />

      <box flexDirection="column">
        <SectionHeader
          title="Needs verify"
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
