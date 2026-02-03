import type { OverallCorrectness } from "./domain";
import { VALID_OVERALL_CORRECTNESS } from "./domain";

interface LineRange {
  start: number;
  end: number;
}

interface CodeLocation {
  absolute_file_path: string;
  line_range: LineRange;
}

export interface Finding {
  title: string;
  body: string;
  confidence_score: number;
  priority?: number;
  code_location: CodeLocation;
}

export interface ReviewSummary {
  findings: Finding[];
  overall_correctness: OverallCorrectness;
  overall_explanation: string;
  overall_confidence_score: number;
}

export interface CodexReviewSummary {
  text: string;
}

const DEFAULT_CODEX_CONFIDENCE = 0.69;

function isLineRange(value: unknown): value is LineRange {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj.start === "number" &&
    Number.isInteger(obj.start) &&
    typeof obj.end === "number" &&
    Number.isInteger(obj.end)
  );
}

function isCodeLocation(value: unknown): value is CodeLocation {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  if (typeof obj.absolute_file_path !== "string") {
    return false;
  }

  if (!isLineRange(obj.line_range)) {
    return false;
  }

  return true;
}

function isFinding(value: unknown): value is Finding {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  if (typeof obj.title !== "string" || typeof obj.body !== "string") {
    return false;
  }

  if (
    typeof obj.confidence_score !== "number" ||
    obj.confidence_score < 0 ||
    obj.confidence_score > 1
  ) {
    return false;
  }

  if (
    obj.priority !== undefined &&
    (typeof obj.priority !== "number" || obj.priority < 0 || obj.priority > 3)
  ) {
    return false;
  }

  if (!isCodeLocation(obj.code_location)) {
    return false;
  }

  return true;
}

export function isReviewSummary(value: unknown): value is ReviewSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  if (!Array.isArray(obj.findings)) {
    return false;
  }

  for (const finding of obj.findings) {
    if (!isFinding(finding)) {
      return false;
    }
  }

  if (
    typeof obj.overall_correctness !== "string" ||
    !VALID_OVERALL_CORRECTNESS.includes(obj.overall_correctness as OverallCorrectness)
  ) {
    return false;
  }

  if (typeof obj.overall_explanation !== "string") {
    return false;
  }

  if (
    typeof obj.overall_confidence_score !== "number" ||
    obj.overall_confidence_score < 0 ||
    obj.overall_confidence_score > 1
  ) {
    return false;
  }

  return true;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isHeaderCandidate(line: string): boolean {
  return /^\s*-\s*\[P[0-3]\]/.test(line);
}

function parseHeaderLine(line: string): {
  priority: number;
  title: string;
  absolute_file_path: string;
  line_start: number;
  line_end: number;
} | null {
  const headerPattern =
    /^\s*-\s*\[P([0-3])\]\s*(.*)\s(?:\u2014|\u2013|-)\s(.+?):(\d+)(?:-(\d+))?\s*$/;
  const match = line.match(headerPattern);
  if (!match) {
    return null;
  }

  const priority = Number.parseInt(match[1] ?? "", 10);
  const rawTitle = (match[2] ?? "").trim();
  const absolute_file_path = (match[3] ?? "").trim();
  const lineStart = Number.parseInt(match[4] ?? "", 10);
  const lineEnd = Number.parseInt(match[5] ?? match[4] ?? "", 10);

  if (
    Number.isNaN(priority) ||
    rawTitle.length === 0 ||
    absolute_file_path.length === 0 ||
    Number.isNaN(lineStart) ||
    Number.isNaN(lineEnd)
  ) {
    return null;
  }

  if (lineEnd < lineStart) {
    return null;
  }

  return {
    priority,
    title: rawTitle,
    absolute_file_path,
    line_start: lineStart,
    line_end: lineEnd,
  };
}

function collectBodyLines(lines: string[]): string {
  const body = lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ");
  return body;
}

export function parseCodexReviewText(text: string): ReviewSummary | null {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return null;
  }

  const lines = normalized.split("\n");
  const markerIndex = lines.findIndex(
    (line) => line.trim().toLowerCase() === "full review comments:"
  );

  let summaryLines: string[] = [];
  let commentLines: string[] = [];

  if (markerIndex >= 0) {
    summaryLines = lines.slice(0, markerIndex);
    commentLines = lines.slice(markerIndex + 1);
  } else {
    const firstHeaderIndex = lines.findIndex((line) => isHeaderCandidate(line));
    if (firstHeaderIndex >= 0) {
      summaryLines = lines.slice(0, firstHeaderIndex);
      commentLines = lines.slice(firstHeaderIndex);
    } else {
      summaryLines = lines;
      commentLines = [];
    }
  }

  const summaryText = normalizeWhitespace(summaryLines.join(" "));
  const commentNonEmpty = commentLines.filter((line) => line.trim().length > 0);
  const hasHeaderCandidates = commentLines.some((line) => isHeaderCandidate(line));

  if (markerIndex >= 0 && commentNonEmpty.length > 0 && !hasHeaderCandidates) {
    const single = commentNonEmpty.join(" ").trim();
    if (single.toLowerCase() !== "none") {
      return null;
    }
  }

  const findings: Finding[] = [];

  if (hasHeaderCandidates) {
    let idx = 0;
    while (idx < commentLines.length) {
      const line = commentLines[idx] ?? "";
      if (!isHeaderCandidate(line)) {
        idx += 1;
        continue;
      }

      const header = parseHeaderLine(line);
      if (!header) {
        return null;
      }

      const bodyLines: string[] = [];
      idx += 1;
      while (idx < commentLines.length && !isHeaderCandidate(commentLines[idx] ?? "")) {
        bodyLines.push(commentLines[idx] ?? "");
        idx += 1;
      }

      const body = collectBodyLines(bodyLines);

      findings.push({
        title: header.title,
        body,
        confidence_score: DEFAULT_CODEX_CONFIDENCE,
        priority: header.priority,
        code_location: {
          absolute_file_path: header.absolute_file_path,
          line_range: {
            start: header.line_start,
            end: header.line_end,
          },
        },
      });
    }
  }

  const overallCorrectness = findings.length > 0 ? "patch is incorrect" : "patch is correct";
  const fallbackExplanation =
    findings.length > 0 ? "Issues were found during review." : "No issues found.";
  const overallExplanation = summaryText || fallbackExplanation;
  const overallConfidenceScore =
    findings.length > 0
      ? findings.reduce((sum, finding) => sum + finding.confidence_score, 0) / findings.length
      : DEFAULT_CODEX_CONFIDENCE;

  const summary: ReviewSummary = {
    findings,
    overall_correctness: overallCorrectness,
    overall_explanation: overallExplanation,
    overall_confidence_score: overallConfidenceScore,
  };

  return summary;
}
