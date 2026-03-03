import type { ReviewOptions } from "@/lib/types";

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
