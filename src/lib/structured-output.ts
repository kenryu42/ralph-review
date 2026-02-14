import {
  FIX_SUMMARY_END_TOKEN,
  FIX_SUMMARY_START_TOKEN,
  REVIEW_SUMMARY_END_TOKEN,
  REVIEW_SUMMARY_START_TOKEN,
} from "@/lib/prompts/protocol";
import type { FixSummary, ReviewSummary } from "@/lib/types";
import { isFixSummary, isReviewSummary } from "@/lib/types";

export type StructuredOutputSource =
  | "framed-extracted"
  | "framed-raw"
  | "legacy-fenced"
  | "legacy-direct"
  | "legacy-balanced";

interface StructuredParseSuccess<T> {
  ok: true;
  value: T;
  source: StructuredOutputSource;
  usedRepair: boolean;
  failureReason: null;
}

interface StructuredParseFailure {
  ok: false;
  value: null;
  source: null;
  usedRepair: boolean;
  failureReason: string;
}

export type StructuredParseResult<T> = StructuredParseSuccess<T> | StructuredParseFailure;

interface ParseAttempt {
  source: StructuredOutputSource;
  payload: string;
}

interface RepairedCandidate {
  payload: string;
  changed: boolean;
}

function normalizeCandidateText(candidate: string): string {
  return candidate
    .replace(/^\uFEFF/, "")
    .replace(/[\u200B-\u200D\u2060]/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

function normalizeSmartQuotes(candidate: string): string {
  return candidate
    .replace(/[\u201C\u201D\u201E\u201F\u00AB\u00BB]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'");
}

function unwrapJsonCodeFence(candidate: string): string {
  const match = candidate.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  if (!match?.[1]) {
    return candidate;
  }
  return match[1].trim();
}

export function extractJsonBlock(output: string): string | null {
  const match = output.match(/```json\s*\n([\s\S]*?)\n```/i);
  if (!match?.[1]) {
    return null;
  }
  return match[1].trim();
}

function extractBalancedJsonObjects(text: string): string[] {
  const objects: string[] = [];
  let depth = 0;
  let startIndex = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (inString) {
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        startIndex = index;
      }
      depth += 1;
      continue;
    }

    if (char !== "}") {
      continue;
    }

    if (depth === 0) {
      continue;
    }

    depth -= 1;
    if (depth === 0 && startIndex >= 0) {
      objects.push(text.slice(startIndex, index + 1));
      startIndex = -1;
    }
  }

  return objects;
}

function isolateJsonObject(candidate: string): string {
  const objects = extractBalancedJsonObjects(candidate);
  if (objects.length === 0) {
    return candidate;
  }

  const lastObject = objects[objects.length - 1];
  return lastObject?.trim() || candidate;
}

function removeTrailingCommas(candidate: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < candidate.length; index++) {
    const char = candidate[index];

    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      output += char;
      escaped = true;
      continue;
    }

    if (char === '"') {
      output += char;
      inString = !inString;
      continue;
    }

    if (inString || char !== ",") {
      output += char;
      continue;
    }

    let lookahead = index + 1;
    while (lookahead < candidate.length && /\s/.test(candidate[lookahead] ?? "")) {
      lookahead += 1;
    }

    const nextChar = candidate[lookahead];
    if (nextChar === "}" || nextChar === "]") {
      continue;
    }

    output += char;
  }

  return output;
}

function repairJsonCandidate(candidate: string): RepairedCandidate {
  const normalized = normalizeCandidateText(candidate);
  const unwrapped = unwrapJsonCodeFence(normalized);
  const normalizedQuotes = normalizeSmartQuotes(unwrapped);
  const isolated = isolateJsonObject(normalizedQuotes);
  const withoutTrailingCommas = removeTrailingCommas(isolated);

  const repaired = withoutTrailingCommas.trim();
  return {
    payload: repaired,
    changed: repaired !== candidate.trim(),
  };
}

