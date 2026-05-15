import * as p from "@clack/prompts";
import { resolvePendingHandoffSelection } from "@/commands/handoff-selection";
import {
  createInteractiveCommandDeps,
  type InteractiveCommandDeps,
} from "@/commands/interactive-deps";
import { parseCommand } from "@/lib/cli-parser";
import { applyPendingHandoff, listProjectPendingHandoffs } from "@/lib/handoff";
import { appendLog } from "@/lib/logger";
import type { LogEntry } from "@/lib/types";

interface ApplyOptions {
  session?: string;
}

type ApplyDeps = InteractiveCommandDeps & {
  cwd: () => string;
  listProjectPendingHandoffs: typeof listProjectPendingHandoffs;
  applyPendingHandoff: typeof applyPendingHandoff;
  appendLog: (logPath: string, entry: LogEntry) => Promise<void>;
  logInfo: (message: string) => void;
  logStep: (message: string) => void;
  logSuccess: (message: string) => void;
  select: (input: {
    message: string;
    options: Array<{ value: string; label: string; hint: string }>;
  }) => Promise<unknown>;
  isCancel: (value: unknown) => boolean;
};

const DEFAULT_APPLY_DEPS: ApplyDeps = {
  ...createInteractiveCommandDeps(),
  cwd: () => process.cwd(),
  listProjectPendingHandoffs,
  applyPendingHandoff,
  appendLog,
  logInfo: (message) => p.log.info(message),
  logStep: (message) => p.log.step(message),
  logSuccess: (message) => p.log.success(message),
  select: (input) => p.select(input),
  isCancel: (value) => p.isCancel(value),
};

const NO_PENDING_HANDOFFS_MESSAGE = "No pending review handoffs for current working directory.";

export async function runApply(args: string[], deps: Partial<ApplyDeps> = {}): Promise<void> {
  const applyDeps = { ...DEFAULT_APPLY_DEPS, ...deps };
  const commandDef = applyDeps.getCommandDef("apply");
  if (!commandDef) {
    applyDeps.logError("Internal error: apply command definition not found");
    applyDeps.exit(1);
    return;
  }

  let parsed: ApplyOptions;
  try {
    const { values } = parseCommand<ApplyOptions>(commandDef, args);
    parsed = values;
  } catch (error) {
    applyDeps.logError(`${error}`);
    applyDeps.exit(1);
    return;
  }

  const projectPath = applyDeps.cwd();
  const handoffs = await applyDeps.listProjectPendingHandoffs(undefined, projectPath);
  if (handoffs.length === 0) {
    applyDeps.logInfo(NO_PENDING_HANDOFFS_MESSAGE);
    return;
  }

  const selection = await resolvePendingHandoffSelection({
    handoffs,
    selector: parsed.session,
    action: "apply",
    isTTY: applyDeps.isTTY(),
    select: applyDeps.select,
    isCancel: applyDeps.isCancel,
  });

  if (!selection.handoff) {
    if (selection.error) {
      applyDeps.logError(selection.error);
      applyDeps.exit(1);
    }
    return;
  }

  applyDeps.logStep(`Applying handoff: ${selection.handoff.handoffId}`);

  try {
    const artifact = await applyDeps.applyPendingHandoff(
      undefined,
      projectPath,
      selection.handoff.handoffId
    );
    await applyDeps.appendLog(artifact.logPath, {
      type: "handoff",
      timestamp: Date.now(),
      handoffId: artifact.handoffId,
      handoffStatus: "applied-manual",
      commitSha: artifact.commitSha,
    });
    applyDeps.logSuccess("Review handoff applied.");
  } catch (error) {
    applyDeps.logError(`${error}`);
    applyDeps.exit(1);
    return;
  }
}

export type { ApplyDeps };
