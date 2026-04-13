import {
  createStoredFindingSeed,
  findDuplicateByFallback,
  type StoredFindingSeed,
} from "@/lib/review-workflow/findings/dedupe";
import type { FindingId, StoredFinding } from "@/lib/review-workflow/findings/types";
import type { Finding } from "@/lib/types";

interface MergeFindingsIntoInventoryOptions {
  repoPath: string;
}

export interface MergeFindingsIntoInventoryResult {
  findings: StoredFinding[];
  newFindings: StoredFinding[];
}

function parseFindingIdNumber(findingId: FindingId): number {
  const match = /^F(\d+)$/u.exec(findingId);
  if (!match) {
    return 0;
  }

  const value = Number.parseInt(match[1] ?? "0", 10);
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }

  return value;
}

function createFindingId(sequence: number): FindingId {
  const normalizedSequence = Math.max(1, Math.trunc(sequence));
  return `F${String(normalizedSequence).padStart(3, "0")}`;
}

function nextFindingSequence(existingFindings: StoredFinding[]): number {
  let highest = 0;

  for (const finding of existingFindings) {
    highest = Math.max(highest, parseFindingIdNumber(finding.id));
  }

  return highest + 1;
}

function createStoredFinding(id: FindingId, seed: StoredFindingSeed): StoredFinding {
  return {
    id,
    fingerprint: seed.fingerprint,
    locationKey: seed.locationKey,
    title: seed.title,
    body: seed.body,
    priority: seed.priority,
    confidenceScore: seed.confidenceScore,
    filePath: seed.filePath,
    startLine: seed.startLine,
    endLine: seed.endLine,
  };
}

export function mergeFindingsIntoInventory(
  existingFindings: StoredFinding[],
  rawFindings: Finding[],
  options: MergeFindingsIntoInventoryOptions
): MergeFindingsIntoInventoryResult {
  const findings = [...existingFindings];
  const newFindings: StoredFinding[] = [];
  const findingByFingerprint = new Map<string, StoredFinding>();

  for (const finding of findings) {
    findingByFingerprint.set(finding.fingerprint, finding);
  }

  let sequence = nextFindingSequence(findings);

  for (const rawFinding of rawFindings) {
    const seed = createStoredFindingSeed(rawFinding, {
      repoPath: options.repoPath,
    });

    const directDuplicate = findingByFingerprint.get(seed.fingerprint);
    if (directDuplicate) {
      continue;
    }

    const fallbackDuplicate = findDuplicateByFallback(findings, seed);
    if (fallbackDuplicate) {
      findingByFingerprint.set(seed.fingerprint, fallbackDuplicate);
      continue;
    }

    const id = createFindingId(sequence);
    sequence += 1;

    const storedFinding = createStoredFinding(id, seed);
    findings.push(storedFinding);
    newFindings.push(storedFinding);
    findingByFingerprint.set(storedFinding.fingerprint, storedFinding);
  }

  return {
    findings,
    newFindings,
  };
}
