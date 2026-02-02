import { mergeBaseWithHead } from "@/lib/git";
import defaultReviewPromptContent from "./defaults/review.md" with { type: "text" };

const defaultReviewPrompt: string = defaultReviewPromptContent;

const UNCOMMITTED_PROMPT =
  "Review the current code changes (staged, unstaged, and untracked files) and provide prioritized findings.";

const BASE_BRANCH_PROMPT = (baseBranch: string, mergeBaseSha: string) =>
  `Review the code changes against the base branch '${baseBranch}'. The merge base commit for this comparison is ${mergeBaseSha}. Run \`git diff ${mergeBaseSha}\` to inspect the changes relative to ${baseBranch}. Provide prioritized, actionable findings.`;

/**
 * Fallback instruction when merge-base cannot be calculated
 */
const BASE_BRANCH_PROMPT_BACKUP = (branch: string) =>
  `Review the code changes against the base branch '${branch}'. Start by finding the merge diff between the current branch and ${branch}'s upstream e.g. (\`git merge-base HEAD "$(git rev-parse --abbrev-ref "${branch}@{upstream}")"\`), then run \`git diff\` against that SHA to see what changes we would merge into the ${branch} branch. Provide prioritized, actionable findings.`;

const COMMIT_PROMPT = (commitHash: string) =>
  `Review the code changes for the commit ${commitHash}. Provide prioritized, actionable findings.`;

export interface ReviewerPromptOptions {
  repoPath: string;
  baseBranch?: string;
  commitSha?: string;
  customInstructions?: string;
}

/** Priority: commitSha > baseBranch > customInstructions > uncommitted (default) */
export function createReviewerPrompt(options: ReviewerPromptOptions): string {
  const { repoPath, baseBranch, commitSha, customInstructions } = options;

  let instruction: string;

  if (commitSha) {
    instruction = COMMIT_PROMPT(commitSha);
  } else if (baseBranch) {
    const mergeBaseSha = mergeBaseWithHead(repoPath, baseBranch);
    instruction = mergeBaseSha
      ? BASE_BRANCH_PROMPT(baseBranch, mergeBaseSha)
      : BASE_BRANCH_PROMPT_BACKUP(baseBranch);
  } else if (customInstructions) {
    instruction = customInstructions;
  } else {
    instruction = UNCOMMITTED_PROMPT;
  }

  return `${defaultReviewPrompt.trim()}\n\n${instruction}`;
}
