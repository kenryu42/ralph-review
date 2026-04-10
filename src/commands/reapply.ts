import * as p from "@clack/prompts";
import { getCommandDef } from "@/cli";
import {
  type ArchivedHandoffCommandDeps,
  runArchivedHandoffCommand,
} from "@/commands/archived-handoff-command";
import {
  listProjectArchivedHandoffs,
  listProjectReapplicableHandoffs,
  reapplyArchivedHandoff,
} from "@/lib/handoff";

type ReapplyDeps = ArchivedHandoffCommandDeps;

const DEFAULT_REAPPLY_DEPS: ReapplyDeps = {
  getCommandDef,
  logError: (message: string) => p.log.error(message),
  exit: (code: number) => process.exit(code),
  isTTY: () => process.stdout.isTTY === true,
};

export async function runReapply(args: string[], deps: Partial<ReapplyDeps> = {}): Promise<void> {
  const reapplyDeps = { ...DEFAULT_REAPPLY_DEPS, ...deps };
  await runArchivedHandoffCommand({
    args,
    commandName: "reapply",
    progressLabel: "Reapplying handoff",
    successMessage: "Review handoff reapplied.",
    noMatchesMessage:
      "No archived review handoff matches the current repository state for reapply.",
    spinnerMessage: "Reapplying archived handoff...",
    failureMessage: "Review handoff reapply failed.",
    deps: reapplyDeps,
    listArchivedHandoffs: (projectPath) => listProjectArchivedHandoffs(undefined, projectPath),
    listMatchingHandoffs: (projectPath) => listProjectReapplicableHandoffs(undefined, projectPath),
    execute: (projectPath, sessionId, expectedCurrentFingerprint) =>
      reapplyArchivedHandoff(undefined, projectPath, sessionId, expectedCurrentFingerprint),
  });
}
