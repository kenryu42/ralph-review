import type { DiagnosticItem, DiagnosticsReport } from "./types";

export function collectIssueItems(report: DiagnosticsReport): DiagnosticItem[] {
  return report.items.filter((item) => item.severity === "error" || item.severity === "warning");
}
