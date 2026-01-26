#!/usr/bin/env bun
/**
 * ralph-review CLI entry point
 * AI-powered code review tool
 */

import * as p from "@clack/prompts";
import { runAttach } from "./commands/attach";
import { runInit } from "./commands/init";
import { runLogs } from "./commands/logs";
import { runForeground, runRun } from "./commands/run";
import { runStatus } from "./commands/status";
import { runStop } from "./commands/stop";
import { type CommandDef, formatCommandHelp, formatMainHelp } from "./lib/cli-parser";

/**
 * Command definitions for CLI
 */
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
      { name: "background", alias: "b", type: "boolean", description: "Run in background" },
      { name: "list", alias: "l", type: "boolean", description: "List active sessions" },
      { name: "max", alias: "m", type: "number", description: "Max iterations" },
    ],
    examples: ["rr run", "rr run -b", "rr run --max=3", "rr run -l"],
  },
  {
    name: "attach",
    description: "Attach to running review session",
    positional: [{ name: "session", description: "Session name to attach to" }],
    examples: ["rr attach", "rr attach ralph-2024-01-01_12-00"],
  },
  {
    name: "status",
    description: "Show current review progress",
    examples: ["rr status"],
  },
  {
    name: "stop",
    description: "Stop running review session",
    options: [{ name: "all", alias: "A", type: "boolean", description: "Stop all sessions" }],
    examples: ["rr stop", "rr stop --all"],
  },
  {
    name: "logs",
    description: "View review logs in browser",
    options: [{ name: "list", alias: "l", type: "boolean", description: "List all log sessions" }],
    positional: [{ name: "timestamp", description: "Specific log timestamp to view" }],
    examples: ["rr logs", "rr logs --list", "rr logs 2024-01-01_12-00"],
  },
  {
    name: "_run-foreground",
    description: "Internal: run review cycle in tmux foreground",
    hidden: true,
    options: [{ name: "max", type: "number", description: "Max iterations" }],
  },
];

/**
 * Get command definition by name
 */
export function getCommandDef(name: string): CommandDef | undefined {
  return COMMANDS.find((c) => c.name === name);
}

/**
 * Parsed command line arguments
 */
export interface ParsedArgs {
  command: string;
  args: string[];
  showHelp: boolean;
  showVersion: boolean;
}

/**
 * Parse command line arguments
 */
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

/**
 * Get version from package.json
 */
export function getVersion(): string {
  try {
    const pkg = require("../package.json");
    return pkg.version || "0.1.0";
  } catch {
    return "0.1.0";
  }
}

/**
 * Print usage information (main help)
 */
export function printUsage(): string {
  return formatMainHelp(COMMANDS, getVersion());
}

/**
 * Print command-specific help
 */
export function printCommandHelp(commandName: string): string | undefined {
  const def = getCommandDef(commandName);
  if (!def) return undefined;
  return formatCommandHelp(def);
}

/**
 * Main CLI handler
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { command, args, showHelp, showVersion } = parseArgs(argv);

  if (showVersion) {
    console.log(`ralph-review v${getVersion()}`);
    return;
  }

  // No command: show main help
  if (!command) {
    console.log(printUsage());
    return;
  }

  // Command-level help: rr <command> --help
  if (showHelp) {
    const commandHelp = printCommandHelp(command);
    if (commandHelp) {
      console.log(commandHelp);
    } else {
      console.log(printUsage());
    }
    return;
  }

  try {
    switch (command) {
      case "init":
        await runInit();
        break;

      case "run":
        await runRun(args);
        break;

      case "_run-foreground":
        // Internal command used by tmux
        await runForeground(args);
        break;

      case "attach":
        await runAttach(args);
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
