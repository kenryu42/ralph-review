import type { HandoffStatus } from "@/lib/types";

interface HandoffNoteOptions {
  handoffStatus?: HandoffStatus;
  commitSha?: string;
  applyCommand?: string;
  discardCommand?: string;
}

export function formatHandoffNote(options: HandoffNoteOptions): string | null {
  const commitLine = options.commitSha ? `Commit: ${options.commitSha}` : null;

  if (options.handoffStatus === "applied-auto") {
    return ["Applied reviewed fixes to the working tree.", commitLine].filter(Boolean).join("\n");
  }

  if (options.handoffStatus === "pending-apply") {
    return [
      "Reviewed fixes are ready to apply.",
      commitLine,
      options.applyCommand,
      options.discardCommand,
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (options.handoffStatus === "apply-conflicted") {
    return [
      "Reviewed fixes hit conflicts during apply.",
      commitLine,
      "Resolve or abort the Git conflict. Ralph will reconcile the handoff automatically on a later command.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return null;
}
