import { useTerminalDimensions } from "@opentui/react";
import type { LockData } from "@/lib/lockfile";
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
import { VALID_PRIORITIES } from "@/lib/types/domain";
import {
  extractFixesFromStats,
  formatPriorityBreakdown,
  formatProjectStatsSummary,
  formatRelativeTime,
  PRIORITY_COLORS,
  truncateFilePath,
  truncateText,
  UNKNOWN_PRIORITY_COLOR,
} from "../session-panel-utils";
import { Spinner } from "./Spinner";

interface SessionPanelProps {
  session: LockData | null;
  fixes: FixEntry[];
  skipped: SkippedEntry[];
  findings: Finding[];
  codexReviewText: string | null;
  maxIterations: number;
  isLoading: boolean;
  lastSessionStats: SessionStats | null;
  projectStats: ProjectStats | null;
  isGitRepo: boolean;
  currentAgent: AgentRole | null;
  reviewOptions: ReviewOptions | undefined;
  isStarting: boolean;
  isStopping: boolean;
}

function getStatusDisplay(
  status: string,
  currentAgent: AgentRole | null
): { text: string; color: string } {
  switch (status) {
    case "completed":
      return { text: "completed", color: "#22c55e" };
    case "failed":
      return { text: "failed", color: "#ef4444" };
    case "interrupted":
      return { text: "interrupted", color: "#f97316" };
    case "running":
      if (currentAgent) {
        return { text: `running ${currentAgent} agent`, color: "#22c55e" };
      }
      return { text: "running", color: "#22c55e" };
    case "pending":
      return { text: "pending", color: "#eab308" };
    default:
      return { text: "unknown", color: "#6b7280" };
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
      <text fg="#f97316">
        <strong>Not a git repository</strong>
      </text>
      <text fg="#6b7280">Run "git init" to initialize</text>
    </box>
  );
}

interface FindingsListProps {
  findings: Finding[];
  maxHeight?: number;
}

interface SkippedListProps {
  skipped: SkippedEntry[];
  maxHeight?: number;
}

function countCodexReviewLines(text: string): number {
  return text.split("\n").filter((line) => line.trim() !== "").length;
}

