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

function removeTrailingCommas(candidate: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < candidate.length; index += 1) {
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
    while (lookahead < candidate.length && /\s/u.test(candidate[lookahead] ?? "")) {
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
