import { TUI_COLORS } from "@/lib/tui/colors";
import {
  type FixEntry,
  type IterationEntry,
  isReviewSummary,
  type Priority,
  type ReviewSummary,
  type SessionStats,
} from "@/lib/types";

export const PRIORITY_COLORS: Record<Priority, string> = {
  P0: TUI_COLORS.status.error,
  P1: TUI_COLORS.status.warning,
  P2: TUI_COLORS.status.pending,
  P3: TUI_COLORS.status.success,
};

export const UNKNOWN_PRIORITY_COLOR = TUI_COLORS.status.inactive;

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

export function formatRelativeTime(timestamp: number): string {
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

interface JsonObjectSlice {
  start: number;
  end: number;
  value: string;
}

function extractBalancedJsonObjects(text: string): JsonObjectSlice[] {
  const results: JsonObjectSlice[] = [];
  let depth = 0;
  let startIndex = -1;
  let inString = false;
  let isEscaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }
      if (char === "\\") {
        isEscaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        startIndex = i;
      }
      depth += 1;
      continue;
    }

    if (char === "}") {
      if (depth === 0) {
        continue;
      }
      depth -= 1;
      if (depth === 0 && startIndex >= 0) {
        const endIndex = i + 1;
        results.push({
          start: startIndex,
          end: endIndex,
          value: text.slice(startIndex, endIndex),
        });
        startIndex = -1;
      }
    }
  }

  return results;
}

export function extractLatestReviewSummary(
  text: string,
  minIndex: number = 0
): ReviewSummary | null {
  if (!text.trim()) return null;

  const objects = extractBalancedJsonObjects(text);
  for (let i = objects.length - 1; i >= 0; i--) {
    const candidate = objects[i];
    if (!candidate) {
      continue;
    }
    if (candidate.start < minIndex) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(candidate.value);
      if (isReviewSummary(parsed)) {
        return parsed;
      }
    } catch {
      // Ignore invalid JSON blocks
    }
  }

  return null;
}

export function findLatestIterationMarker(
  text: string
): { iteration: number; total?: number; index: number } | null {
  const pattern = /Iteration\s+(\d+)\s*\/\s*(\d+)/g;
  let match: RegExpExecArray | null = null;
  let latest: { iteration: number; total?: number; index: number } | null = null;

  match = pattern.exec(text);
  while (match !== null) {
    const iteration = Number.parseInt(match[1] ?? "", 10);
    const total = Number.parseInt(match[2] ?? "", 10);

    if (!Number.isNaN(iteration)) {
      latest = {
        iteration,
        total: Number.isNaN(total) ? undefined : total,
        index: match.index,
      };
    }

    match = pattern.exec(text);
  }

  return latest;
}
