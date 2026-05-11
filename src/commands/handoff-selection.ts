import * as p from "@clack/prompts";
import type { PendingHandoffArtifact } from "@/lib/handoff";

type HandoffAction = "apply" | "discard";
type HandoffSelect = (input: {
  message: string;
  options: Array<{ value: string; label: string; hint: string }>;
}) => Promise<unknown>;

interface SelectableHandoff {
  handoffId: string;
  sessionId: string;
  commitSha: string;
}

interface ResolvePendingHandoffSelectionOptions {
  handoffs: PendingHandoffArtifact[];
  selector?: string;
  action: HandoffAction;
  isTTY: boolean;
  select?: HandoffSelect;
  isCancel?: (value: unknown) => boolean;
}

interface HandoffSelectionResult<T extends SelectableHandoff> {
  handoff: T | null;
  error?: string;
}

function findHandoffBySelector<T extends SelectableHandoff>(
  handoffs: T[],
  selector: string
): HandoffSelectionResult<T> {
  const normalizedSelector = selector.trim();
  if (normalizedSelector.length === 0) {
    return { handoff: null, error: "Session selector cannot be empty." };
  }

  const exactHandoffMatches = handoffs.filter(
    (handoff) => handoff.handoffId === normalizedSelector
  );
  if (exactHandoffMatches.length === 1) {
    return { handoff: exactHandoffMatches[0] ?? null };
  }

  const handoffPrefixMatches = handoffs.filter((handoff) =>
    handoff.handoffId.startsWith(normalizedSelector)
  );
  if (handoffPrefixMatches.length === 1) {
    return { handoff: handoffPrefixMatches[0] ?? null };
  }

  if (handoffPrefixMatches.length > 1) {
    return {
      handoff: null,
      error: `Session selector "${normalizedSelector}" is ambiguous for the current project.`,
    };
  }

  const exactSessionMatches = handoffs.filter(
    (handoff) => handoff.sessionId === normalizedSelector
  );
  if (exactSessionMatches.length === 1) {
    return { handoff: exactSessionMatches[0] ?? null };
  }

  if (exactSessionMatches.length > 1) {
    return {
      handoff: null,
      error: `Session selector "${normalizedSelector}" is ambiguous for the current project.`,
    };
  }

  const sessionPrefixMatches = handoffs.filter((handoff) =>
    handoff.sessionId.startsWith(normalizedSelector)
  );
  if (sessionPrefixMatches.length === 1) {
    return { handoff: sessionPrefixMatches[0] ?? null };
  }

  if (sessionPrefixMatches.length > 1) {
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
  switch (action) {
    case "apply":
      return "Choose a review handoff to apply";
    case "discard":
      return "Choose a review handoff to discard";
  }
}

async function resolveHandoffSelection<T extends SelectableHandoff>(options: {
  handoffs: T[];
  selector?: string;
  action: HandoffAction;
  isTTY: boolean;
  multipleHandoffsMessage: string;
  select?: HandoffSelect;
  isCancel?: (value: unknown) => boolean;
}): Promise<HandoffSelectionResult<T>> {
  if (options.selector) {
    return findHandoffBySelector(options.handoffs, options.selector);
  }

  if (options.handoffs.length <= 1) {
    return { handoff: options.handoffs[0] ?? null };
  }

  if (!options.isTTY) {
    return {
      handoff: null,
      error: options.multipleHandoffsMessage,
    };
  }

  const select = options.select ?? ((input) => p.select(input));
  const isCancel = options.isCancel ?? p.isCancel;
  const selection = await select({
    message: buildPromptMessage(options.action),
    options: options.handoffs.map((handoff) => ({
      value: handoff.handoffId,
      label: `${handoff.sessionId} / ${handoff.handoffId}`,
      hint: handoff.commitSha.slice(0, 8),
    })),
  });

  if (isCancel(selection)) {
    return { handoff: null };
  }

  return {
    handoff: options.handoffs.find((handoff) => handoff.handoffId === selection) ?? null,
  };
}

export async function resolvePendingHandoffSelection(
  options: ResolvePendingHandoffSelectionOptions
) {
  return await resolveHandoffSelection({
    ...options,
    multipleHandoffsMessage:
      "Multiple pending review handoffs exist for this project. Re-run with --session <id|name>.",
  });
}
