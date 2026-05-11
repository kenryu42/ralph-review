import type { SessionEndEntry, SessionStatus } from "@/lib/types";

export function mapSessionStatusToFinalStatus(status: SessionStatus): SessionEndEntry["status"] {
  if (status === "failed") {
    return "failed";
  }

  if (status === "interrupted") {
    return "interrupted";
  }

  return "completed";
}
