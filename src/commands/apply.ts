import * as p from "@clack/prompts";
import { getCommandDef } from "@/cli";
import { resolvePendingHandoffSelection } from "@/commands/handoff-selection";
import type { CommandDef } from "@/lib/cli-parser";
import { parseCommand } from "@/lib/cli-parser";
import { applyPendingHandoff, listProjectPendingHandoffs } from "@/lib/handoff";
import { appendLog } from "@/lib/logger";

interface ApplyOptions {
  session?: string;
}

interface ApplyDeps {
  getCommandDef: (name: string) => CommandDef | undefined;
  logError: (message: string) => void;
  exit: (code: number) => void;
  isTTY: () => boolean;
}

const DEFAULT_APPLY_DEPS: ApplyDeps = {
  getCommandDef,
  logError: (message: string) => p.log.error(message),
  exit: (code: number) => process.exit(code),
  isTTY: () => process.stdout.isTTY === true,
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

  const projectPath = process.cwd();
  const handoffs = await listProjectPendingHandoffs(undefined, projectPath);
  if (handoffs.length === 0) {
    p.log.info(NO_PENDING_HANDOFFS_MESSAGE);
    return;
  }

  const selection = await resolvePendingHandoffSelection({
    handoffs,
    selector: parsed.session,
    action: "apply",
    isTTY: applyDeps.isTTY(),
  });

  if (!selection.handoff) {
    if (selection.error) {
      applyDeps.logError(selection.error);
      applyDeps.exit(1);
    }
    return;
  }

  p.log.step(`Applying handoff: ${selection.handoff.handoffId}`);

  try {
    const artifact = await applyPendingHandoff(undefined, projectPath, selection.handoff.handoffId);
    await appendLog(artifact.logPath, {
      type: "handoff",
      timestamp: Date.now(),
      handoffId: artifact.handoffId,
      handoffStatus: "applied-manual",
      commitSha: artifact.commitSha,
    });
    p.log.success("Review handoff applied.");
  } catch (error) {
    applyDeps.logError(`${error}`);
    applyDeps.exit(1);
    return;
  }
}
