import { describe, expect, test } from "bun:test";
import { createCodeSimplifierPrompt } from "@/lib/prompts";

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

describe("createCodeSimplifierPrompt", () => {
  test("includes default simplifier prompt content", () => {
    const prompt = createCodeSimplifierPrompt({ repoPath: REPO_PATH });
    expect(prompt).toContain("You are an expert code simplification specialist");
  });

  test("uses custom instructions when provided", () => {
    const prompt = createCodeSimplifierPrompt({
      repoPath: REPO_PATH,
      customInstructions: "Only simplify src/lib/logger.ts",
    });
    expect(prompt).toContain("Only simplify src/lib/logger.ts");
  });

  test("prioritizes commit over base and custom instructions", () => {
    const prompt = createCodeSimplifierPrompt({
      repoPath: REPO_PATH,
      commitSha: "abc1234",
      baseBranch: resolveCurrentRef(REPO_PATH),
      customInstructions: "custom simplify instructions",
    });
    expect(prompt).toContain("commit abc1234");
    expect(prompt).not.toContain("custom simplify instructions");
  });

  test("uses merge-base base branch instructions when merge base resolves", () => {
    const prompt = createCodeSimplifierPrompt({
      repoPath: REPO_PATH,
      baseBranch: resolveCurrentRef(REPO_PATH),
      customInstructions: "custom simplify instructions",
    });

    expect(prompt).toContain("The merge base commit for this comparison is");
    expect(prompt).toContain("Run `git diff");
    expect(prompt).not.toContain("custom simplify instructions");
    expect(prompt).not.toContain("Start by finding the merge diff between the current branch");
  });

  test("falls back to merge-base discovery instructions when base branch cannot be resolved", () => {
    const prompt = createCodeSimplifierPrompt({
      repoPath: REPO_PATH,
      baseBranch: "__rr_missing_branch_for_simplifier_prompt_tests__",
    });

    expect(prompt).toContain("Start by finding the merge diff between the current branch");
    expect(prompt).toContain("Simplify only those changes and preserve exact behavior.");
  });

  test("defaults to uncommitted simplification instructions", () => {
    const prompt = createCodeSimplifierPrompt({ repoPath: REPO_PATH });
    expect(prompt).toContain("staged, unstaged, and untracked files");
  });
});
