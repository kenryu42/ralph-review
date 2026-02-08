import { describe, expect, test } from "bun:test";
import { createCodeSimplifierPrompt } from "@/lib/prompts";

describe("createCodeSimplifierPrompt", () => {
  test("includes default simplifier prompt content", () => {
    const prompt = createCodeSimplifierPrompt({ repoPath: process.cwd() });
    expect(prompt).toContain("You are an expert code simplification specialist");
  });

  test("uses custom instructions when provided", () => {
    const prompt = createCodeSimplifierPrompt({
      repoPath: process.cwd(),
      customInstructions: "Only simplify src/lib/logger.ts",
    });
    expect(prompt).toContain("Only simplify src/lib/logger.ts");
  });

  test("prioritizes commit over base and custom instructions", () => {
    const prompt = createCodeSimplifierPrompt({
      repoPath: process.cwd(),
      commitSha: "abc1234",
      baseBranch: "main",
      customInstructions: "custom simplify instructions",
    });
    expect(prompt).toContain("commit abc1234");
    expect(prompt).not.toContain("custom simplify instructions");
  });

  test("prioritizes base branch over custom instructions", () => {
    const prompt = createCodeSimplifierPrompt({
      repoPath: process.cwd(),
      baseBranch: "main",
      customInstructions: "custom simplify instructions",
    });
    expect(prompt).toContain("base branch 'main'");
    expect(prompt).not.toContain("custom simplify instructions");
  });

  test("defaults to uncommitted simplification instructions", () => {
    const prompt = createCodeSimplifierPrompt({ repoPath: process.cwd() });
    expect(prompt).toContain("staged, unstaged, and untracked files");
  });
});
