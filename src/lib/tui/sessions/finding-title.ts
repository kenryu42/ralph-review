export function formatFindingTitleForDisplay(title: string): string {
  return title.replace(/^(?:\s*\[P[0-3]\]\s*)+/i, "").trim();
}
