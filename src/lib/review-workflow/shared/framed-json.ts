import { removeTrailingCommas } from "@/lib/structured-output";

interface ParseFramedJsonOptions<T> {
  extractedText: string | null;
  rawOutput: string;
  startToken: string;
  endToken: string;
  validate: (value: unknown) => value is T;
}

function normalizeCandidate(candidate: string): string {
  return candidate.replace(/\r\n?/g, "\n").trim();
}

function extractFramedPayload(output: string, startToken: string, endToken: string): string | null {
  const normalized = normalizeCandidate(output);
  const startIndex = normalized.indexOf(startToken);
  if (startIndex < 0) {
    return null;
  }

  const payloadStart = startIndex + startToken.length;
  const endIndex = normalized.indexOf(endToken, payloadStart);
  if (endIndex < 0) {
    return null;
  }

  return normalized.slice(payloadStart, endIndex).trim();
}

function parseCandidate<T>(candidate: string, validate: (value: unknown) => value is T): T | null {
  const normalized = normalizeCandidate(candidate);

  for (const attempt of [normalized, removeTrailingCommas(normalized)]) {
    try {
      const parsed = JSON.parse(attempt) as unknown;
      if (validate(parsed)) {
        return parsed;
      }
    } catch {
      // Keep trying the next candidate.
    }
  }

  return null;
}

export function parseFramedJson<T>(options: ParseFramedJsonOptions<T>): T {
  const candidates = [
    options.extractedText
      ? extractFramedPayload(options.extractedText, options.startToken, options.endToken)
      : null,
    extractFramedPayload(options.rawOutput, options.startToken, options.endToken),
    options.extractedText,
    options.rawOutput,
  ];

  for (const candidate of candidates) {
    if (!candidate?.trim()) {
      continue;
    }

    const parsed = parseCandidate(candidate, options.validate);
    if (parsed) {
      return parsed;
    }
  }

  throw new Error("Structured JSON output was missing or invalid.");
}
