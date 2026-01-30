/**
 * Reviewer prompt generation for ralph-review
 * Combines a base prompt with review type-specific instructions
 */

import { mergeBaseWithHead } from "@/lib/git";
import defaultReviewPromptContent from "./defaults/review.md" with { type: "text" };

/**
 * The default reviewer base prompt content.
 * Exported so it can be used when no custom file is provided.
 */
export const defaultReviewPrompt: string = defaultReviewPromptContent;

/**
 * Instruction appended for reviewing uncommitted changes
 */
export const UNCOMMITTED_INSTRUCTION =
  "Review the current code changes (staged, unstaged, and untracked files) and provide prioritized findings.";

/**
 * Instruction appended for reviewing against a base branch (with known merge-base SHA)
 */
const BASE_BRANCH_INSTRUCTION = (baseBranch: string, mergeBaseSha: string) =>
  `Review the code changes against the base branch '${baseBranch}'. The merge base commit for this comparison is ${mergeBaseSha}. Run \`git diff ${mergeBaseSha}\` to inspect the changes relative to ${baseBranch}. Provide prioritized, actionable findings.`;

/**
 * Fallback instruction when merge-base cannot be calculated
 */
const BASE_BRANCH_INSTRUCTION_BACKUP = (branch: string) =>
  `Review the code changes against the base branch '${branch}'. Start by finding the merge diff between the current branch and ${branch}'s upstream e.g. (\`git merge-base HEAD "$(git rev-parse --abbrev-ref "${branch}@{upstream}")"\`), then run \`git diff\` against that SHA to see what changes we would merge into the ${branch} branch. Provide prioritized, actionable findings.`;

/**
 * Options for creating the reviewer prompt
 */
export interface ReviewerPromptOptions {
  /** The base prompt content (already loaded) */
  basePrompt: string;
  /** Path to the git repository */
  repoPath: string;
  /** Optional base branch to compare against (e.g., "main") */
  baseBranch?: string;
}

/**
 * Create the complete reviewer prompt.
 * Combines the base prompt with review type-specific instructions.
 *
 * @param options - The prompt generation options
 * @returns The complete reviewer prompt string
 */
export function createReviewerPrompt(options: ReviewerPromptOptions): string {
  const { basePrompt, repoPath, baseBranch } = options;

  let instruction: string;

  if (baseBranch) {
    const mergeBaseSha = mergeBaseWithHead(repoPath, baseBranch);
    instruction = mergeBaseSha
      ? BASE_BRANCH_INSTRUCTION(baseBranch, mergeBaseSha)
      : BASE_BRANCH_INSTRUCTION_BACKUP(baseBranch);
  } else {
    instruction = UNCOMMITTED_INSTRUCTION;
  }

  return `${basePrompt.trim()}\n\n${instruction}`;
}
