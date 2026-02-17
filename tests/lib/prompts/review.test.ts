import { describe, expect, test } from "bun:test";
import {
  createReviewerPrompt,
  REVIEW_SUMMARY_END_TOKEN,
  REVIEW_SUMMARY_START_TOKEN,
} from "@/lib/prompts";

const REPO_PATH = process.cwd();

function resolveCurrentRef(repoPath: string): string {
  const result = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repoPath,
    stdout: "pipe",
    stderr: "pipe",
  });

  const ref = result.stdout.toString().trim();
  return result.exitCode === 0 && ref.length > 0 ? ref : "HEAD";
}

function expectStructuredOutputProtocol(prompt: string): void {
  expect(prompt).toContain("Structured output protocol (STRICT)");
  expect(prompt).toContain(REVIEW_SUMMARY_START_TOKEN);
  expect(prompt).toContain(REVIEW_SUMMARY_END_TOKEN);
}

describe("createReviewerPrompt", () => {
  test("prioritizes commit over base branch and custom instructions", () => {
    const prompt = createReviewerPrompt({
      repoPath: REPO_PATH,
      commitSha: "abc1234",
      baseBranch: resolveCurrentRef(REPO_PATH),
      customInstructions: "custom reviewer instructions",
    });

    expect(prompt).toContain("Review the code changes for the commit abc1234");
    expect(prompt).not.toContain("custom reviewer instructions");
    expectStructuredOutputProtocol(prompt);
  });

  test("uses merge-base base branch instructions when merge base resolves", () => {
    const prompt = createReviewerPrompt({
      repoPath: REPO_PATH,
      baseBranch: resolveCurrentRef(REPO_PATH),
      customInstructions: "custom reviewer instructions",
    });

    expect(prompt).toContain("The merge base commit for this comparison is");
    expect(prompt).toContain("Run `git diff");
    expect(prompt).toContain("Provide prioritized, actionable findings.");
    expect(prompt).not.toContain("custom reviewer instructions");
    expect(prompt).not.toContain("Start by finding the merge diff between the current branch");
    expectStructuredOutputProtocol(prompt);
  });

  test("falls back to merge-base discovery instructions when base branch cannot be resolved", () => {
    const prompt = createReviewerPrompt({
      repoPath: REPO_PATH,
      baseBranch: "__rr_missing_branch_for_review_prompt_tests__",
    });

    expect(prompt).toContain("Start by finding the merge diff between the current branch");
    expect(prompt).toContain("Provide prioritized, actionable findings.");
    expectStructuredOutputProtocol(prompt);
  });

  test("uses custom instructions when no commit or base branch is provided", () => {
    const prompt = createReviewerPrompt({
      repoPath: REPO_PATH,
      customInstructions: "Only review src/lib/logger.ts for regressions",
    });

    expect(prompt).toContain("Only review src/lib/logger.ts for regressions");
    expectStructuredOutputProtocol(prompt);
  });

  test("defaults to uncommitted review instructions", () => {
    const prompt = createReviewerPrompt({ repoPath: REPO_PATH });

    expect(prompt).toContain("staged, unstaged, and untracked files");
    expectStructuredOutputProtocol(prompt);
  });
});