function FindingsList({ findings, maxHeight = 8 }: FindingsListProps) {
  if (findings.length === 0) {
    return (
      <text fg="#6b7280" paddingLeft={2}>
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
          <text fg="#6b7280"> ▸ </text>
          <text fg="#e5e7eb">{truncateText(finding.title, 40)}</text>
        </box>
        <text fg="#6b7280" paddingLeft={5}>
          {filePath}:{lineRange}
        </text>
      </box>
    );
  });

  if (needsScroll) {
    return (
      <scrollbox paddingLeft={2} height={maxHeight}>
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

function SkippedList({ skipped, maxHeight = 6 }: SkippedListProps) {
  if (skipped.length === 0) {
    return (
      <text fg="#6b7280" paddingLeft={2}>
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
        <text fg="#6b7280">SKIP</text>
        <text fg="#6b7280"> ▸ </text>
        <text fg="#e5e7eb">{truncateText(entry.title, 42)}</text>
      </box>
      <text fg="#6b7280" paddingLeft={6}>
        {truncateText(entry.reason, 54)}
      </text>
    </box>
  ));

  if (needsScroll) {
    return (
      <scrollbox paddingLeft={2} height={maxHeight}>
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
}

function CodexReviewDisplay({ text, maxHeight = 6 }: CodexReviewDisplayProps) {
  const lines = text.split("\n").filter((line) => line.trim() !== "");

  if (lines.length === 0) {
    return (
      <text fg="#6b7280" paddingLeft={2}>
        No review text
      </text>
    );
  }

  const needsScroll = lines.length > maxHeight;

  const content = lines.map((line, index) => (
    <text key={`${index}-${line.slice(0, 20)}`} fg="#e5e7eb">
      {truncateText(line, 50)}
    </text>
  ));

  if (needsScroll) {
    return (
      <scrollbox paddingLeft={2} height={maxHeight}>
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

function FixList({ fixes, showFiles, maxHeight = 8 }: FixListProps) {
  if (fixes.length === 0) {
    return (
      <text fg="#6b7280" paddingLeft={2}>
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
        <text fg="#6b7280"> ▸ </text>
        <text fg="#e5e7eb">{truncateText(fix.title, 44)}</text>
      </box>
      {showFiles && fix.file && (
        <text fg="#6b7280" paddingLeft={5}>
          {truncateFilePath(fix.file, 50)}
        </text>
      )}
    </box>
  ));

  if (needsScroll) {
    return (
      <scrollbox paddingLeft={2} height={maxHeight}>
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
  maxIterations,
  isLoading,
  lastSessionStats,
  projectStats,
  isGitRepo,
  currentAgent,
  reviewOptions,
  isStarting,
  isStopping,
}: SessionPanelProps) {
  const minWidth = 50;
  const { height: terminalHeight } = useTerminalDimensions();

  if (isLoading) {
    return (
      <box border borderColor="#374151" padding={1} flexGrow={1} minWidth={minWidth}>
        <text fg="#9ca3af">Loading...</text>
      </box>
    );
  }

  if (!session) {
    if (!lastSessionStats) {
      return (
        <box
          border
          borderColor="#374151"
          padding={1}
          flexGrow={1}
          minWidth={minWidth}
          flexDirection="column"
          gap={1}
        >
          <GitRepoWarning isGitRepo={isGitRepo} />
          {isStopping ? (
            <box flexDirection="row" gap={1}>
              <Spinner color="#f97316" />
              <text fg="#f97316">Stopping review...</text>
            </box>
          ) : isStarting ? (
            <box flexDirection="row" gap={1}>
              <Spinner color="#eab308" />
              <text fg="#eab308">Starting review...</text>
            </box>
          ) : (
            <text fg="#9ca3af">No active session</text>
          )}

          <text fg="#6b7280">Start a review with "rr run"</text>
        </box>
      );
    }

    const statusDisplay = getStatusDisplay(lastSessionStats.status, null);
    const lastSessionFixes = extractFixesFromStats(lastSessionStats);

    return (
      <box
        border
        borderColor="#374151"
        padding={1}
        flexGrow={1}
        minWidth={minWidth}
        flexDirection="column"
        gap={1}
      >
        <GitRepoWarning isGitRepo={isGitRepo} />
        {isStopping ? (
          <box flexDirection="row" gap={1}>
            <Spinner color="#f97316" />
            <text fg="#f97316">Stopping review...</text>
          </box>
        ) : isStarting ? (
          <box flexDirection="row" gap={1}>
            <Spinner color="#eab308" />
            <text fg="#eab308">Starting review...</text>
          </box>
        ) : (
          <text fg="#9ca3af">No active session</text>
        )}

        {projectStats && projectStats.totalFixes > 0 && (
          <box flexDirection="column">
            <text fg="#9ca3af">Project stats:</text>
            <box flexDirection="row" paddingLeft={2}>
              {formatPriorityBreakdown(projectStats.priorityCounts).map((item, idx, arr) => (
                <box key={item.priority} flexDirection="row">
                  <text fg={PRIORITY_COLORS[item.priority]}>{item.priority} </text>
                  <text fg="#9ca3af">{item.count}</text>
                  {idx < arr.length - 1 && <text fg="#6b7280"> · </text>}
                </box>
              ))}
            </box>
            <text fg="#6b7280" paddingLeft={2}>
              {formatProjectStatsSummary(projectStats.totalFixes, projectStats.sessionCount)}
            </text>
          </box>
        )}

        <box flexDirection="column">
          <box flexDirection="row" gap={1}>
            <text fg="#9ca3af">Last run:</text>
            <text fg={statusDisplay.color}>{statusDisplay.text}</text>
            <text fg="#6b7280">({formatRelativeTime(lastSessionStats.timestamp)})</text>
          </box>
          <text fg="#6b7280" paddingLeft={2}>
            {lastSessionStats.totalFixes} fix{lastSessionStats.totalFixes !== 1 ? "es" : ""} in{" "}
            {lastSessionStats.iterations} iteration{lastSessionStats.iterations !== 1 ? "s" : ""}
          </text>
          {lastSessionStats.stop_iteration !== undefined && (
            <text fg="#6b7280" paddingLeft={2}>
              Stop iteration: {lastSessionStats.stop_iteration ? "yes" : "no"}
            </text>
          )}
        </box>

        {lastSessionFixes.length > 0 && (
          <box flexDirection="column">
            <text fg="#9ca3af">Recent fixes:</text>
            <FixList fixes={lastSessionFixes} showFiles={true} />
          </box>
        )}
      </box>
    );
  }

  const iteration = session.iteration ?? 0;
  const statusDisplay = getStatusDisplay(session.status ?? "unknown", currentAgent);

  const verifyCount =
    codexReviewText && findings.length === 0
      ? countCodexReviewLines(codexReviewText)
      : findings.length;
  const appliedCount = fixes.length;
  const skippedCount = skipped.length;

  const listHeightBudget = Math.max(10, terminalHeight - 23);
  const verifyMaxHeight = Math.max(4, Math.floor(listHeightBudget * 0.5));
  const appliedMaxHeight = Math.max(3, Math.floor(listHeightBudget * 0.3));
  const skippedMaxHeight = Math.max(3, listHeightBudget - verifyMaxHeight - appliedMaxHeight);

  return (
    <box
      border
      borderColor="#374151"
      padding={1}
      flexGrow={1}
      minWidth={minWidth}
      flexDirection="column"
      gap={1}
    >
      <box flexDirection="row" gap={1}>
        <text fg="#9ca3af">Status:</text>
        {isStopping ? (
          <>
            <Spinner color="#f97316" />
            <text fg="#f97316">
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
        <text fg="#9ca3af">Review Type:</text>
        <text fg="#f9fafb">{formatReviewType(reviewOptions)}</text>
      </box>

      <box flexDirection="row" gap={1}>
        <text fg="#9ca3af">Iteration:</text>
        <text fg="#f9fafb">
          {iteration}/{maxIterations || "?"}
        </text>
      </box>

      <box flexDirection="column">
        <text>
          <span fg="#9ca3af">
            <strong>Needs verify</strong>
          </span>
          <span fg="#6b7280"> ({verifyCount})</span>
          {codexReviewText && findings.length === 0 && <span fg="#6b7280"> · codex</span>}
        </text>
        {codexReviewText && findings.length === 0 ? (
          <CodexReviewDisplay text={codexReviewText} maxHeight={verifyMaxHeight} />
        ) : (
          <FindingsList findings={findings} maxHeight={verifyMaxHeight} />
        )}
      </box>

      <box flexDirection="column">
        <text>
          <span fg="#9ca3af">
            <strong>Fix applied</strong>
          </span>
          <span fg="#6b7280"> ({appliedCount})</span>
        </text>
        <FixList fixes={fixes} showFiles={true} maxHeight={appliedMaxHeight} />
      </box>

      <box flexDirection="column">
        <text>
          <span fg="#9ca3af">
            <strong>Skipped</strong>
          </span>
          <span fg="#6b7280"> ({skippedCount})</span>
        </text>
        <SkippedList skipped={skipped} maxHeight={skippedMaxHeight} />
      </box>
    </box>
  );
}
