import * as p from "@clack/prompts";
import { resolveArchivedHandoffSelection } from "@/commands/handoff-selection";
import { type CommandDef, parseCommand } from "@/lib/cli-parser";
import type { ArchivedAppliedHandoffArtifact, ArchivedHandoffMatchResult } from "@/lib/types";

interface ArchivedHandoffOptions {
  session?: string;
}

export interface ArchivedHandoffCommandDeps {
  getCommandDef: (name: string) => CommandDef | undefined;
  logError: (message: string) => void;
  exit: (code: number) => void;
  isTTY: () => boolean;
}

interface RunArchivedHandoffCommandOptions {
  args: string[];
  commandName: "revert" | "reapply";
  progressLabel: string;
  successMessage: string;
  noMatchesMessage: string;
  spinnerMessage: string;
  failureMessage: string;
  deps: ArchivedHandoffCommandDeps;
  listArchivedHandoffs: (projectPath: string) => Promise<ArchivedAppliedHandoffArtifact[]>;
  listMatchingHandoffs: (projectPath: string) => Promise<ArchivedHandoffMatchResult>;
  execute: (
    projectPath: string,
    sessionId: string,
    expectedCurrentFingerprint?: string
  ) => Promise<ArchivedAppliedHandoffArtifact>;
}

export async function runArchivedHandoffCommand(
  options: RunArchivedHandoffCommandOptions
): Promise<void> {
  const commandDef = options.deps.getCommandDef(options.commandName);
  if (!commandDef) {
    options.deps.logError(`Internal error: ${options.commandName} command definition not found`);
    options.deps.exit(1);
    return;
  }

  let parsed: ArchivedHandoffOptions;
  try {
    const { values } = parseCommand<ArchivedHandoffOptions>(commandDef, options.args);
    parsed = values;
  } catch (error) {
    options.deps.logError(`${error}`);
    options.deps.exit(1);
    return;
  }

  const projectPath = process.cwd();
  let matching: ArchivedHandoffMatchResult | null = null;
  if (!parsed.session) {
    const scanSpinner = p.spinner();
    scanSpinner.start("Checking archived handoff matches...");
    try {
      matching = await options.listMatchingHandoffs(projectPath);
      scanSpinner.stop("Archived handoff scan complete.");
    } catch (error) {
      scanSpinner.stop("Archived handoff scan failed.");
      throw error;
    }
  }
  const handoffs = parsed.session
    ? await options.listArchivedHandoffs(projectPath)
    : (matching?.handoffs ?? []);

  if (!parsed.session && handoffs.length === 0) {
    options.deps.logError(options.noMatchesMessage);
    options.deps.exit(1);
    return;
  }

  const selection = await resolveArchivedHandoffSelection({
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
  const spinner = p.spinner();
  spinner.start(options.spinnerMessage);
  try {
    await options.execute(
      projectPath,
      selection.handoff.sessionId,
      parsed.session ? undefined : matching?.currentFingerprint
    );
  } catch (error) {
    spinner.stop(options.failureMessage);
    throw error;
  }
  spinner.stop(options.successMessage);
  p.log.success(options.successMessage);
}
