/**
 * Fix-related types and guards
 */

import type { FixDecision, Priority } from "./domain";
import { VALID_FIX_DECISIONS, VALID_PRIORITIES } from "./domain";

/**
 * A single fix applied by the fixer
 */
export interface FixEntry {
  id: number;
  title: string;
  priority: Priority;
  file?: string | null;
  claim: string;
  evidence: string;
  fix: string;
}

/**
 * A review item that was skipped (not applied)
 */
export interface SkippedEntry {
  id: number;
  title: string;
  reason: string;
}

/**
 * Summary of fixes applied in an iteration
 */
export interface FixSummary {
  decision: FixDecision;
  fixes: FixEntry[];
  skipped: SkippedEntry[];
}

/**
 * Type guard to check if a value is a valid FixEntry
 */
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

/**
 * Type guard to check if a value is a valid SkippedEntry
 */
function isSkippedEntry(value: unknown): value is SkippedEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj.id === "number" && typeof obj.title === "string" && typeof obj.reason === "string"
  );
}

/**
 * Type guard to check if a value is a valid FixSummary
 */
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
