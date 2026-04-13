import { join } from "node:path";
import type { FindingFingerprint, StoredFinding } from "@/lib/review-workflow/findings/types";
import type { Finding, Priority } from "@/lib/types";

interface NormalizeFindingOptions {
  repoPath: string;
}

export interface StoredFindingSeed {
  fingerprint: FindingFingerprint;
  locationKey: string;
  title: string;
  body: string;
  priority: Priority;
  confidenceScore: number;
  filePath: string;
  startLine: number;
  endLine: number;
}

function normalizePathSeparators(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function trimLeadingCurrentDir(value: string): string {
  return value.replace(/^\.\//, "");
}

function trimLeadingSlashes(value: string): string {
  return value.replace(/^\/+/g, "");
}

function normalizeRepoRelativePath(absoluteFilePath: string, repoPath: string): string {
  const normalizedFilePath = normalizePathSeparators(absoluteFilePath).trim();
  const normalizedRepoPath = normalizePathSeparators(repoPath).replace(/\/+$/g, "").trim();

  if (normalizedRepoPath.length > 0) {
    const withTrailingSlash = `${normalizedRepoPath}/`;
    if (normalizedFilePath.startsWith(withTrailingSlash)) {
      return trimLeadingCurrentDir(normalizedFilePath.slice(withTrailingSlash.length));
    }

    if (normalizedFilePath === normalizedRepoPath) {
      return "";
    }

    const pathJoined = normalizePathSeparators(join(normalizedRepoPath, normalizedFilePath));
    if (pathJoined.startsWith(withTrailingSlash)) {
      return trimLeadingCurrentDir(pathJoined.slice(withTrailingSlash.length));
    }
  }

  return trimLeadingCurrentDir(trimLeadingSlashes(normalizedFilePath));
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeTextForFingerprint(value: string): string {
  return normalizeText(value).toLowerCase();
}

function normalizeBodySummary(value: string): string {
  const normalized = normalizeTextForFingerprint(value);
  return normalized.length > 280 ? normalized.slice(0, 280) : normalized;
}

function normalizeLineNumber(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  const integer = Math.max(1, Math.trunc(value));
  return integer;
}

function normalizeLineRange(
  startLine: number,
  endLine: number
): { startLine: number; endLine: number } {
  const normalizedStartLine = normalizeLineNumber(startLine);
  const normalizedEndLine = normalizeLineNumber(endLine);

  if (normalizedEndLine < normalizedStartLine) {
    return {
      startLine: normalizedStartLine,
      endLine: normalizedStartLine,
    };
  }

  return {
    startLine: normalizedStartLine,
    endLine: normalizedEndLine,
  };
}

function normalizePriority(value: number | undefined): Priority {
  if (value === 0) {
    return "P0";
  }

  if (value === 1) {
    return "P1";
  }

  if (value === 3) {
    return "P3";
  }

  return "P2";
}

function normalizeConfidenceScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return value;
}

function buildFingerprint(seed: {
  filePath: string;
  startLine: number;
  endLine: number;
  normalizedTitle: string;
  normalizedBodySummary: string;
}): FindingFingerprint {
  const payload = [
    "finding-v1",
    seed.filePath,
    String(seed.startLine),
    String(seed.endLine),
    seed.normalizedTitle,
    seed.normalizedBodySummary,
  ].join("|");

  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(payload);
  return hasher.digest("hex");
}

export function createStoredFindingSeed(
  finding: Finding,
  options: NormalizeFindingOptions
): StoredFindingSeed {
  const filePath = normalizeRepoRelativePath(
    finding.code_location.absolute_file_path,
    options.repoPath
  );
  const lineRange = normalizeLineRange(
    finding.code_location.line_range.start,
    finding.code_location.line_range.end
  );
  const normalizedTitle = normalizeTextForFingerprint(finding.title);
  const normalizedBodySummary = normalizeBodySummary(finding.body);

  return {
    fingerprint: buildFingerprint({
      filePath,
      startLine: lineRange.startLine,
      endLine: lineRange.endLine,
      normalizedTitle,
      normalizedBodySummary,
    }),
    locationKey: `${filePath}:${lineRange.startLine}:${lineRange.endLine}`,
    title: normalizeText(finding.title),
    body: normalizeText(finding.body),
    priority: normalizePriority(finding.priority),
    confidenceScore: normalizeConfidenceScore(finding.confidence_score),
    filePath,
    startLine: lineRange.startLine,
    endLine: lineRange.endLine,
  };
}

function normalizeStoredFindingTitle(value: string): string {
  return normalizeTextForFingerprint(value);
}

function toLocationFallbackKey(seed: StoredFindingSeed): string {
  return `${seed.locationKey}|${normalizeStoredFindingTitle(seed.title)}`;
}

function toStoredFindingLocationFallbackKey(storedFinding: StoredFinding): string {
  const locationKey =
    storedFinding.locationKey ??
    `${storedFinding.filePath}:${storedFinding.startLine}:${storedFinding.endLine}`;
  return `${locationKey}|${normalizeStoredFindingTitle(storedFinding.title)}`;
}

export function findDuplicateByFallback(
  existingFindings: StoredFinding[],
  seed: StoredFindingSeed
): StoredFinding | null {
  const candidateKey = toLocationFallbackKey(seed);

  for (const finding of existingFindings) {
    if (toStoredFindingLocationFallbackKey(finding) === candidateKey) {
      return finding;
    }
  }

  return null;
}
