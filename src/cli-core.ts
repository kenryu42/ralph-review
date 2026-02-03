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
        name: "force",
        alias: "f",
        type: "boolean",
        description: "Run full max iterations even if stop_iteration is true",
      },
      {
        name: "base",
        type: "string",
        placeholder: "BRANCH",
        description: "Review changes against the given base branch",
      },
      {
        name: "uncommitted",
        type: "boolean",
        description: "Review staged, unstaged, and untracked changes",
      },
      {
        name: "commit",
        type: "string",
        placeholder: "SHA",
        description: "Review the changes introduced by a commit",
      },
      {
        name: "custom",
        type: "string",
        placeholder: "PROMPT",
        description: "Custom review instructions",
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
    options: [
      { name: "max", type: "number", description: "Max iterations" },
      {
        name: "force",
        alias: "f",
        type: "boolean",
        description: "Run full max iterations even if stop_iteration is true",
      },
    ],
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
