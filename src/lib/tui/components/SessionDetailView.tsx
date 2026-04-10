import { useEffect, useMemo, useRef } from "react";
import { formatReviewType } from "@/lib/format";
import type { SessionState } from "@/lib/session-state";
import { TUI_COLORS } from "@/lib/tui/colors";
import type {
  AgentRole,
  Finding,
  FixEntry,
  ReviewOptions,
  ReviewSummary,
  SkippedEntry,
} from "@/lib/types";
import { parseCodexReviewText } from "@/lib/types";
import {
  extractLatestReviewSummary,
  findLatestReviewerPhaseStart,
  formatSessionIdentityDisplay,
  resolveIssuesFoundDisplay,
} from "../session-panel-utils";
import { ProgressBar } from "./ProgressBar";
import { Spinner } from "./Spinner";
import {
  FindingsList,
  FixList,
  SectionHeader,
  SkippedList,
  toSingleLine,
} from "./session-detail-parts";

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

type BoxHeight = number | "auto" | `${number}%`;

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

function countCodexReviewLines(text: string): number {
  return text.split("\n").filter((line) => line.trim() !== "").length;
}

function CodexReviewDisplay({
  text,
  height = 6,
  focused = false,
}: {
  text: string;
  height?: BoxHeight;
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
    <scrollbox paddingLeft={2} height={height} focused={focused}>
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

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
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

      <box flexDirection="column" flexBasis={0} flexGrow={5} minHeight={0}>
        <SectionHeader
          title="Issues found"
          count={verifyCount}
          suffix={showingCodex ? <span fg={TUI_COLORS.text.dim}> · codex</span> : undefined}
        />
        <box flexGrow={1} minHeight={0}>
          {showingCodex ? (
            <CodexReviewDisplay text={displayCodexText ?? ""} height="100%" focused={focused} />
          ) : (
            <FindingsList findings={displayFindings} height="100%" focused={focused} />
          )}
        </box>
      </box>

      <box flexDirection="column" flexBasis={0} flexGrow={3} minHeight={0}>
        <SectionHeader title="Fix applied" count={appliedCount} />
        <box flexGrow={1} minHeight={0}>
          <FixList fixes={fixes} showFiles={true} height="100%" focused={false} />
        </box>
      </box>

      <box flexDirection="column" flexBasis={0} flexGrow={2} minHeight={0}>
        <SectionHeader title="Skipped" count={skippedCount} />
        <box flexGrow={1} minHeight={0}>
          <SkippedList skipped={skipped} height="100%" focused={false} />
        </box>
      </box>
    </box>
  );
}
