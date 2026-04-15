import { PRIORITY_COLORS, UNKNOWN_PRIORITY_COLOR } from "@/lib/tui/sessions/session-display";
import { TUI_COLORS } from "@/lib/tui/shared/colors";
import type { Priority } from "@/lib/types";
import { VALID_PRIORITIES } from "@/lib/types/domain";

export type PriorityTextValue = Priority | number | string | undefined;

export interface PriorityTextSegment {
  text: string;
  color: string;
}

export function formatPriorityToken(priority: PriorityTextValue): Priority | "P?" {
  if (typeof priority === "number") {
    if (priority >= 0 && priority <= 3) {
      return `P${priority}` as Priority;
    }
    return "P?";
  }

  if (typeof priority === "string" && VALID_PRIORITIES.includes(priority as Priority)) {
    return priority as Priority;
  }

  return "P?";
}

function priorityTokenColor(priority: Priority | "P?"): string {
  return priority === "P?" ? UNKNOWN_PRIORITY_COLOR : PRIORITY_COLORS[priority];
}

export function buildPriorityTextSegments(
  priority: PriorityTextValue,
  options: {
    bracketed?: boolean;
    bracketColor?: string;
  } = {}
): PriorityTextSegment[] {
  const token = formatPriorityToken(priority);
  const tokenSegment = {
    text: token,
    color: priorityTokenColor(token),
  };

  if (!options.bracketed) {
    return [tokenSegment];
  }

  const bracketColor = options.bracketColor ?? TUI_COLORS.text.dim;
  return [{ text: "[", color: bracketColor }, tokenSegment, { text: "]", color: bracketColor }];
}

export function PriorityText({
  priority,
  bracketed = false,
  bracketColor,
}: {
  priority: PriorityTextValue;
  bracketed?: boolean;
  bracketColor?: string;
}) {
  return buildPriorityTextSegments(priority, { bracketed, bracketColor }).map((segment) => (
    <span key={`${segment.text}-${segment.color}`} fg={segment.color}>
      {segment.text}
    </span>
  ));
}
