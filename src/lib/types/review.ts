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
