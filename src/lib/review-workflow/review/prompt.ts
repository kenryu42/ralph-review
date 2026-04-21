import { mergeBaseWithHead } from "@/lib/git";
import defaultReviewPromptContent from "@/lib/prompts/defaults/review.md" with { type: "text" };
import { createReviewerStructuredOutputInstructions } from "@/lib/prompts/protocol";
import type { StoredFinding } from "@/lib/review-workflow/findings/types";

const defaultReviewPrompt: string = defaultReviewPromptContent;

const UNCOMMITTED_PROMPT =
  "Review the uncommitted changes represented by this session snapshot. Run `git show --root HEAD` to inspect the reviewed patch, then provide prioritized findings.";

const BASE_BRANCH_PROMPT = (baseBranch: string, mergeBaseSha: string) =>
  `Review the code changes against the base branch '${baseBranch}'. The merge base commit for this comparison is ${mergeBaseSha}. Run \`git diff ${mergeBaseSha}\` to inspect the changes relative to ${baseBranch}. Provide prioritized, actionable findings.`;

/**
 * Fallback instruction when merge-base cannot be calculated
 */
const BASE_BRANCH_PROMPT_BACKUP = (branch: string) =>
  `Review the code changes against the base branch '${branch}'. Start by finding the merge diff between the current branch and ${branch}'s upstream e.g. (\`git merge-base HEAD "$(git rev-parse --abbrev-ref "${branch}@{upstream}")"\`), then run \`git diff\` against that SHA to see what changes we would merge into the ${branch} branch. Provide prioritized, actionable findings.`;

const COMMIT_PROMPT = (commitHash: string) =>
  `Review the code changes for the commit ${commitHash}. Provide prioritized, actionable findings.`;

const CUSTOM_FOCUS_PROMPT = (customInstructions: string) =>
  `Additional review focus from user instructions:\n${customInstructions}`;

function withCustomFocus(instruction: string, customInstructions?: string): string {
  if (!customInstructions) {
    return instruction;
  }
  return `${instruction}\n\n${CUSTOM_FOCUS_PROMPT(customInstructions)}`;
}

export interface TargetedReviewPromptOptions {
  repoPath: string;
  baseBranch?: string;
  commitSha?: string;
  customInstructions?: string;
}

export interface ReviewerPromptOptions {
  repoPath?: string;
  baselineCommitSha: string;
  includeDefaultReviewPrompt?: boolean;
  baseBranch?: string;
  commitSha?: string;
  customInstructions?: string;
  knownFindings?: StoredFinding[];
  iteration?: number;
}

function resolveReviewScopeInstruction(
  repoPath: string,
  baseBranch?: string,
  commitSha?: string
): string {
  if (commitSha) {
    return COMMIT_PROMPT(commitSha);
  }

  if (baseBranch) {
    const mergeBaseSha = mergeBaseWithHead(repoPath, baseBranch);
    return mergeBaseSha
      ? BASE_BRANCH_PROMPT(baseBranch, mergeBaseSha)
      : BASE_BRANCH_PROMPT_BACKUP(baseBranch);
  }

  return UNCOMMITTED_PROMPT;
}

function formatKnownFindings(knownFindings: StoredFinding[]): string {
  if (knownFindings.length === 0) {
    return "";
  }

  const lines = knownFindings.map((finding) => {
    return `- ${finding.id} [${finding.priority}] ${finding.filePath}:${finding.startLine}-${finding.endLine} ${finding.title}`;
  });

  return [
    "Known findings already captured in the review inventory. Do not repeat them unless you have a materially different issue that is not already covered.",
    ...lines,
  ].join("\n");
}

function buildReviewContext(options: ReviewerPromptOptions): string[] {
  const lines = [
    `Review the session worktree checked out at baseline commit \`${options.baselineCommitSha}\`.`,
    "Treat the baseline commit as immutable source-of-truth input for review.",
    "Report only net-new actionable findings that are not already present in the known-finding inventory.",
    'If there are no net-new actionable findings, return `"findings": []` with a valid overall summary instead of repeating earlier findings.',
  ];

  if (options.repoPath) {
    lines.push(
      resolveReviewScopeInstruction(options.repoPath, options.baseBranch, options.commitSha)
    );
  }

  if (typeof options.iteration === "number" && options.iteration > 1) {
    lines.push(`This is review pass ${options.iteration}.`);
  }

  if (options.baseBranch) {
    lines.push(
      `The snapshot is intended for review relative to base branch \`${options.baseBranch}\`.`
    );
  }

  if (options.commitSha) {
    lines.push(`The snapshot includes the changes from commit \`${options.commitSha}\`.`);
  }

  const knownFindingsSection = formatKnownFindings(options.knownFindings ?? []);
  if (knownFindingsSection) {
    lines.push(knownFindingsSection);
  }

  if (options.customInstructions) {
    lines.push(`Additional review focus from user instructions:\n${options.customInstructions}`);
  }

  return lines;
}

export function createReviewerPrompt(options: ReviewerPromptOptions): string {
  const reviewContext = buildReviewContext(options).join("\n\n");
  const prefix =
    options.includeDefaultReviewPrompt === false ? "" : `${defaultReviewPrompt.trim()}\n`;

  return `${prefix}${createReviewerStructuredOutputInstructions()}\n\n${reviewContext}`;
}

/** Target priority: commitSha > baseBranch > uncommitted (default), with custom focus overlay. */
export function createTargetedReviewPrompt(options: TargetedReviewPromptOptions): string {
  const { repoPath, baseBranch, commitSha, customInstructions } = options;
  const instruction = withCustomFocus(
    resolveReviewScopeInstruction(repoPath, baseBranch, commitSha),
    customInstructions
  );

  return `${defaultReviewPrompt.trim()}\n${createReviewerStructuredOutputInstructions()}\n\n${instruction}`;
}
