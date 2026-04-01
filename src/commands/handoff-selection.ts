import * as p from "@clack/prompts";
import type { PendingHandoffArtifact } from "@/lib/handoff";

type HandoffAction = "apply" | "discard";

interface ResolvePendingHandoffSelectionOptions {
  handoffs: PendingHandoffArtifact[];
  selector?: string;
  action: HandoffAction;
  isTTY: boolean;
  select?: (input: {
    message: string;
    options: Array<{ value: string; label: string; hint: string }>;
  }) => Promise<unknown>;
  isCancel?: (value: unknown) => boolean;
}

interface PendingHandoffSelectionResult {
  handoff: PendingHandoffArtifact | null;
  error?: string;
}

function findPendingHandoffBySelector(
  handoffs: PendingHandoffArtifact[],
  selector: string
): PendingHandoffSelectionResult {
  const normalizedSelector = selector.trim();
  if (normalizedSelector.length === 0) {
    return { handoff: null, error: "Session selector cannot be empty." };
  }

  const exactMatches = handoffs.filter((handoff) => handoff.sessionId === normalizedSelector);
  if (exactMatches.length === 1) {
    return { handoff: exactMatches[0] ?? null };
  }

  const prefixMatches = handoffs.filter((handoff) =>
    handoff.sessionId.startsWith(normalizedSelector)
  );
  if (prefixMatches.length === 1) {
    return { handoff: prefixMatches[0] ?? null };
  }

  if (prefixMatches.length > 1) {
    return {
      handoff: null,
      error: `Session selector "${normalizedSelector}" is ambiguous for the current project.`,
    };
  }

  return {
    handoff: null,
    error: `No pending review handoff matches "${normalizedSelector}" in the current project.`,
  };
}

function buildPromptMessage(action: HandoffAction): string {
  return action === "apply"
    ? "Choose a review handoff to apply"
    : "Choose a review handoff to discard";
}

export async function resolvePendingHandoffSelection(
  options: ResolvePendingHandoffSelectionOptions
): Promise<PendingHandoffSelectionResult> {
  if (options.selector) {
    return findPendingHandoffBySelector(options.handoffs, options.selector);
  }

  if (options.handoffs.length <= 1) {
    return { handoff: options.handoffs[0] ?? null };
  }

  if (!options.isTTY) {
    return {
      handoff: null,
      error:
        "Multiple pending review handoffs exist for this project. Re-run with --session <id|name>.",
    };
  }

  const select = options.select ?? ((input) => p.select(input));
  const isCancel = options.isCancel ?? p.isCancel;
  const selection = await select({
    message: buildPromptMessage(options.action),
    options: options.handoffs.map((handoff) => ({
      value: handoff.sessionId,
      label: handoff.sessionId,
      hint: handoff.commitSha.slice(0, 8),
    })),
  });

  if (isCancel(selection)) {
    return { handoff: null };
  }

  return {
    handoff: options.handoffs.find((handoff) => handoff.sessionId === selection) ?? null,
  };
}
