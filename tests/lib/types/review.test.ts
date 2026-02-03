import { describe, expect, test } from "bun:test";
import { parseCodexReviewText } from "@/lib/types";

describe("parseCodexReviewText", () => {
  test("parses codex review text into ReviewSummary", () => {
    const text = [
      "The new [r] hotkey can only be used once per dashboard process.",
      "",
      "Full review comments:",
      "",
      "- [P1] Allow rerunning after pressing [r] in the TUI \u2014 /Users/kenryu/Developer/420024-lab/ralph-review/src/lib/tui/components/Dashboard.tsx:71-74",
      "  In src/lib/tui/components/Dashboard.tsx the [r] hotkey sets isSpawningRunRef.current",
      "  and never resets it, so subsequent presses are ignored.",
      "",
      "- [P2] Avoid undrained stdout/stderr pipes from Bun.spawn in the TUI - /Users/kenryu/Developer/420024-lab/ralph-review/src/lib/tui/components/Dashboard.tsx:72-73",
      "  Bun.spawn defaults stdout/stderr to pipe, so large output can stall the child.",
    ].join("\n");

    const result = parseCodexReviewText(text);
    expect(result).not.toBeNull();
    expect(result?.findings).toHaveLength(2);

    const first = result?.findings[0];
    expect(first?.title).toBe("Allow rerunning after pressing [r] in the TUI");
    expect(first?.priority).toBe(1);
    expect(first?.code_location.absolute_file_path).toBe(
      "/Users/kenryu/Developer/420024-lab/ralph-review/src/lib/tui/components/Dashboard.tsx"
    );
    expect(first?.code_location.line_range.start).toBe(71);
    expect(first?.code_location.line_range.end).toBe(74);
    expect(first?.body).toBe(
      "In src/lib/tui/components/Dashboard.tsx the [r] hotkey sets isSpawningRunRef.current and never resets it, so subsequent presses are ignored."
    );

    expect(result?.overall_correctness).toBe("patch is incorrect");
    expect(result?.overall_explanation).toBe(
      "The new [r] hotkey can only be used once per dashboard process."
    );
    expect(result?.overall_confidence_score).toBe(0.69);
  });

  test("returns null when a header lacks a location", () => {
    const text = [
      "Summary line.",
      "",
      "Full review comments:",
      "",
      "- [P1] Missing location",
      "  Body text here.",
    ].join("\n");

    const result = parseCodexReviewText(text);
    expect(result).toBeNull();
  });

  test("returns a valid summary when only a summary is present", () => {
    const text = "No issues found.";
    const result = parseCodexReviewText(text);

    expect(result).not.toBeNull();
    expect(result?.findings).toHaveLength(0);
    expect(result?.overall_correctness).toBe("patch is correct");
    expect(result?.overall_explanation).toBe("No issues found.");
    expect(result?.overall_confidence_score).toBe(0.69);
  });
});
