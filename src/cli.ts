#!/usr/bin/env bun

import * as p from "@clack/prompts";
import { getCommandDef, getVersion, parseArgs, printCommandHelp, printUsage } from "./cli-core";
import { runDashboard } from "./commands/dashboard";
import { runInit } from "./commands/init";
import { runList } from "./commands/list";
import { runLogs } from "./commands/logs";
import { runForeground, startReview } from "./commands/run";
import { runStatus } from "./commands/status";
import { runStop } from "./commands/stop";
import { CliError, parseCommand } from "./lib/cli-parser";

export {
  COMMANDS,
  getCommandDef,
  getVersion,
  type ParsedArgs,
  parseArgs,
  printCommandHelp,
  printUsage,
} from "./cli-core";
export { runRrr } from "./cli-rrr";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { command, args, showHelp, showVersion } = parseArgs(argv);

  if (showVersion) {
    console.log(`ralph-review v${getVersion()}`);
    return;
  }

  if (!command) {
    console.log(printUsage());
    return;
  }

  if (showHelp) {
    const commandHelp = printCommandHelp(command);
    if (commandHelp) {
      console.log(commandHelp);
    } else {
      console.log(printUsage());
    }
    return;
  }

  const resolvedCommand = getCommandDef(command)?.name ?? command;

  const commandDef = getCommandDef(resolvedCommand);
  if (commandDef) {
    try {
      parseCommand(commandDef, args);
    } catch (error) {
      if (error instanceof CliError) {
        const [firstLine, ...rest] = error.message.split("\n");
        if (firstLine) p.log.error(firstLine);
        for (const line of rest) {
          if (line) p.log.message(line);
        }
      } else {
        p.log.error(`${error}`);
      }
      process.exit(1);
    }
  }

  try {
    switch (resolvedCommand) {
      case "init":
        await runInit();
        break;

      case "run":
        await startReview(args);
        break;

      case "_run-foreground":
        await runForeground(args);
        break;

      case "status":
        await runStatus();
        break;

      case "stop":
        await runStop(args);
        break;

      case "logs":
        await runLogs(args);
        break;

      case "dashboard":
        await runDashboard(args);
        break;

      case "list":
        await runList();
        break;

      default:
        p.log.error(`Unknown command: ${command}`);
        console.log(`\n${printUsage()}`);
        process.exit(1);
    }
  } catch (error) {
    p.log.error(`Error: ${error}`);
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    p.log.error(`Fatal error: ${error}`);
    process.exit(1);
  });
}
