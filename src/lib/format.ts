import type { ReviewOptions } from "@/lib/types";

export function formatReviewType(reviewOptions: ReviewOptions | undefined): string {
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
