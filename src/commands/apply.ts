import * as p from "@clack/prompts";
import { getCommandDef } from "@/cli";
import {
  type PendingHandoffCommandDeps,
  runPendingHandoffCommand,
} from "@/commands/pending-handoff-command";
import { applyPendingHandoff } from "@/lib/handoff";

type ApplyDeps = PendingHandoffCommandDeps;

const DEFAULT_APPLY_DEPS: ApplyDeps = {
  getCommandDef,
  logError: (message: string) => p.log.error(message),
  exit: (code: number) => process.exit(code),
  isTTY: () => process.stdout.isTTY === true,
};

export async function runApply(args: string[], deps: Partial<ApplyDeps> = {}): Promise<void> {
  const applyDeps = { ...DEFAULT_APPLY_DEPS, ...deps };
  await runPendingHandoffCommand({
    args,
    commandName: "apply",
    progressLabel: "Applying handoff",
    successMessage: "Review handoff applied.",
    logStatus: "applied-manual",
    deps: applyDeps,
    execute: (projectPath, sessionId) => applyPendingHandoff(undefined, projectPath, sessionId),
  });
}
