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
 * Print usage information
 */
export function printUsage(): string {
  return `
ralph-review - AI-powered code review CLI

USAGE:
  rr <command> [options]

COMMANDS:
  init                  Configure reviewer and fixer agents
  run                   Start review cycle
  run --background, -b  Run in background
  run --list, -ls       List active review sessions
  run --max=N           Set max iterations (default: 5)
  attach                Attach to most recent review session
  attach <session>      Attach to specific session by name
  status                Show current review progress
  stop                  Stop running review session
  stop --force          Force kill session immediately
  logs                  Open latest log in browser
  logs --list           List all log sessions
  logs <timestamp>      Open specific log session

OPTIONS:
  -h, --help          Show this help message
  -v, --version       Show version number

EXAMPLES:
  rr init             # Set up agents (first time)
  rr run              # Start and attach to review session
  rr run -b           # Start in background
  rr run --list       # Show active sessions
  rr run --max=3      # Run with 3 iterations max
  rr attach           # Attach to latest session
  rr status           # Quick status check
  rr logs             # View results in browser
`.trim();
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

  if (showHelp || !command) {
    console.log(printUsage());
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
