#!/usr/bin/env bun

import * as p from "@clack/prompts";
import { getCommandDef, getVersion, parseArgs, printCommandHelp, printUsage } from "./cli-core";
import { runConfig } from "./commands/config";
import { runDashboard } from "./commands/dashboard";
import { runDoctor } from "./commands/doctor";
import { runInit } from "./commands/init";
import { runList } from "./commands/list";
import { runLogs } from "./commands/logs";
import { runForeground, startReview } from "./commands/run";
import { runStatus } from "./commands/status";
import { runStop } from "./commands/stop";
import { CliError, type CommandDef, parseCommand } from "./lib/cli-parser";

export {
  COMMANDS,
  getCommandDef,
  getVersion,
  type ParsedArgs,
  parseArgs,
  printCommandHelp,
  printUsage,
} from "./cli-core";
export { type RrrDeps, runRrr, runRrrEntrypoint } from "./cli-rrr";

export interface CliDeps {
  parseArgs: typeof parseArgs;
  getVersion: typeof getVersion;
  printUsage: typeof printUsage;
  printCommandHelp: typeof printCommandHelp;
  getCommandDef: (name: string) => CommandDef | undefined;
  parseCommand: typeof parseCommand;
  runInit: typeof runInit;
  runConfig: typeof runConfig;
  startReview: typeof startReview;
  runForeground: typeof runForeground;
  runStatus: typeof runStatus;
  runStop: typeof runStop;
  runLogs: typeof runLogs;
  runDashboard: typeof runDashboard;
  runDoctor: typeof runDoctor;
  runList: typeof runList;
  log: (message: string) => void;
  logError: (message: string) => void;
  logMessage: (message: string) => void;
  exit: (code: number) => void;
}

const CONSOLE_LOG = console.log.bind(console) as (message: string) => void;
const CLACK_ERROR = p.log.error.bind(p.log) as (message: string) => void;
const CLACK_MESSAGE = p.log.message.bind(p.log) as (message: string) => void;
const PROCESS_EXIT = process.exit.bind(process) as (code: number) => void;

const DEFAULT_CLI_DEPS: CliDeps = {
  parseArgs,
  getVersion,
  printUsage,
  printCommandHelp,
  getCommandDef,
  parseCommand,
  runInit,
  runConfig,
  startReview,
  runForeground,
  runStatus,
  runStop,
  runLogs,
  runDashboard,
  runDoctor,
  runList,
  log: CONSOLE_LOG,
  logError: CLACK_ERROR,
  logMessage: CLACK_MESSAGE,
  exit: PROCESS_EXIT,
};

function buildCliDeps(overrides: Partial<CliDeps>): CliDeps {
  return { ...DEFAULT_CLI_DEPS, ...overrides };
}

export async function runCli(
  args: string[] = process.argv.slice(2),
  deps: Partial<CliDeps> = {}
): Promise<void> {
  const cliDeps = buildCliDeps(deps);
  const { command, args: commandArgs, showHelp, showVersion } = cliDeps.parseArgs(args);

  if (showVersion) {
    cliDeps.log(`ralph-review v${cliDeps.getVersion()}`);
    return;
  }

  if (!command) {
    cliDeps.log(cliDeps.printUsage());
    return;
  }

  if (showHelp) {
    const commandHelp = cliDeps.printCommandHelp(command);
    if (commandHelp) {
      cliDeps.log(commandHelp);
    } else {
      cliDeps.log(cliDeps.printUsage());
    }
    return;
  }

  const resolvedCommand = cliDeps.getCommandDef(command)?.name ?? command;

  const commandDef = cliDeps.getCommandDef(resolvedCommand);
  if (commandDef && resolvedCommand !== "config") {
    try {
      cliDeps.parseCommand(commandDef, commandArgs);
    } catch (error) {
      if (error instanceof CliError) {
        const [firstLine, ...rest] = error.message.split("\n");
        if (firstLine) cliDeps.logError(firstLine);
        for (const line of rest) {
          if (line) cliDeps.logMessage(line);
        }
      } else {
        cliDeps.logError(`${error}`);
      }
      cliDeps.exit(1);
      return;
    }
  }

  try {
    switch (resolvedCommand) {
      case "init":
        await cliDeps.runInit();
        break;

      case "config":
        await cliDeps.runConfig(commandArgs);
        break;

      case "run":
        await cliDeps.startReview(commandArgs);
        break;

      case "_run-foreground":
        await cliDeps.runForeground(commandArgs);
        break;

      case "status":
        await cliDeps.runStatus();
        break;

      case "stop":
        await cliDeps.runStop(commandArgs);
        break;

      case "logs":
        await cliDeps.runLogs(commandArgs);
        break;

      case "dashboard":
        await cliDeps.runDashboard(commandArgs);
        break;

      case "doctor":
        await cliDeps.runDoctor(commandArgs);
        break;

      case "list":
        await cliDeps.runList();
        break;

      default:
        cliDeps.logError(`Unknown command: ${command}`);
        cliDeps.log(`\n${cliDeps.printUsage()}`);
        cliDeps.exit(1);
        return;
    }
  } catch (error) {
    cliDeps.logError(`Error: ${error}`);
    cliDeps.exit(1);
  }
}

export function runCliEntrypoint(
  run?: () => Promise<void>,
  deps: Pick<CliDeps, "logError" | "exit"> = DEFAULT_CLI_DEPS
): void {
  const runFn = run ?? runCli;
  runFn().catch((error) => {
    deps.logError(`Fatal error: ${error}`);
    deps.exit(1);
  });
}

if (import.meta.main) {
  runCliEntrypoint();
}
