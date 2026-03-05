import type { FixDecision, Priority } from "./domain";
import { VALID_FIX_DECISIONS, VALID_PRIORITIES } from "./domain";
import type { CodeLocation } from "./review";

export interface FixEntry {
  id: number;
  title: string;
  priority: Priority;
  file?: string | null;
  code_location?: CodeLocation | null;
  claim: string;
  evidence: string;
  fix: string;
}

export interface SkippedEntry {
  id: number;
  title: string;
  priority: Priority;
  reason: string;
}

export interface FixSummary {
  decision: FixDecision;
  stop_iteration?: boolean;
  fixes: FixEntry[];
  skipped: SkippedEntry[];
}

function isLineRange(value: unknown): value is CodeLocation["line_range"] {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj.start === "number" &&
    Number.isInteger(obj.start) &&
    obj.start > 0 &&
    typeof obj.end === "number" &&
    Number.isInteger(obj.end) &&
    obj.end >= obj.start
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

  return isLineRange(obj.line_range);
}

function isFixEntry(value: unknown): value is FixEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj.id === "number" &&
    typeof obj.title === "string" &&
    typeof obj.priority === "string" &&
    VALID_PRIORITIES.includes(obj.priority as Priority) &&
    (obj.file === undefined || obj.file === null || typeof obj.file === "string") &&
    (obj.code_location === undefined ||
      obj.code_location === null ||
      isCodeLocation(obj.code_location)) &&
    typeof obj.claim === "string" &&
    typeof obj.evidence === "string" &&
    typeof obj.fix === "string"
  );
}

function isSkippedEntry(value: unknown): value is SkippedEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj.id === "number" &&
    typeof obj.title === "string" &&
    typeof obj.priority === "string" &&
    VALID_PRIORITIES.includes(obj.priority as Priority) &&
    typeof obj.reason === "string"
  );
}

export function isFixSummary(value: unknown): value is FixSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  // Check decision field
  if (
    typeof obj.decision !== "string" ||
    !VALID_FIX_DECISIONS.includes(obj.decision as FixDecision)
  ) {
    return false;
  }

  if (obj.stop_iteration !== undefined && typeof obj.stop_iteration !== "boolean") {
    return false;
  }

  // Check fixes array
  if (!Array.isArray(obj.fixes)) {
    return false;
  }

  // Check skipped array
  if (!Array.isArray(obj.skipped)) {
    return false;
  }

  // Validate each fix entry
  for (const fix of obj.fixes) {
    if (!isFixEntry(fix)) {
      return false;
    }
  }

  // Validate each skipped entry
  for (const skipped of obj.skipped) {
    if (!isSkippedEntry(skipped)) {
      return false;
    }
  }

  return true;
}
