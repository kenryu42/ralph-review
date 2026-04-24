import { type CommandDef, formatCommandHelp, formatMainHelp } from "./lib/cli-parser";

export const COMMANDS: CommandDef[] = [
  {
    name: "init",
    description: "Configure reviewer and fixer agents (auto or custom)",
    options: [
      {
        name: "local",
        type: "boolean",
        description: "Write the repo-local override file at .ralph-review/config.json",
      },
      {
        name: "global",
        type: "boolean",
        description: "Write the user-global config at ~/.config/ralph-review/config.json",
      },
    ],
    examples: ["rr init", "rr init --global"],
  },
  {
    name: "config",
    description: "Inspect and update configuration",
    options: [
      {
        name: "local",
        type: "boolean",
        description: "Use the repo-local override file at .ralph-review/config.json",
      },
      {
        name: "global",
        type: "boolean",
        description: "Use the user-global config at ~/.config/ralph-review/config.json",
      },
      {
        name: "json",
        type: "boolean",
        description: "Print raw JSON output for `config show`",
      },
      {
        name: "verbose",
        type: "boolean",
        description: "Include metadata in human-readable `config show` output",
      },
    ],
    positional: [
      {
        name: "subcommand",
        description:
          "show = print config | get = read one key | set = update one key | edit = open in $EDITOR",
      },
      { name: "key", description: "Dot-path config key (required for get/set)" },
      { name: "value", description: "Value to write (required for set)" },
    ],
    examples: [
      "rr config show",
      "rr config show --local",
      "rr config show --json",
      "rr config show --verbose",
      "rr config get reviewer.agent",
      "rr config set maxIterations 8",
      "rr config set --local defaultReview.branch main",
      "rr config edit",
    ],
  },
  {
    name: "run",
    description: "Run review only and persist findings for later fixing",
    options: [
      { name: "max", alias: "m", type: "number", description: "Max iterations" },
      {
        name: "force",
        alias: "f",
        type: "boolean",
        description: "Run full max iterations even if no issues are found",
      },
      {
        name: "auto",
        type: "boolean",
        description: "Automatically run remediation after review completes",
      },
      {
        name: "priority",
        type: "string",
        placeholder: "P0,P1",
        description: "Priority filter for --auto using comma-separated values",
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
        name: "sound",
        type: "boolean",
        description: "Play a sound when session finishes (override config)",
      },
      {
        name: "no-sound",
        type: "boolean",
        description: "Disable finish sound for this run (override config)",
      },
    ],
    positional: [
      {
        name: "custom-instructions",
        description: "Additional review instructions to append to the selected review scope",
      },
    ],
    examples: [
      "rr run",
      "rr run --base main",
      "rr run --auto --priority P0,P1",
      'rr run --base main "focus on security"',
      "rr fix --session session-123 --priority P0,P1",
    ],
  },
  {
    name: "fix",
    description: "Fix selected findings from a persisted review session",
    options: [
      {
        name: "session",
        alias: "s",
        type: "string",
        description: "Session ID whose persisted findings should be fixed",
      },
      {
        name: "all",
        type: "boolean",
        description: "Select all persisted findings for remediation",
      },
      {
        name: "priority",
        type: "string",
        placeholder: "P0|P1|P2|P3",
        description: "Select findings by priority (repeatable)",
      },
      {
        name: "id",
        type: "string",
        placeholder: "F001",
        description: "Select findings by ID (repeatable)",
      },
    ],
    examples: [
      "rr fix --session session-123 --all",
      "rr fix --session session-123 --priority P0,P1",
      "rr fix --session session-123 --id F001 --id F003",
    ],
  },
  {
    name: "apply",
    description: "Apply a pending review handoff",
    options: [
      {
        name: "session",
        alias: "s",
        type: "string",
        description: "Apply a specific pending handoff in the current project",
      },
    ],
    examples: ["rr apply", "rr apply --session session-123"],
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
    hidden: true,
  },
  {
    name: "stop",
    description: "Stop running review session",
    options: [
      { name: "all", alias: "A", type: "boolean", description: "Stop all running review sessions" },
      {
        name: "session",
        alias: "s",
        type: "string",
        description: "Stop a specific session in the current project",
      },
    ],
    examples: ["rr stop", "rr stop --session session-123", "rr stop --all"],
  },
  {
    name: "log",
    description: "View review logs",
    options: [
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
    examples: ["rr log", "rr log -n 5", "rr log --json", "rr log --json --global"],
  },
  {
    name: "prune",
    description: "Prune orphaned review session artifacts",
    options: [
      {
        name: "dry-run",
        type: "boolean",
        description: "List prunable session artifacts without deleting them",
      },
      {
        name: "yes",
        alias: "y",
        type: "boolean",
        description: "Skip confirmation before deleting artifacts",
      },
      {
        name: "discard",
        type: "boolean",
        description: "Discard a pending review handoff in the current project",
      },
      {
        name: "session",
        alias: "s",
        type: "string",
        description: "Only inspect a specific session id",
      },
      {
        name: "older-than",
        type: "string",
        placeholder: "14d",
        description: "Only include prunable sessions older than the given age",
      },
      {
        name: "all-projects",
        type: "boolean",
        description: "Inspect review storage across all projects under ~/.config/ralph-review",
      },
      {
        name: "force",
        type: "boolean",
        description: "Allow destructive pruning for the targeted session",
      },
    ],
    examples: [
      "rr prune",
      "rr prune --dry-run",
      "rr prune -y",
      "rr prune --discard",
      "rr prune --discard --session session-123",
      "rr prune --session session-123 --force --yes",
      "rr prune --older-than 14d",
    ],
  },
  {
    name: "doctor",
    description: "Run environment and configuration diagnostics",
    options: [
      {
        name: "fix",
        type: "boolean",
        description: "Automatically fix issues that can be resolved",
      },
    ],
    examples: ["rr doctor", "rr doctor --fix"],
  },
  {
    name: "update",
    description: "Check for and install a newer ralph-review version",
    options: [
      {
        name: "check",
        type: "boolean",
        description: "Check for an update without installing it",
      },
      {
        name: "manager",
        type: "string",
        placeholder: "npm|brew",
        description: "Override install-source detection",
      },
    ],
    examples: [
      "rr update",
      "rr update --check",
      "rr update --manager npm",
      "rr update --manager brew",
    ],
  },
  {
    name: "_run-foreground",
    description: "Internal: run review session in tmux foreground",
    hidden: true,
    options: [
      { name: "max", type: "number", description: "Max iterations" },
      {
        name: "force",
        alias: "f",
        type: "boolean",
        description: "Run full max iterations even if no issues are found",
      },
      {
        name: "auto",
        type: "boolean",
        description: "Automatically run remediation after review completes",
      },
      {
        name: "priority",
        type: "string",
        placeholder: "P0,P1",
        description: "Priority filter for --auto using comma-separated values",
      },
    ],
  },
  {
    name: "_fix-foreground",
    description: "Internal: run fixer session in tmux foreground",
    hidden: true,
    options: [
      {
        name: "session",
        alias: "s",
        type: "string",
        description: "Session ID whose persisted findings should be fixed",
      },
      {
        name: "all",
        type: "boolean",
        description: "Select all persisted findings for remediation",
      },
      {
        name: "priority",
        type: "string",
        placeholder: "P0|P1|P2|P3",
        description: "Select findings by priority (repeatable)",
      },
      {
        name: "id",
        type: "string",
        placeholder: "F001",
        description: "Select findings by ID (repeatable)",
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
