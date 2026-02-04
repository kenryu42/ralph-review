import type { FixDecision, Priority } from "./domain";
import { VALID_FIX_DECISIONS, VALID_PRIORITIES } from "./domain";

export interface FixEntry {
  id: number;
  title: string;
  priority: Priority;
  file?: string | null;
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
