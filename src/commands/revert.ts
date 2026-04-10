import * as p from "@clack/prompts";
import { getCommandDef } from "@/cli";
import {
  type ArchivedHandoffCommandDeps,
  runArchivedHandoffCommand,
} from "@/commands/archived-handoff-command";
import {
  listProjectArchivedHandoffs,
  listProjectRevertableHandoffs,
  revertArchivedHandoff,
} from "@/lib/handoff";

type RevertDeps = ArchivedHandoffCommandDeps;

const DEFAULT_REVERT_DEPS: RevertDeps = {
  getCommandDef,
  logError: (message: string) => p.log.error(message),
  exit: (code: number) => process.exit(code),
  isTTY: () => process.stdout.isTTY === true,
};

export async function runRevert(args: string[], deps: Partial<RevertDeps> = {}): Promise<void> {
  const revertDeps = { ...DEFAULT_REVERT_DEPS, ...deps };
  await runArchivedHandoffCommand({
    args,
    commandName: "revert",
    progressLabel: "Reverting handoff",
    successMessage: "Review handoff reverted.",
    noMatchesMessage: "No archived review handoff matches the current repository state for revert.",
    spinnerMessage: "Reverting archived handoff...",
    failureMessage: "Review handoff revert failed.",
    deps: revertDeps,
    listArchivedHandoffs: (projectPath) => listProjectArchivedHandoffs(undefined, projectPath),
    listMatchingHandoffs: (projectPath) => listProjectRevertableHandoffs(undefined, projectPath),
    execute: (projectPath, sessionId, expectedCurrentFingerprint) =>
      revertArchivedHandoff(undefined, projectPath, sessionId, expectedCurrentFingerprint),
  });
}
