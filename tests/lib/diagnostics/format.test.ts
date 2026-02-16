import { describe, expect, test } from "bun:test";
import { collectIssueItems } from "@/lib/diagnostics";
import type { DiagnosticItem, DiagnosticsReport } from "@/lib/diagnostics/types";
import { createCapabilities, createConfig } from "../../helpers/diagnostics";

function makeItem(
  id: string,
  severity: "ok" | "warning" | "error",
  summary = `Summary for ${id}`
): DiagnosticItem {
  return {
    id,
    category: "config",
    title: id,
    severity,
    summary,
    remediation: [],
  };
}

function makeReport(items: DiagnosticItem[]): DiagnosticsReport {
  return {
    context: "run",
    items,
    hasErrors: items.some((item) => item.severity === "error"),
    hasWarnings: items.some((item) => item.severity === "warning"),
    capabilitiesByAgent: createCapabilities(),
    generatedAt: "2026-02-16T00:00:00.000Z",
    config: createConfig(),
  };
}

describe("diagnostics format", () => {
  test("returns only warning and error items", () => {
    const report = makeReport([
      makeItem("config-ok", "ok"),
      makeItem("config-warning", "warning"),
      makeItem("config-error", "error"),
      makeItem("agent-ok", "ok"),
    ]);

    const issues = collectIssueItems(report);

    expect(issues.map((item) => item.id)).toEqual(["config-warning", "config-error"]);
  });

  test("returns an empty list when all diagnostics are ok", () => {
    const report = makeReport([makeItem("git-ok", "ok"), makeItem("tmux-ok", "ok")]);

    const issues = collectIssueItems(report);

    expect(issues).toEqual([]);
  });

  test("preserves original order among included severities", () => {
    const report = makeReport([
      makeItem("warning-first", "warning"),
      makeItem("error-second", "error"),
      makeItem("warning-third", "warning"),
    ]);

    const issues = collectIssueItems(report);

    expect(issues.map((item) => item.id)).toEqual([
      "warning-first",
      "error-second",
      "warning-third",
    ]);
  });
});
