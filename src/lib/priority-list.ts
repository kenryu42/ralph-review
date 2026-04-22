import { type Priority, VALID_PRIORITIES } from "@/lib/types/domain";

const REPEATED_PRIORITY_FLAG_ERROR = "Use a single --priority flag with comma-separated values.";

export function getRepeatedPriorityFlagError(): string {
  return REPEATED_PRIORITY_FLAG_ERROR;
}

export function parsePriorityList(value: string): Priority[] {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error("Priority list cannot be empty");
  }

  const requested = normalized.split(",");
  const seen = new Set<Priority>();
  const priorities: Priority[] = [];

  for (const entry of requested) {
    const token = entry.trim();
    if (token.length === 0) {
      throw new Error("Priority list cannot contain empty values");
    }

    const priority = token.toUpperCase();
    if (!VALID_PRIORITIES.includes(priority as Priority)) {
      throw new Error(`Invalid priority: ${token}`);
    }

    if (seen.has(priority as Priority)) {
      continue;
    }

    seen.add(priority as Priority);
    priorities.push(priority as Priority);
  }

  return VALID_PRIORITIES.filter((priority) => priorities.includes(priority));
}

export function formatPriorityList(priorities: Priority[]): string {
  return VALID_PRIORITIES.filter((priority) => priorities.includes(priority)).join(",");
}
