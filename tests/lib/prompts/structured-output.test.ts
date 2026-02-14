import { describe, expect, test } from "bun:test";
import {
  createFixerPrompt,
  createReviewerPrompt,
  FIX_SUMMARY_END_TOKEN,
  FIX_SUMMARY_START_TOKEN,
  REVIEW_SUMMARY_END_TOKEN,
  REVIEW_SUMMARY_START_TOKEN,
} from "@/lib/prompts";

describe("structured output prompts", () => {
  test("fixer prompt includes strict framed output tokens", () => {
    const prompt = createFixerPrompt("review payload");

    expect(prompt).toContain(FIX_SUMMARY_START_TOKEN);
    expect(prompt).toContain(FIX_SUMMARY_END_TOKEN);
    expect(prompt).toContain("Structured output protocol (STRICT)");
  });

  test("reviewer prompt includes strict framed output tokens", () => {
    const prompt = createReviewerPrompt({ repoPath: process.cwd() });

    expect(prompt).toContain(REVIEW_SUMMARY_START_TOKEN);
    expect(prompt).toContain(REVIEW_SUMMARY_END_TOKEN);
    expect(prompt).toContain("Structured output protocol (STRICT)");
  });
});
