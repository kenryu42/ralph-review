export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  return value as Record<string, unknown>;
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function asRecordWithStringField(value: unknown, field: string): Record<string, unknown> | null {
  const obj = asRecord(value);
  if (obj === null || typeof obj[field] !== "string") {
    return null;
  }

  return obj;
}

export function isLineRange(
  value: unknown,
  options: { requirePositive?: boolean } = {}
): value is { start: number; end: number } {
  const obj = asRecord(value);
  if (obj === null || !isInteger(obj.start) || !isInteger(obj.end)) {
    return false;
  }

  if (options.requirePositive && (obj.start <= 0 || obj.end < obj.start)) {
    return false;
  }

  return true;
}

export function isCodeLocation(value: unknown): value is {
  absolute_file_path: string;
  line_range: { start: number; end: number };
} {
  const obj = asRecordWithStringField(value, "absolute_file_path");
  return obj !== null && isLineRange(obj.line_range);
}
