import type { FixEntry, FixSummary, SkippedEntry } from "@/lib/types";
import type { FixDecision } from "@/lib/types/domain";

interface FixSummaryOverrides {
  decision?: FixDecision;
  stop_iteration?: boolean;
  fixes?: FixEntry[];
  skipped?: SkippedEntry[];
}

export function buildFixSummary(overrides: FixSummaryOverrides = {}): FixSummary {
  return {
    decision: overrides.decision ?? "APPLY_SELECTIVELY",
    stop_iteration: overrides.stop_iteration ?? false,
    fixes: overrides.fixes ?? [],
    skipped: overrides.skipped ?? [],
  };
}

interface FixEntryOverrides {
  id?: number;
  title?: string;
  priority?: FixEntry["priority"];
  file?: FixEntry["file"];
  claim?: string;
  evidence?: string;
  fix?: string;
}

export function buildFixEntry(overrides: FixEntryOverrides = {}): FixEntry {
  return {
    id: overrides.id ?? 1,
    title: overrides.title ?? "Fix title",
    priority: overrides.priority ?? "P1",
    file: overrides.file ?? "src/file.ts",
    claim: overrides.claim ?? "Test claim",
    evidence: overrides.evidence ?? "Test evidence",
    fix: overrides.fix ?? "Test fix",
  };
}

interface SkippedEntryOverrides {
  id?: number;
  title?: string;
  priority?: SkippedEntry["priority"];
  reason?: string;
}

export function buildSkippedEntry(overrides: SkippedEntryOverrides = {}): SkippedEntry {
  return {
    id: overrides.id ?? 1,
    title: overrides.title ?? "Skipped title",
    priority: overrides.priority ?? "P2",
    reason: overrides.reason ?? "SKIP: Test reason",
  };
}
