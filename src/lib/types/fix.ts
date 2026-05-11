import type { FixDecision, Priority } from "./domain";
import { VALID_FIX_DECISIONS, VALID_PRIORITIES } from "./domain";
import { asRecord, isCodeLocation, isLineRange } from "./guards";
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
  fixes: FixEntry[];
  skipped: SkippedEntry[];
}

function hasFixEntryHeader(obj: Record<string, unknown>): boolean {
  return (
    typeof obj.id === "number" &&
    typeof obj.title === "string" &&
    typeof obj.priority === "string" &&
    VALID_PRIORITIES.includes(obj.priority as Priority)
  );
}

function isFixEntry(value: unknown): value is FixEntry {
  const obj = asRecord(value);
  if (obj === null) {
    return false;
  }

  return (
    hasFixEntryHeader(obj) &&
    (obj.file === undefined || obj.file === null || typeof obj.file === "string") &&
    (obj.code_location === undefined ||
      obj.code_location === null ||
      (isCodeLocation(obj.code_location) &&
        isLineRange(obj.code_location.line_range, { requirePositive: true }))) &&
    typeof obj.claim === "string" &&
    typeof obj.evidence === "string" &&
    typeof obj.fix === "string"
  );
}

function isSkippedEntry(value: unknown): value is SkippedEntry {
  const obj = asRecord(value);
  if (obj === null) {
    return false;
  }

  return hasFixEntryHeader(obj) && typeof obj.reason === "string";
}

export function isFixSummary(value: unknown): value is FixSummary {
  const obj = asRecord(value);
  if (obj === null) {
    return false;
  }

  // Check decision field
  if (
    typeof obj.decision !== "string" ||
    !VALID_FIX_DECISIONS.includes(obj.decision as FixDecision)
  ) {
    return false;
  }

  if (obj.stop_iteration !== undefined) {
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
