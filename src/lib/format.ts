import type { ReviewOptions } from "@/lib/types";

export function formatDuration(ms: number | null | undefined): string {
  if (ms === undefined || ms === null) return "—";

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function formatCustomReviewType(customInstructions: string): string {
  const instruction = customInstructions.slice(0, 40);
  return customInstructions.length > 40 ? `custom (${instruction}...)` : `custom (${instruction})`;
}

export function formatReviewType(reviewOptions: ReviewOptions | undefined): string {
  if (!reviewOptions) return "uncommitted changes";

  if (reviewOptions.commitSha) {
    const shortSha = reviewOptions.commitSha.slice(0, 7);
    if (reviewOptions.customInstructions) {
      return `commit (${shortSha}) + ${formatCustomReviewType(reviewOptions.customInstructions)}`;
    }
    return `commit (${shortSha})`;
  }

  if (reviewOptions.baseBranch) {
    if (reviewOptions.customInstructions) {
      return `base (${reviewOptions.baseBranch}) + ${formatCustomReviewType(reviewOptions.customInstructions)}`;
    }
    return `base (${reviewOptions.baseBranch})`;
  }

  if (reviewOptions.customInstructions) {
    return formatCustomReviewType(reviewOptions.customInstructions);
  }

  return "uncommitted changes";
}