function parseJsonWithGuard<T>(candidate: string, guard: (value: unknown) => value is T): T | null {
  try {
    const parsed: unknown = JSON.parse(candidate);
    return guard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractFramedPayload(output: string, startToken: string, endToken: string): string | null {
  const start = output.indexOf(startToken);
  if (start < 0) {
    return null;
  }

  const from = start + startToken.length;
  const end = output.indexOf(endToken, from);
  if (end < 0) {
    return null;
  }

  return output.slice(from, end).trim();
}

function buildAttempts(
  extractedText: string | null,
  rawOutput: string,
  startToken: string,
  endToken: string
): ParseAttempt[] {
  const extractedCandidate = extractedText?.trim() ? extractedText.trim() : null;
  const rawCandidate = rawOutput.trim() ? rawOutput.trim() : null;
  const attempts: ParseAttempt[] = [];
  const seen = new Set<string>();

  const addAttempt = (source: StructuredOutputSource, payload: string | null) => {
    if (!payload?.trim()) {
      return;
    }

    const trimmed = payload.trim();
    const key = `${source}:${trimmed}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    attempts.push({ source, payload: trimmed });
  };

  addAttempt(
    "framed-extracted",
    extractedCandidate ? extractFramedPayload(extractedCandidate, startToken, endToken) : null
  );
  addAttempt(
    "framed-raw",
    rawCandidate ? extractFramedPayload(rawCandidate, startToken, endToken) : null
  );

  for (const candidate of [extractedCandidate, rawCandidate]) {
    if (!candidate) {
      continue;
    }
    addAttempt("legacy-fenced", extractJsonBlock(candidate));
  }

  for (const candidate of [extractedCandidate, rawCandidate]) {
    if (!candidate) {
      continue;
    }
    addAttempt("legacy-direct", candidate);
  }

  for (const candidate of [extractedCandidate, rawCandidate]) {
    if (!candidate) {
      continue;
    }
    const objects = extractBalancedJsonObjects(candidate);
    for (let index = objects.length - 1; index >= 0; index--) {
      addAttempt("legacy-balanced", objects[index] ?? null);
    }
  }

  return attempts;
}

function parseStructuredOutput<T>(
  extractedText: string | null,
  rawOutput: string,
  tokens: { start: string; end: string },
  guard: (value: unknown) => value is T
): StructuredParseResult<T> {
  const attempts = buildAttempts(extractedText, rawOutput, tokens.start, tokens.end);
  let repairAttempted = false;

  for (const attempt of attempts) {
    const strictParsed = parseJsonWithGuard(attempt.payload, guard);
    if (strictParsed) {
      return {
        ok: true,
        value: strictParsed,
        source: attempt.source,
        usedRepair: false,
        failureReason: null,
      };
    }

    const repaired = repairJsonCandidate(attempt.payload);
    if (!repaired.changed) {
      continue;
    }

    repairAttempted = true;
    const repairedParsed = parseJsonWithGuard(repaired.payload, guard);
    if (repairedParsed) {
      return {
        ok: true,
        value: repairedParsed,
        source: attempt.source,
        usedRepair: true,
        failureReason: null,
      };
    }
  }

  return {
    ok: false,
    value: null,
    source: null,
    usedRepair: repairAttempted,
    failureReason:
      attempts.length === 0
        ? "no output candidates available for parsing"
        : "no structured output candidate matched the required schema",
  };
}

export function parseReviewSummaryOutput(
  extractedText: string | null,
  rawOutput: string
): StructuredParseResult<ReviewSummary> {
  return parseStructuredOutput(
    extractedText,
    rawOutput,
    {
      start: REVIEW_SUMMARY_START_TOKEN,
      end: REVIEW_SUMMARY_END_TOKEN,
    },
    isReviewSummary
  );
}

export function parseFixSummaryOutput(
  extractedText: string | null,
  rawOutput: string
): StructuredParseResult<FixSummary> {
  return parseStructuredOutput(
    extractedText,
    rawOutput,
    {
      start: FIX_SUMMARY_START_TOKEN,
      end: FIX_SUMMARY_END_TOKEN,
    },
    isFixSummary
  );
}

export function parseFixSummaryCandidate(candidate: string): StructuredParseResult<FixSummary> {
  return parseFixSummaryOutput(candidate, candidate);
}

export function parseReviewSummaryCandidate(
  candidate: string
): StructuredParseResult<ReviewSummary> {
  return parseReviewSummaryOutput(candidate, candidate);
}
