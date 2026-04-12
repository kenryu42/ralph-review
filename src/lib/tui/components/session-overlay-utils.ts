import type { LogSession } from "@/lib/logger";
import { formatRelativeTime } from "@/lib/tui/session-display-formatters";

export interface SessionOverlayOption {
  name: string;
  description: string;
  value: string;
}

export interface SessionOverlayOptions {
  selectOptions: SessionOverlayOption[];
  sessionSlots: Array<LogSession | null>;
}

export function buildSessionOverlayOptions(sessions: LogSession[]): SessionOverlayOptions {
  const grouped = new Map<string, LogSession[]>();
  for (const session of sessions) {
    const bucket = grouped.get(session.projectName) ?? [];
    bucket.push(session);
    grouped.set(session.projectName, bucket);
  }

  const selectOptions: SessionOverlayOption[] = [];
  const sessionSlots: Array<LogSession | null> = [];

  for (const projectSessions of grouped.values()) {
    for (const session of projectSessions) {
      const name = session.name.replace(/\.jsonl$/, "");
      selectOptions.push({
        name: `${name} (${formatRelativeTime(session.timestamp)})`,
        description: "",
        value: session.path,
      });
      sessionSlots.push(session);
    }
  }

  return { selectOptions, sessionSlots };
}

export type SessionOverlayKeyAction =
  | "none"
  | "toggle-help"
  | "open-delete-confirm"
  | "close-delete-confirm"
  | "confirm-delete"
  | "close-help"
  | "cycle-focus"
  | "close-overlay";

export function resolveSessionOverlayKeyAction({
  keyName,
  showHelp,
  showDeleteConfirm,
  hasSelectedSession,
}: {
  keyName: string;
  showHelp: boolean;
  showDeleteConfirm: boolean;
  hasSelectedSession: boolean;
}): SessionOverlayKeyAction {
  if (showDeleteConfirm) {
    if (keyName === "escape" || keyName === "n" || keyName === "q") {
      return "close-delete-confirm";
    }
    if (keyName === "y") {
      return "confirm-delete";
    }
    return "none";
  }

  if (keyName === "?" || keyName === "h") {
    return "toggle-help";
  }

  if (showHelp) {
    if (keyName === "escape" || keyName === "q") {
      return "close-help";
    }
    return "none";
  }

  if (keyName === "d") {
    return hasSelectedSession ? "open-delete-confirm" : "none";
  }

  if (keyName === "tab" || keyName === "left" || keyName === "right") {
    return "cycle-focus";
  }

  if (keyName === "escape" || keyName === "l" || keyName === "q") {
    return "close-overlay";
  }

  return "none";
}
