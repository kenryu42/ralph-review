import type { SessionGroupData } from "@/lib/tui/workspace/workspace-types";

export function selectAdjacentGroupPath(
  groups: SessionGroupData[],
  currentPath: string,
  direction: "prev" | "next"
): string {
  if (groups.length === 0) {
    return currentPath;
  }

  const index = groups.findIndex((group) => group.projectPath === currentPath);
  if (index < 0) {
    return groups[0]?.projectPath ?? currentPath;
  }

  const delta = direction === "prev" ? -1 : 1;
  const nextIndex = Math.min(groups.length - 1, Math.max(0, index + delta));
  return groups[nextIndex]?.projectPath ?? currentPath;
}

export function resolveSelectedGroupPath(
  groups: SessionGroupData[],
  preferredPath: string,
  fallbackPath: string
): string {
  if (groups.some((group) => group.projectPath === preferredPath)) {
    return preferredPath;
  }
  if (groups.some((group) => group.projectPath === fallbackPath)) {
    return fallbackPath;
  }
  return groups[0]?.projectPath ?? fallbackPath;
}
