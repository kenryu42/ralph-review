import { describe, expect, test } from "bun:test";
import {
  createFixerStructuredOutputInstructions,
  createFixerSummaryRetryReminder,
  createReviewerStructuredOutputInstructions,
  createReviewerSummaryRetryReminder,
  FIX_SUMMARY_END_TOKEN,
  FIX_SUMMARY_START_TOKEN,
  REVIEW_SUMMARY_END_TOKEN,
  REVIEW_SUMMARY_START_TOKEN,
} from "@/lib/prompts";

describe("prompt protocol builders", () => {
  test("builds reviewer structured output instructions with required delimiters", () => {
    const instructions = createReviewerStructuredOutputInstructions();

    expect(instructions).toContain("Structured output protocol (STRICT)");
    expect(instructions).toContain(REVIEW_SUMMARY_START_TOKEN);
    expect(instructions).toContain(REVIEW_SUMMARY_END_TOKEN);
    expect(instructions).toContain("Do not include markdown fences");
  });

  test("builds fixer structured output instructions with required delimiters", () => {
    const instructions = createFixerStructuredOutputInstructions();

    expect(instructions).toContain("Structured output protocol (STRICT)");
    expect(instructions).toContain(FIX_SUMMARY_START_TOKEN);
    expect(instructions).toContain(FIX_SUMMARY_END_TOKEN);
    expect(instructions).toContain("final output in the response");
  });

  test("builds reviewer retry reminder with strict JSON-only framing", () => {
    const reminder = createReviewerSummaryRetryReminder();

    expect(reminder).toContain("missing or invalid structured JSON output");
    expect(reminder).toContain("Return ONLY one schema-valid JSON object wrapped in");
    expect(reminder).toContain(REVIEW_SUMMARY_START_TOKEN);
    expect(reminder).toContain(REVIEW_SUMMARY_END_TOKEN);
  });

  test("builds fixer retry reminder with no-additional-edits instruction", () => {
    const reminder = createFixerSummaryRetryReminder();

    expect(reminder).toContain("missing or invalid structured JSON output");
    expect(reminder).toContain("Do not make additional file edits in this retry");
    expect(reminder).toContain(FIX_SUMMARY_START_TOKEN);
    expect(reminder).toContain(FIX_SUMMARY_END_TOKEN);
  });
});
