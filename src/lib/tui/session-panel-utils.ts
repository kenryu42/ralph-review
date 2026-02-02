import type { FixEntry, IterationEntry, Priority, SessionStats } from "@/lib/types";

export const PRIORITY_COLORS: Record<Priority, string> = {
  P0: "#ef4444",
  P1: "#f97316",
  P2: "#eab308",
  P3: "#22c55e",
};

export const UNKNOWN_PRIORITY_COLOR = "#6b7280";

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
