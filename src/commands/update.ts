import * as p from "@clack/prompts";
import { getCommandDef } from "@/cli";
import { type CommandDef, parseCommand } from "@/lib/cli-parser";
import {
  getDefaultSelfUpdateDependencies,
  isUpdateManager,
  performSelfUpdate,
  type SelfUpdateDependencies,
  SelfUpdateError,
  type SelfUpdateOptions,
  type SelfUpdateResult,
} from "@/lib/self-update";

interface UpdateRuntime extends SelfUpdateDependencies {
  getCommandDef: (name: string) => CommandDef | undefined;
  parseCommand: typeof parseCommand;
  performSelfUpdate: typeof performSelfUpdate;
  log: {
    error: (message: string) => void;
    info: (message: string) => void;
    message: (message: string) => void;
    success: (message: string) => void;
  };
  exit: (code: number) => void;
}

export interface UpdateRuntimeOverrides extends Partial<Omit<UpdateRuntime, "log">> {
  log?: Partial<UpdateRuntime["log"]>;
}

function createUpdateRuntime(overrides: UpdateRuntimeOverrides = {}): UpdateRuntime {
  const baseDeps = getDefaultSelfUpdateDependencies(overrides.cliPath);

  return {
    ...baseDeps,
    ...overrides,
    getCommandDef: overrides.getCommandDef ?? getCommandDef,
    parseCommand: overrides.parseCommand ?? parseCommand,
    performSelfUpdate: overrides.performSelfUpdate ?? performSelfUpdate,
    log: {
      error: overrides.log?.error ?? p.log.error,
      info: overrides.log?.info ?? p.log.info,
      message: overrides.log?.message ?? p.log.message,
      success: overrides.log?.success ?? p.log.success,
    },
    exit: overrides.exit ?? process.exit.bind(process),
  };
}

function managerLabel(manager: SelfUpdateResult["manager"]): string {
  return manager === "brew" ? "Homebrew" : "npm";
}

function renderSelfUpdateResult(result: SelfUpdateResult, runtime: UpdateRuntime): void {
  switch (result.status) {
    case "up-to-date":
      runtime.log.success(
        `ralph-review is already up to date via ${managerLabel(result.manager)} (${result.currentVersion}).`
      );
      return;

    case "update-available":
      if (result.latestVersion) {
        runtime.log.info(
          `Update available via ${managerLabel(result.manager)}: ${result.currentVersion} -> ${result.latestVersion}`
        );
        return;
      }

      runtime.log.info(
        `Update available via ${managerLabel(result.manager)}. Current version: ${result.currentVersion}`
      );
      return;

    case "updated":
      runtime.log.success(
        `Updated ralph-review via ${managerLabel(result.manager)}: ${result.previousVersion} -> ${result.finalVersion}`
      );
      return;
  }
}

export async function runUpdate(
  argv: string[],
  overrides: UpdateRuntimeOverrides = {}
): Promise<void> {
  const runtime = createUpdateRuntime(overrides);
  const commandDef = runtime.getCommandDef("update");
  if (!commandDef) {
    runtime.log.error("Internal error: update command definition not found");
    runtime.exit(1);
    return;
  }

  const parsed = runtime.parseCommand<{ check: boolean; manager?: string }>(commandDef, argv);
  const managerValue = parsed.values.manager;
  if (managerValue !== undefined && !isUpdateManager(managerValue)) {
    runtime.log.error(`Invalid value for --manager: "${managerValue}"`);
    runtime.log.message("Valid values: npm, brew");
    runtime.exit(1);
    return;
  }

  const options: SelfUpdateOptions = {
    checkOnly: parsed.values.check ?? false,
    manager: managerValue,
  };

  try {
    const result = await runtime.performSelfUpdate(options, runtime);

    renderSelfUpdateResult(result, runtime);
  } catch (error) {
    if (error instanceof SelfUpdateError) {
      runtime.log.error(error.message);
      for (const note of error.notes) {
        runtime.log.message(note);
      }
    } else {
      runtime.log.error(`${error}`);
    }

    runtime.exit(1);
  }
}
