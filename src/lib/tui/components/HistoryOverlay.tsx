import { useKeyboard, useRenderer } from "@opentui/react";
import { useEffect, useMemo, useState } from "react";
import type { LogSession } from "@/lib/logger";
import { computeSessionStats, listLogSessions } from "@/lib/logger";
import { TUI_COLORS } from "@/lib/tui/colors";
import type { DerivedRunStatus, SessionStats } from "@/lib/types";
import {
  formatLastRunIssueSummary,
  formatPriorityBreakdown,
  formatRelativeTime,
  PRIORITY_COLORS,
} from "../session-panel-utils";

interface HistoryOverlayProps {
  onClose: () => void;
}

function statusColor(status: DerivedRunStatus): string {
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

function sessionLabel(session: LogSession): string {
  const name = session.name.replace(/\.jsonl$/, "");
  return `${session.projectName}: ${name}`;
}

function HistoryDetailPane({ stats }: { stats: SessionStats }) {
  const issueSummary = formatLastRunIssueSummary(
    stats.totalFixes,
    stats.totalSkipped,
    stats.iterations
  );

  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="row" gap={1}>
        <text fg={TUI_COLORS.text.muted}>Status:</text>
        <text fg={statusColor(stats.status)}>{stats.status}</text>
      </box>

      {stats.gitBranch && (
        <box flexDirection="row" gap={1}>
          <text fg={TUI_COLORS.text.muted}>Branch:</text>
          <text fg={TUI_COLORS.text.secondary}>{stats.gitBranch}</text>
        </box>
      )}

      <box flexDirection="row" gap={1}>
        <text fg={TUI_COLORS.text.muted}>R:</text>
        <text fg={TUI_COLORS.text.secondary}>
          {stats.reviewerDisplayName} ({stats.reviewerModelDisplayName})
        </text>
      </box>

      <box flexDirection="row" gap={1}>
        <text fg={TUI_COLORS.text.muted}>F:</text>
        <text fg={TUI_COLORS.text.secondary}>
          {stats.fixerDisplayName} ({stats.fixerModelDisplayName})
        </text>
      </box>

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
    </box>
  );
}

export function HistoryOverlay({ onClose }: HistoryOverlayProps) {
  const renderer = useRenderer();
  const [sessions, setSessions] = useState<LogSession[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedStats, setSelectedStats] = useState<SessionStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(false);

  useEffect(() => {
    listLogSessions().then((s) => {
      setSessions(s);
      if (s.length > 0) setSelectedPath(s[0]!.path);
      setIsLoading(false);
    });
  }, []);

  useEffect(() => {
    const session = sessions.find((s) => s.path === selectedPath);
    if (!session) return;

    setStatsLoading(true);
    setSelectedStats(null);
    computeSessionStats(session).then((stats) => {
      setSelectedStats(stats);
      setStatsLoading(false);
    });
  }, [sessions, selectedPath]);

  const { selectOptions, sessionSlots } = useMemo(() => {
    const grouped = new Map<string, LogSession[]>();
    for (const s of sessions) {
      const bucket = grouped.get(s.projectName) ?? [];
      bucket.push(s);
      grouped.set(s.projectName, bucket);
    }

    const selectOptions: Array<{ name: string; description: string; value: string }> = [];
    const sessionSlots: Array<LogSession | null> = [];

    for (const [projectName, projectSessions] of grouped) {
      selectOptions.push({
        name: `── ${projectName} ──`,
        description: "",
        value: `__header__${projectName}`,
      });
      sessionSlots.push(null);
      for (const s of projectSessions) {
        const name = s.name.replace(/\.jsonl$/, "");
        selectOptions.push({
          name: `${name} (${formatRelativeTime(s.timestamp)})`,
          description: "",
          value: s.path,
        });
        sessionSlots.push(s);
      }
    }

    return { selectOptions, sessionSlots };
  }, [sessions]);

  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "l") {
      onClose();
      return;
    }
  });

  // Overhead: outer padding (2) + panel border (2) + panel padding (2) = 6
  const selectHeight = Math.max(3, renderer.height - 6);

  const selectedSession = selectedPath
    ? (sessions.find((s) => s.path === selectedPath) ?? null)
    : null;

  return (
    <box position="absolute" left={0} top={0} width="100%" height="100%" backgroundColor="#0d0d1a">
      <box flexDirection="row" width="100%" height="100%" gap={1} padding={1}>
        <box
          border
          borderStyle="rounded"
          title="History"
          titleAlignment="left"
          width={70}
          flexShrink={0}
          flexDirection="column"
          padding={1}
        >
          {isLoading ? (
            <text fg={TUI_COLORS.text.muted}>Loading...</text>
          ) : selectOptions.length === 0 ? (
            <text fg={TUI_COLORS.text.muted}>No sessions found</text>
          ) : (
            <select
              options={selectOptions}
              height={selectHeight}
              focused
              showScrollIndicator
              selectedIndex={sessionSlots.findIndex((s) => s?.path === selectedPath)}
              onChange={(idx) => {
                const slot = sessionSlots[idx];
                if (slot) setSelectedPath(slot.path);
              }}
            />
          )}
        </box>

        <box
          border
          borderStyle="rounded"
          title={selectedSession ? sessionLabel(selectedSession) : "Session Detail"}
          titleAlignment="left"
          flexGrow={1}
          flexDirection="column"
          padding={1}
        >
          {statsLoading ? (
            <text fg={TUI_COLORS.text.muted}>Loading...</text>
          ) : !selectedStats ? (
            <text fg={TUI_COLORS.text.muted}>Select a session to view details</text>
          ) : (
            <HistoryDetailPane stats={selectedStats} />
          )}
        </box>
      </box>
    </box>
  );
}
