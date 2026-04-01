import * as p from "@clack/prompts";
import { resolvePendingHandoffSelection } from "@/commands/handoff-selection";
import { type CommandDef, parseCommand } from "@/lib/cli-parser";
import { listProjectPendingHandoffs } from "@/lib/handoff";
import { appendLog } from "@/lib/logger";
import type { HandoffStatus, PendingHandoffArtifact } from "@/lib/types";

interface PendingHandoffOptions {
  session?: string;
}

export interface PendingHandoffCommandDeps {
  getCommandDef: (name: string) => CommandDef | undefined;
  logError: (message: string) => void;
  exit: (code: number) => void;
  isTTY: () => boolean;
}

interface RunPendingHandoffCommandOptions {
  args: string[];
  commandName: "apply" | "discard";
  progressLabel: string;
  successMessage: string;
  logStatus: Extract<HandoffStatus, "applied-manual" | "discarded">;
  deps: PendingHandoffCommandDeps;
  execute: (projectPath: string, sessionId: string) => Promise<PendingHandoffArtifact>;
}

const NO_PENDING_HANDOFFS_MESSAGE = "No pending review handoffs for current working directory.";

export async function runPendingHandoffCommand(
  options: RunPendingHandoffCommandOptions
): Promise<void> {
  const commandDef = options.deps.getCommandDef(options.commandName);
  if (!commandDef) {
    options.deps.logError(`Internal error: ${options.commandName} command definition not found`);
    options.deps.exit(1);
    return;
  }

  let parsed: PendingHandoffOptions;
  try {
    const { values } = parseCommand<PendingHandoffOptions>(commandDef, options.args);
    parsed = values;
  } catch (error) {
    options.deps.logError(`${error}`);
    options.deps.exit(1);
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
    action: options.commandName,
    isTTY: options.deps.isTTY(),
  });

  if (!selection.handoff) {
    if (selection.error) {
      options.deps.logError(selection.error);
      options.deps.exit(1);
    }
    return;
  }

  p.log.step(`${options.progressLabel}: ${selection.handoff.sessionId}`);
  const artifact = await options.execute(projectPath, selection.handoff.sessionId);
  await appendLog(artifact.logPath, {
    type: "handoff",
    timestamp: Date.now(),
    handoffStatus: options.logStatus,
    commitSha: artifact.commitSha,
  });
  p.log.success(options.successMessage);
}
