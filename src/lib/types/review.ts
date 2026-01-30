/**
 * Review-related types and guards
 */

import type { OverallCorrectness } from "./domain";
import { VALID_OVERALL_CORRECTNESS } from "./domain";

/**
 * Line range within a file
 */
interface LineRange {
  start: number;
  end: number;
}

/**
 * Location of code in a file
 */
interface CodeLocation {
  absolute_file_path: string;
  line_range: LineRange;
}

/**
 * A single finding from a review
 */
export interface Finding {
  title: string;
  body: string;
  confidence_score: number;
  priority?: number;
  code_location: CodeLocation;
}

/**
 * Summary of a code review
 */
export interface ReviewSummary {
  findings: Finding[];
  overall_correctness: OverallCorrectness;
  overall_explanation: string;
  overall_confidence_score: number;
}

/**
 * Review summary from Codex agent (plain text format)
 */
export interface CodexReviewSummary {
  text: string;
}

/**
 * Type guard to check if a value is a valid LineRange
 */
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

/**
 * Type guard to check if a value is a valid CodeLocation
 */
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

/**
 * Type guard to check if a value is a valid Finding
 */
function isFinding(value: unknown): value is Finding {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  // Check required string fields
  if (typeof obj.title !== "string" || typeof obj.body !== "string") {
    return false;
  }

  // Check confidence_score
  if (
    typeof obj.confidence_score !== "number" ||
    obj.confidence_score < 0 ||
    obj.confidence_score > 1
  ) {
    return false;
  }

  // Check optional priority (0-3)
  if (
    obj.priority !== undefined &&
    (typeof obj.priority !== "number" || obj.priority < 0 || obj.priority > 3)
  ) {
    return false;
  }

  // Check code_location
  if (!isCodeLocation(obj.code_location)) {
    return false;
  }

  return true;
}

/**
 * Type guard to check if a value is a valid ReviewSummary
 */
export function isReviewSummary(value: unknown): value is ReviewSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  // Check findings array
  if (!Array.isArray(obj.findings)) {
    return false;
  }

  // Validate each finding
  for (const finding of obj.findings) {
    if (!isFinding(finding)) {
      return false;
    }
  }

  // Check overall_correctness
  if (
    typeof obj.overall_correctness !== "string" ||
    !VALID_OVERALL_CORRECTNESS.includes(obj.overall_correctness as OverallCorrectness)
  ) {
    return false;
  }

  // Check overall_explanation
  if (typeof obj.overall_explanation !== "string") {
    return false;
  }

  // Check overall_confidence_score
  if (
    typeof obj.overall_confidence_score !== "number" ||
    obj.overall_confidence_score < 0 ||
    obj.overall_confidence_score > 1
  ) {
    return false;
  }

  return true;
}
