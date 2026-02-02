import type { LockData } from "@/lib/lockfile";
import type {
  AgentRole,
  FixEntry,
  IterationEntry,
  Priority,
  ProjectStats,
  ReviewOptions,
  SessionStats,
  SkippedEntry,
} from "@/lib/types";
import { Spinner } from "./Spinner";

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  if (maxLength <= 1) return "…";
  return `${text.slice(0, maxLength - 1)}…`;
}

export function truncateFilePath(filePath: string, maxLength: number): string {
  if (!filePath || filePath.length <= maxLength) return filePath;

  const lastSlash = filePath.lastIndexOf("/");
  if (lastSlash === -1) return truncateText(filePath, maxLength);

  const filename = filePath.slice(lastSlash + 1);
  const remaining = maxLength - filename.length - 2;

  if (remaining <= 0) {
    return `…/${filename}`;
  }

  const directory = filePath.slice(0, lastSlash);
  const truncatedDir = directory.slice(-remaining);
  const nextSlash = truncatedDir.indexOf("/");

  if (nextSlash !== -1) {
    return `…${truncatedDir.slice(nextSlash)}/${filename}`;
  }
  return `…/${filename}`;
}

export function formatPriorityBreakdown(
  counts: Record<Priority, number>
): Array<{ priority: Priority; count: number }> {
  const priorities: Priority[] = ["P0", "P1", "P2", "P3"];
  return priorities.map((p) => ({ priority: p, count: counts[p] }));
}

export function formatProjectStatsSummary(totalFixes: number, sessionCount: number): string {
  const fixWord = totalFixes === 1 ? "fix" : "fixes";
  const sessionWord = sessionCount === 1 ? "session" : "sessions";
  return `${totalFixes} ${fixWord} across ${sessionCount} ${sessionWord}`;
}

export function extractFixesFromStats(stats: SessionStats): FixEntry[] {
  const fixes: FixEntry[] = [];
  for (const entry of stats.entries) {
    if (entry.type === "iteration") {
      const iterEntry = entry as IterationEntry;
      if (iterEntry.fixes?.fixes) {
        fixes.push(...iterEntry.fixes.fixes);
      }
    }
  }
  return fixes;
}

interface SessionPanelProps {
  session: LockData | null;
  fixes: FixEntry[];
  skipped: SkippedEntry[];
  maxIterations: number;
  isLoading: boolean;
  lastSessionStats: SessionStats | null;
  projectStats: ProjectStats | null;
  isGitRepo: boolean;
  currentAgent: AgentRole | null;
  reviewOptions: ReviewOptions | undefined;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 1) return `${days}d ago`;
  if (days === 1) return "yesterday";
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
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
      ? `custom: ${instruction}...`
      : `custom: ${instruction}`;
  }

  if (reviewOptions.commitSha) {
    const shortSha = reviewOptions.commitSha.slice(0, 7);
    return `commit: ${shortSha}`;
  }

  if (reviewOptions.baseBranch) {
    return `base: ${reviewOptions.baseBranch}`;
  }

  return "uncommitted changes";
}

const PRIORITY_COLORS: Record<Priority, string> = {
  P0: "#ef4444",
  P1: "#f97316",
  P2: "#eab308",
  P3: "#22c55e",
};

const UNKNOWN_PRIORITY_COLOR = "#6b7280";

interface FixListProps {
  fixes: FixEntry[];
  showFiles: boolean;
  maxHeight?: number;
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
        <text fg="#e5e7eb">{fix.title}</text>
      </box>
      {showFiles && fix.file && (
        <text fg="#6b7280" paddingLeft={5}>
          {fix.file}
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
  maxIterations,
  isLoading,
  lastSessionStats,
  projectStats,
  isGitRepo,
  currentAgent,
  reviewOptions,
}: SessionPanelProps) {
  const minWidth = 40;

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
          {!isGitRepo && (
            <box flexDirection="column" paddingBottom={1}>
              <text fg="#f97316">
                <strong>Not a git repository</strong>
              </text>
              <text fg="#6b7280">Run "git init" to initialize</text>
            </box>
          )}
          <text fg="#9ca3af">No active session</text>

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
        {!isGitRepo && (
          <box flexDirection="column" paddingBottom={1}>
            <text fg="#f97316">
              <strong>Not a git repository</strong>
            </text>
            <text fg="#6b7280">Run "git init" to initialize</text>
          </box>
        )}
        <text fg="#9ca3af">No active session</text>

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
        {session.status === "running" && <Spinner color={statusDisplay.color} />}
        <text fg={statusDisplay.color}>
          <strong>{statusDisplay.text}</strong>
        </text>
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
        <text fg="#9ca3af">Fixes Applied ({fixes.length}):</text>
        <FixList fixes={fixes} showFiles={false} />
      </box>

      {skipped.length > 0 && (
        <box flexDirection="row" gap={1}>
          <text fg="#9ca3af">Skipped:</text>
          <text fg="#6b7280">{skipped.length}</text>
        </box>
      )}
    </box>
  );
}
