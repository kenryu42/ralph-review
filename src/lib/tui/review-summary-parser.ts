import { isReviewSummary, type ReviewSummary } from "@/lib/types";

interface JsonObjectSlice {
  start: number;
  end: number;
  value: string;
}

function extractBalancedJsonObjects(text: string): JsonObjectSlice[] {
  const results: JsonObjectSlice[] = [];
  let depth = 0;
  let startIndex = -1;
  let inString = false;
  let isEscaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }

      if (char === "\\") {
        isEscaped = true;
        continue;
      }

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

    if (char === "}") {
      if (depth === 0) {
        continue;
      }

      depth -= 1;
      if (depth === 0 && startIndex >= 0) {
        const endIndex = index + 1;
        results.push({
          start: startIndex,
          end: endIndex,
          value: text.slice(startIndex, endIndex),
        });
        startIndex = -1;
      }
    }
  }

  return results;
}

export function extractLatestReviewSummary(
  text: string,
  minIndex: number = 0
): ReviewSummary | null {
  if (!text.trim()) {
    return null;
  }

  const objects = extractBalancedJsonObjects(text);
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    const candidate = objects[index];
    if (!candidate) {
      continue;
    }

    if (candidate.start < minIndex) {
      continue;
    }

    try {
      const parsed: unknown = JSON.parse(candidate.value);
      if (isReviewSummary(parsed)) {
        return parsed;
      }
    } catch {
      // Ignore invalid JSON blocks in tmux output.
    }
  }

  return null;
}

export function findLatestReviewerPhaseStart(text: string): number {
  if (!text) {
    return -1;
  }

  const markers = ["Running reviewer...", "Fixes applied. Re-running reviewer..."];
  let latestIndex = -1;

  for (const marker of markers) {
    const index = text.lastIndexOf(marker);
    if (index > latestIndex) {
      latestIndex = index;
    }
  }

  return latestIndex;
}
