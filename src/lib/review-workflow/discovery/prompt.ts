import { mergeBaseWithHead } from "@/lib/git";
import defaultReviewPromptContent from "@/lib/prompts/defaults/review.md" with { type: "text" };
import { createReviewerStructuredOutputInstructions } from "@/lib/prompts/protocol";
import type { StoredFinding } from "@/lib/review-workflow/findings/types";

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

const CUSTOM_FOCUS_PROMPT = (customInstructions: string) =>
  `Additional review focus from user instructions:\n${customInstructions}`;

function withCustomFocus(instruction: string, customInstructions?: string): string {
  if (!customInstructions) {
    return instruction;
  }
  return `${instruction}\n\n${CUSTOM_FOCUS_PROMPT(customInstructions)}`;
}

export interface ReviewerPromptOptions {
  repoPath: string;
  baseBranch?: string;
  commitSha?: string;
  customInstructions?: string;
}

export interface DiscoveryReviewerPromptOptions {
  reviewedSnapshotPath: string;
  baseBranch?: string;
  commitSha?: string;
  customInstructions?: string;
  knownFindings?: StoredFinding[];
  iteration?: number;
}

function formatKnownFindings(knownFindings: StoredFinding[]): string {
  if (knownFindings.length === 0) {
    return "";
  }

  const lines = knownFindings.map((finding) => {
    return `- ${finding.id} [${finding.priority}] ${finding.filePath}:${finding.startLine}-${finding.endLine} ${finding.title}`;
  });

  return [
    "Known findings already captured in the discovery inventory. Do not repeat them unless you have a materially different issue that is not already covered.",
    ...lines,
  ].join("\n");
}

function buildDiscoveryContext(options: DiscoveryReviewerPromptOptions): string[] {
  const lines = [
    `Review the frozen snapshot at \`${options.reviewedSnapshotPath}\`.`,
    "Treat this snapshot as immutable read-only input for discovery.",
    "Report only net-new actionable findings that are not already present in the known-finding inventory.",
    'If there are no net-new actionable findings, return `"findings": []` with a valid overall summary instead of repeating earlier findings.',
  ];

  if (typeof options.iteration === "number" && options.iteration > 1) {
    lines.push(`This is discovery pass ${options.iteration}.`);
  }

  if (options.baseBranch) {
    lines.push(
      `The snapshot is intended for review relative to base branch \`${options.baseBranch}\`.`
    );
  }

  if (options.commitSha) {
    lines.push(`The snapshot includes the changes from commit \`${options.commitSha}\`.`);
  }

  if (options.customInstructions) {
    lines.push(`Additional review focus from user instructions:\n${options.customInstructions}`);
  }

  const knownFindingsSection = formatKnownFindings(options.knownFindings ?? []);
  if (knownFindingsSection) {
    lines.push(knownFindingsSection);
  }

  return lines;
}

export function createDiscoveryReviewerPrompt(options: DiscoveryReviewerPromptOptions): string {
  const discoveryContext = buildDiscoveryContext(options).join("\n\n");

  return `${defaultReviewPrompt.trim()}\n${createReviewerStructuredOutputInstructions()}\n\n${discoveryContext}`;
}

/** Target priority: commitSha > baseBranch > uncommitted (default), with custom focus overlay. */
export function createReviewerPrompt(options: ReviewerPromptOptions): string {
  const { repoPath, baseBranch, commitSha, customInstructions } = options;

  let instruction: string;

  if (commitSha) {
    instruction = withCustomFocus(COMMIT_PROMPT(commitSha), customInstructions);
  } else if (baseBranch) {
    const mergeBaseSha = mergeBaseWithHead(repoPath, baseBranch);
    const baseInstruction = mergeBaseSha
      ? BASE_BRANCH_PROMPT(baseBranch, mergeBaseSha)
      : BASE_BRANCH_PROMPT_BACKUP(baseBranch);
    instruction = withCustomFocus(baseInstruction, customInstructions);
  } else if (customInstructions) {
    instruction = customInstructions;
  } else {
    instruction = UNCOMMITTED_PROMPT;
  }

  return `${defaultReviewPrompt.trim()}\n${createReviewerStructuredOutputInstructions()}\n\n${instruction}`;
}
