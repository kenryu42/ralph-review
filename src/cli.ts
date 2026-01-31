#!/usr/bin/env bun

import * as p from "@clack/prompts";
import { runInit } from "./commands/init";
import { runList } from "./commands/list";
import { runLogs } from "./commands/logs";
import { runForeground, startReview } from "./commands/run";
import { runStatus } from "./commands/status";
import { runStop } from "./commands/stop";
import { type CommandDef, formatCommandHelp, formatMainHelp } from "./lib/cli-parser";

export const COMMANDS: CommandDef[] = [
  {
    name: "init",
    description: "Configure reviewer and fixer agents",
    examples: ["rr init"],
  },
  {
    name: "run",
    description: "Start review cycle",
    options: [
      { name: "max", alias: "m", type: "number", description: "Max iterations" },
      {
        name: "base",
        alias: "b",
        type: "string",
        placeholder: "BRANCH",
        description: "Base branch to compare against",
      },
      {
        name: "uncommitted",
        alias: "u",
        type: "boolean",
        description: "Review staged, unstaged, and untracked changes (default)",
      },
    ],
    examples: ["rr run", "rr run --base main"],
  },
  {
    name: "list",
    aliases: ["ls"],
    description: "List active review sessions",
    examples: ["rr list", "rr ls"],
  },
  {
    name: "status",
    description: "Show review status",
    examples: ["rr status"],
  },
  {
    name: "stop",
    description: "Stop running review session",
    options: [
      { name: "all", alias: "A", type: "boolean", description: "Stop all running review sessions" },
    ],
    examples: ["rr stop", "rr stop --all"],
  },
  {
    name: "logs",
    description: "View review logs",
    options: [
      { name: "html", type: "boolean", description: "Open dashboard in browser" },
      { name: "json", type: "boolean", description: "Output as JSON" },
      {
        name: "last",
        alias: "n",
        type: "number",
        description: "Number of sessions to show",
        default: 1,
      },
      {
        name: "global",
        type: "boolean",
        description: "Show all sessions across all projects (requires --json)",
      },
    ],
    examples: ["rr logs", "rr logs -n 5", "rr logs --json", "rr logs --json --global"],
  },
  {
    name: "_run-foreground",
    description: "Internal: run review cycle in tmux foreground",
    hidden: true,
    options: [{ name: "max", type: "number", description: "Max iterations" }],
  },
];

export function getCommandDef(name: string): CommandDef | undefined {
  return COMMANDS.find((c) => c.name === name || c.aliases?.includes(name));
}

export interface ParsedArgs {
  command: string;
  args: string[];
  showHelp: boolean;
  showVersion: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    command: "",
    args: [],
    showHelp: false,
    showVersion: false,
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      result.showHelp = true;
    } else if (arg === "--version" || arg === "-v") {
      result.showVersion = true;
    } else if (!result.command && !arg.startsWith("-")) {
      result.command = arg;
    } else {
      result.args.push(arg);
    }
  }

  return result;
}

export function getVersion(): string {
  try {
    const pkg = require("../package.json");
    return pkg.version || "0.1.0";
  } catch {
    return "0.1.0";
  }
}

export function printUsage(): string {
  return formatMainHelp(COMMANDS, getVersion());
}

export function printCommandHelp(commandName: string): string | undefined {
  const def = getCommandDef(commandName);
  if (!def) return undefined;
  return formatCommandHelp(def);
}

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

  // Resolve command aliases (e.g., "ls" -> "list")
  const resolvedCommand = COMMANDS.find((c) => c.aliases?.includes(command))?.name ?? command;

  try {
    switch (resolvedCommand) {
      case "init":
        await runInit();
        break;

      case "run":
        await startReview(args);
        break;

      case "_run-foreground":
        // Internal command used by tmux
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

// Run if this is the main module
if (import.meta.main) {
  main().catch((error) => {
    p.log.error(`Fatal error: ${error}`);
    process.exit(1);
  });
}
