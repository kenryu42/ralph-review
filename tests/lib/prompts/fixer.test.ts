import { describe, expect, test } from "bun:test";
import { createFixerPrompt, FIX_SUMMARY_END_TOKEN, FIX_SUMMARY_START_TOKEN } from "@/lib/prompts";

describe("createFixerPrompt", () => {
  test("enforces conservative re-check for empty reviewer findings", () => {
    const prompt = createFixerPrompt('{"findings":[]}');

    expect(prompt).toContain("If reviewer findings are empty, do a");
    expect(prompt).toContain("conservative re-check only");
    expect(prompt).toContain("Output is binary in this path");
    expect(prompt).toContain("NO_CHANGES_NEEDED with fixes=[] and skipped=[]");
  });

  test("removes NEED_INFO decision path and keeps decision enum", () => {
    const prompt = createFixerPrompt("review payload");

    expect(prompt).not.toContain("NEED_INFO");
    expect(prompt).not.toContain("stop_iteration");
    expect(prompt).toContain("APPLY: <count or none>   SKIP: <count or none>");
    expect(prompt).toContain('"decision": "<NO_CHANGES_NEEDED | APPLY_SELECTIVELY | APPLY_MOST>"');
  });

  test("retains structured output delimiters for fix summary", () => {
    const prompt = createFixerPrompt("review payload");

    expect(prompt).toContain(FIX_SUMMARY_START_TOKEN);
    expect(prompt).toContain(FIX_SUMMARY_END_TOKEN);
  });

  test("includes code_location fields in fix JSON template", () => {
    const prompt = createFixerPrompt("review payload");

    expect(prompt).toContain('"code_location": {');
    expect(prompt).toContain('"absolute_file_path": "<absolute path>"');
    expect(prompt).toContain('"line_range": {');
    expect(prompt).toContain('"start": <int>');
    expect(prompt).toContain('"end": <int>');
  });

  test("requires code_location for fixes when available", () => {
    const prompt = createFixerPrompt("review payload");

    expect(prompt).toContain("For each APPLY item, include code_location when available");
    expect(prompt).toContain('"line_range": {');
  });
});
