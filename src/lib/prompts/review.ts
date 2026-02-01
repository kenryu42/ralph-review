/**
 * Reviewer prompt generation for ralph-review
 * Combines a base prompt with review type-specific instructions
 */

import { mergeBaseWithHead } from "@/lib/git";
import defaultReviewPromptContent from "./defaults/review.md" with { type: "text" };

const defaultReviewPrompt: string = defaultReviewPromptContent;

/** Instruction for reviewing working directory changes (staged, unstaged, untracked) */
const UNCOMMITTED_PROMPT =
  "Review the current code changes (staged, unstaged, and untracked files) and provide prioritized findings.";

/** Instruction for reviewing commits since merge-base with a base branch */
const BASE_BRANCH_PROMPT = (baseBranch: string, mergeBaseSha: string) =>
  `Review the code changes against the base branch '${baseBranch}'. The merge base commit for this comparison is ${mergeBaseSha}. Run \`git diff ${mergeBaseSha}\` to inspect the changes relative to ${baseBranch}. Provide prioritized, actionable findings.`;

/**
 * Fallback instruction when merge-base cannot be calculated
 */
const BASE_BRANCH_PROMPT_BACKUP = (branch: string) =>
  `Review the code changes against the base branch '${branch}'. Start by finding the merge diff between the current branch and ${branch}'s upstream e.g. (\`git merge-base HEAD "$(git rev-parse --abbrev-ref "${branch}@{upstream}")"\`), then run \`git diff\` against that SHA to see what changes we would merge into the ${branch} branch. Provide prioritized, actionable findings.`;

/**
 * Instruction for reviewing a specific commit
 */
const COMMIT_PROMPT = (commitHash: string) =>
  `Review the code changes for the commit ${commitHash}. Provide prioritized, actionable findings.`;

/**
 * Options for creating the reviewer prompt
 */
export interface ReviewerPromptOptions {
  /** Path to the git repository */
  repoPath: string;
  /** Optional base branch to compare against (e.g., "main") */
  baseBranch?: string;
  /** Optional commit SHA to review */
  commitSha?: string;
  /** Optional custom review instructions */
  customInstructions?: string;
}

/**
 * Create the complete reviewer prompt.
 * Combines the base prompt with review type-specific instructions based on review mode.
 *
 * Priority order: commitSha > baseBranch > customInstructions > uncommitted (default)
 */
export function createReviewerPrompt(options: ReviewerPromptOptions): string {
  const { repoPath, baseBranch, commitSha, customInstructions } = options;

  let instruction: string;

  if (commitSha) {
    // Commit mode takes highest precedence
    instruction = COMMIT_PROMPT(commitSha);
  } else if (baseBranch) {
    const mergeBaseSha = mergeBaseWithHead(repoPath, baseBranch);
    instruction = mergeBaseSha
      ? BASE_BRANCH_PROMPT(baseBranch, mergeBaseSha)
      : BASE_BRANCH_PROMPT_BACKUP(baseBranch);
  } else if (customInstructions) {
    // Custom instructions mode - prepend base review target so agent knows what to review
    instruction = customInstructions;
  } else {
    instruction = UNCOMMITTED_PROMPT;
  }

  return `${defaultReviewPrompt.trim()}\n\n${instruction}`;
}
