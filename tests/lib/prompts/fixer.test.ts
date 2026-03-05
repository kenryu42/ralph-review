import { describe, expect, test } from "bun:test";
import { createFixerPrompt, FIX_SUMMARY_END_TOKEN, FIX_SUMMARY_START_TOKEN } from "@/lib/prompts";

describe("createFixerPrompt", () => {
  test("enforces explicit re-check for empty reviewer findings", () => {
    const prompt = createFixerPrompt('{"findings":[]}');

    expect(prompt).toContain("If reviewer findings are empty, you MUST still run");
    expect(prompt).toContain("Output is binary in this path");
    expect(prompt).toContain("NO_CHANGES_NEEDED with fixes=[] and skipped=[]");
  });

  test("removes NEED_INFO decision path and keeps decision enum", () => {
    const prompt = createFixerPrompt("review payload");

    expect(prompt).not.toContain("NEED_INFO");
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
    expect(prompt).toContain('"line_range": {"start": <int>, "end": <int>}');
  });

  test("requires applied line ranges for fixes when available", () => {
    const prompt = createFixerPrompt("review payload");

    expect(prompt).toContain(
      "For each APPLY item, include the applied code location when available"
    );
    expect(prompt).toContain("line range");
  });
});
