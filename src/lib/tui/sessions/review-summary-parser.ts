import { extractBalancedJsonObjectSlices } from "@/lib/structured-output";
import { isReviewSummary, type ReviewSummary } from "@/lib/types";

export function extractLatestReviewSummary(
  text: string,
  minIndex: number = 0
): ReviewSummary | null {
  if (!text.trim()) {
    return null;
  }

  const objects = extractBalancedJsonObjectSlices(text);
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    const candidate = objects[index];
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
      // Ignore invalid JSON blocks in tmux output.
    }
  }

  return null;
}

export function findLatestReviewerPhaseStart(text: string): number {
  if (!text) {
    return -1;
  }

  const markers = ["Running reviewer...", "Fixes applied. Re-running reviewer..."];
  let latestIndex = -1;

  for (const marker of markers) {
    const index = text.lastIndexOf(marker);
    if (index > latestIndex) {
      latestIndex = index;
    }
  }

  return latestIndex;
}
