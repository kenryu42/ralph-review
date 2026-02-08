import { mergeBaseWithHead } from "@/lib/git";
import defaultCodeSimplifierPromptContent from "./defaults/code-simplifier.md" with {
  type: "text",
};

const defaultCodeSimplifierPrompt: string = defaultCodeSimplifierPromptContent;

const UNCOMMITTED_PROMPT =
  "Simplify the current code changes (staged, unstaged, and untracked files) while preserving exact behavior and outputs.";

const BASE_BRANCH_PROMPT = (baseBranch: string, mergeBaseSha: string) =>
  `Simplify the code changes against the base branch '${baseBranch}'. The merge base commit for this comparison is ${mergeBaseSha}. Run \`git diff ${mergeBaseSha}\` to inspect the changes relative to ${baseBranch}, then simplify only those changes while preserving exact behavior.`;

const BASE_BRANCH_PROMPT_BACKUP = (branch: string) =>
  `Simplify the code changes against the base branch '${branch}'. Start by finding the merge diff between the current branch and ${branch}'s upstream e.g. (\`git merge-base HEAD "$(git rev-parse --abbrev-ref "${branch}@{upstream}")"\`), then run \`git diff\` against that SHA. Simplify only those changes and preserve exact behavior.`;

const COMMIT_PROMPT = (commitHash: string) =>
  `Simplify the code changes introduced by commit ${commitHash} while preserving exact functionality.`;

export interface CodeSimplifierPromptOptions {
  repoPath: string;
  baseBranch?: string;
  commitSha?: string;
  customInstructions?: string;
}

/** Priority: commitSha > baseBranch > customInstructions > uncommitted (default) */
export function createCodeSimplifierPrompt(options: CodeSimplifierPromptOptions): string {
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

  return `${defaultCodeSimplifierPrompt.trim()}\n\n${instruction}`;
}
