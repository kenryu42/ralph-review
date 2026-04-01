import * as p from "@clack/prompts";
import { getCommandDef } from "@/cli";
import {
  type PendingHandoffCommandDeps,
  runPendingHandoffCommand,
} from "@/commands/pending-handoff-command";
import { discardPendingHandoff } from "@/lib/handoff";

type DiscardDeps = PendingHandoffCommandDeps;

const DEFAULT_DISCARD_DEPS: DiscardDeps = {
  getCommandDef,
  logError: (message: string) => p.log.error(message),
  exit: (code: number) => process.exit(code),
  isTTY: () => process.stdout.isTTY === true,
};

export async function runDiscard(args: string[], deps: Partial<DiscardDeps> = {}): Promise<void> {
  const discardDeps = { ...DEFAULT_DISCARD_DEPS, ...deps };
  await runPendingHandoffCommand({
    args,
    commandName: "discard",
    progressLabel: "Discarding handoff",
    successMessage: "Review handoff discarded.",
    logStatus: "discarded",
    deps: discardDeps,
    execute: (projectPath, sessionId) => discardPendingHandoff(undefined, projectPath, sessionId),
  });
}
