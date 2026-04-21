import { describe, expect, test } from "bun:test";
import {
  createReviewerPrompt,
  createTargetedReviewPrompt,
  REVIEW_SUMMARY_END_TOKEN,
  REVIEW_SUMMARY_START_TOKEN,
} from "@/lib/prompts";
import type { StoredFinding } from "@/lib/review-workflow/findings/types";

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

describe("createTargetedReviewPrompt", () => {
  test("combines commit instructions with custom focus when both are provided", () => {
    const prompt = createTargetedReviewPrompt({
      repoPath: REPO_PATH,
      commitSha: "abc1234",
      baseBranch: resolveCurrentRef(REPO_PATH),
      customInstructions: "custom reviewer instructions",
    });

    expect(prompt).toContain("Review the code changes for the commit abc1234");
    expect(prompt).toContain("custom reviewer instructions");
    expect(prompt).not.toContain("Review the code changes against the base branch");
    expectStructuredOutputProtocol(prompt);
  });

  test("combines merge-base base branch instructions with custom focus", () => {
    const prompt = createTargetedReviewPrompt({
      repoPath: REPO_PATH,
      baseBranch: resolveCurrentRef(REPO_PATH),
      customInstructions: "custom reviewer instructions",
    });

    expect(prompt).toContain("The merge base commit for this comparison is");
    expect(prompt).toContain("Run `git diff");
    expect(prompt).toContain("Provide prioritized, actionable findings.");
    expect(prompt).toContain("custom reviewer instructions");
    expect(prompt).not.toContain("Start by finding the merge diff between the current branch");
    expectStructuredOutputProtocol(prompt);
  });

  test("falls back to merge-base review instructions when base branch cannot be resolved", () => {
    const prompt = createTargetedReviewPrompt({
      repoPath: REPO_PATH,
      baseBranch: "__rr_missing_branch_for_review_prompt_tests__",
    });

    expect(prompt).toContain("Start by finding the merge diff between the current branch");
    expect(prompt).toContain("Provide prioritized, actionable findings.");
    expectStructuredOutputProtocol(prompt);
  });

  test("appends custom instructions after uncommitted review guidance", () => {
    const prompt = createTargetedReviewPrompt({
      repoPath: REPO_PATH,
      customInstructions: "Only review src/lib/logger.ts for regressions",
    });

    const uncommittedInstruction = "staged, unstaged, and untracked files";
    const customInstruction = "Additional review focus from user instructions";

    expect(prompt).toContain(uncommittedInstruction);
    expect(prompt).toContain("Only review src/lib/logger.ts for regressions");
    expect(prompt.indexOf(uncommittedInstruction)).toBeLessThan(prompt.indexOf(customInstruction));
    expectStructuredOutputProtocol(prompt);
  });

  test("defaults to uncommitted review instructions", () => {
    const prompt = createTargetedReviewPrompt({ repoPath: REPO_PATH });

    expect(prompt).toContain("staged, unstaged, and untracked files");
    expect(prompt).not.toContain("Ignore untracked files.");
    expectStructuredOutputProtocol(prompt);
  });
});

describe("createReviewerPrompt", () => {
  test("omits default review guidelines when requested", () => {
    const prompt = createReviewerPrompt({
      repoPath: REPO_PATH,
      baselineCommitSha: "baseline-sha-123",
      includeDefaultReviewPrompt: false,
    });

    expect(prompt).not.toContain("# Review guidelines:");
    expect(prompt).toContain("staged, unstaged, and untracked files");
    expect(prompt).toContain("Git ignores");
    expectStructuredOutputProtocol(prompt);
  });

  test("includes uncommitted review guidance when no explicit git target is provided", () => {
    const prompt = createReviewerPrompt({
      repoPath: REPO_PATH,
      baselineCommitSha: "baseline-sha-123",
    });

    expect(prompt).toContain("staged, unstaged, and untracked files");
    expect(prompt).toContain("baseline-sha-123");
    expect(prompt).toContain("unless Git ignores them");
    expectStructuredOutputProtocol(prompt);
  });

  test("includes base-branch review guidance when a base branch is provided", () => {
    const prompt = createReviewerPrompt({
      repoPath: REPO_PATH,
      baselineCommitSha: "baseline-sha-123",
      baseBranch: resolveCurrentRef(REPO_PATH),
    });

    expect(prompt).toContain("Run `git diff");
    expect(prompt).toContain("The merge base commit for this comparison is");
    expectStructuredOutputProtocol(prompt);
  });

  test("includes known findings inventory and requests only net-new findings on later passes", () => {
    const knownFindings: StoredFinding[] = [
      {
        id: "F001",
        fingerprint: "fp-1",
        locationKey: "src/lib/config.ts:10:12",
        title: "Guard undefined config",
        body: "Optional config access can throw when the field is missing.",
        priority: "P1",
        confidenceScore: 0.91,
        filePath: "src/lib/config.ts",
        startLine: 10,
        endLine: 12,
      },
    ];

    const prompt = createReviewerPrompt({
      repoPath: REPO_PATH,
      baselineCommitSha: "baseline-sha-123",
      customInstructions: "Focus on runtime failures.",
      knownFindings,
      iteration: 2,
    });

    expect(prompt).toContain("baseline-sha-123");
    expect(prompt).toContain("Focus on runtime failures.");
    expect(prompt).toContain("Known findings already captured");
    expect(prompt).toContain("F001");
    expect(prompt).toContain("Guard undefined config");
    expect(prompt).toContain("Report only net-new actionable findings");
    expect(prompt).toContain('return `"findings": []`');
    expect(prompt.indexOf("Known findings already captured")).toBeLessThan(
      prompt.indexOf("Additional review focus from user instructions")
    );
    expectStructuredOutputProtocol(prompt);
  });
});
