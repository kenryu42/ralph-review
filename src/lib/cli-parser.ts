/**
 * CLI argument parser utility
 * Provides standardized parsing for command-line options and positional arguments
 */

/**
 * Option definition for a command
 */
export interface OptionDef {
  name: string; // Long name: "background" -> --background
  alias?: string; // Single char: "b" -> -b
  type: "boolean" | "string" | "number";
  description: string;
  default?: boolean | string | number;
  required?: boolean;
}

/**
 * Positional argument definition
 */
export interface PositionalDef {
  name: string; // e.g., "session"
  description: string;
  required?: boolean; // defaults to false
}

/**
 * Command definition
 */
export interface CommandDef {
  name: string;
  aliases?: string[]; // e.g., ["ls"] for "list"
  description: string;
  options?: OptionDef[];
  positional?: PositionalDef[];
  examples?: string[];
  hidden?: boolean; // For internal commands
}

/**
 * Parse result with typed values
 */
export interface ParseResult<T = Record<string, unknown>> {
  values: T;
  positional: string[];
}

/**
 * Build lookup maps for options by long name and alias
 */
function buildOptionMaps(options: OptionDef[]): {
  byName: Map<string, OptionDef>;
  byAlias: Map<string, OptionDef>;
} {
  const byName = new Map<string, OptionDef>();
  const byAlias = new Map<string, OptionDef>();

  for (const opt of options) {
    byName.set(opt.name, opt);
    if (opt.alias) {
      byAlias.set(opt.alias, opt);
    }
  }

  return { byName, byAlias };
}

/**
 * Parse a value according to option type
 */
function parseValue(opt: OptionDef, value: string): boolean | string | number {
  switch (opt.type) {
    case "boolean":
      return true;
    case "number": {
      const num = Number(value);
      if (Number.isNaN(num)) {
        throw new Error(`Option --${opt.name} requires a number`);
      }
      return num;
    }
    case "string":
      return value;
  }
}

/**
 * Parse command line arguments against a command definition
 */
export function parseCommand<T = Record<string, unknown>>(
  def: CommandDef,
  argv: string[]
): ParseResult<T> {
  const options = def.options ?? [];
  const { byName, byAlias } = buildOptionMaps(options);

  // Initialize values with defaults
  const values: Record<string, unknown> = {};
  for (const opt of options) {
    if (opt.type === "boolean") {
      values[opt.name] = opt.default ?? false;
    } else if (opt.default !== undefined) {
      values[opt.name] = opt.default;
    }
  }

  const positional: string[] = [];
  let i = 0;
  let afterDoubleDash = false;

  while (i < argv.length) {
    const arg = argv[i];
    if (arg === undefined) {
      i++;
      continue;
    }

    // Handle -- separator
    if (arg === "--" && !afterDoubleDash) {
      afterDoubleDash = true;
      i++;
      continue;
    }

    // After --, everything is positional
    if (afterDoubleDash) {
      positional.push(arg);
      i++;
      continue;
    }

    // Long option: --name or --name=value
    if (arg.startsWith("--")) {
      const eqIndex = arg.indexOf("=");
      let name: string;
      let inlineValue: string | undefined;

      if (eqIndex !== -1) {
        name = arg.slice(2, eqIndex);
        inlineValue = arg.slice(eqIndex + 1);
      } else {
        name = arg.slice(2);
      }

      const opt = byName.get(name);
      if (!opt) {
        throw new Error(`Unknown option: --${name}`);
      }

      if (opt.type === "boolean") {
        values[opt.name] = true;
      } else {
        // Need a value
        let value: string;
        if (inlineValue !== undefined) {
          value = inlineValue;
        } else {
          const nextArg = argv[i + 1];
          if (nextArg !== undefined && !nextArg.startsWith("-")) {
            i++;
            value = nextArg;
          } else if (nextArg !== undefined && /^-\d/.test(nextArg)) {
            // Negative number
            i++;
            value = nextArg;
          } else {
            throw new Error(`Option --${opt.name} requires a value`);
          }
        }
        values[opt.name] = parseValue(opt, value);
      }

      i++;
      continue;
    }

    // Short option: -x or -x value
    if (arg.startsWith("-") && arg.length > 1) {
      const chars = arg.slice(1);

      // Multi-char short option is invalid (e.g., -ls)
      if (chars.length > 1) {
        throw new Error(
          `Invalid option: ${arg}. Use --${chars} for long options or ${chars
            .split("")
            .map((c) => `-${c}`)
            .join(" ")} for multiple short options`
        );
      }

      const alias = chars;
      const opt = byAlias.get(alias);
      if (!opt) {
        throw new Error(`Unknown option: -${alias}`);
      }

      if (opt.type === "boolean") {
        values[opt.name] = true;
      } else {
        // Need a value
        const nextArg = argv[i + 1];
        if (nextArg === undefined) {
          throw new Error(`Option --${opt.name} requires a value`);
        }
        // Allow negative numbers as values
        if (nextArg.startsWith("-") && !/^-\d/.test(nextArg)) {
          throw new Error(`Option --${opt.name} requires a value`);
        }
        i++;
        values[opt.name] = parseValue(opt, nextArg);
      }

      i++;
      continue;
    }

    // Positional argument
    positional.push(arg);
    i++;
  }

  // Check required options
  for (const opt of options) {
    if (opt.required && values[opt.name] === undefined) {
      throw new Error(`Missing required option: --${opt.name}`);
    }
  }

  return { values: values as T, positional };
}

/**
 * Format help text for a single command
 */
export function formatCommandHelp(def: CommandDef): string {
  const lines: string[] = [];

  // Usage line
  let usage = `rr ${def.name}`;
  if (def.positional && def.positional.length > 0) {
    for (const pos of def.positional) {
      usage += pos.required ? ` <${pos.name}>` : ` [${pos.name}]`;
    }
  }
  if (def.options && def.options.length > 0) {
    usage += " [options]";
  }

  lines.push(`${def.description}`);
  lines.push("");
  lines.push("USAGE:");
  lines.push(`  ${usage}`);

  // Positional arguments
  if (def.positional && def.positional.length > 0) {
    lines.push("");
    lines.push("ARGUMENTS:");
    for (const pos of def.positional) {
      const req = pos.required ? " (required)" : "";
      lines.push(`  <${pos.name}>    ${pos.description}${req}`);
    }
  }

  // Options
  if (def.options && def.options.length > 0) {
    lines.push("");
    lines.push("OPTIONS:");
    for (const opt of def.options) {
      const alias = opt.alias ? `-${opt.alias}, ` : "    ";
      const name = `--${opt.name}`;
      const valueHint = opt.type !== "boolean" ? ` <${opt.type}>` : "";
      const flag = `${alias}${name}${valueHint}`;

      const extras: string[] = [];
      if (opt.required) extras.push("required");
      if (opt.default !== undefined) extras.push(`default: ${opt.default}`);
      const extraStr = extras.length > 0 ? ` (${extras.join(", ")})` : "";

      lines.push(`  ${flag.padEnd(24)} ${opt.description}${extraStr}`);
    }
  }

  // Examples
  if (def.examples && def.examples.length > 0) {
    lines.push("");
    lines.push("EXAMPLES:");
    for (const ex of def.examples) {
      lines.push(`  ${ex}`);
    }
  }

  return lines.join("\n");
}

/**
 * Format main help text listing all commands
 */
export function formatMainHelp(commands: CommandDef[], version: string): string {
  const lines: string[] = [];

  lines.push(`ralph-review v${version} - Ralph Wiggum Code Review Orchestrator`);
  lines.push("");
  lines.push("USAGE:");
  lines.push("  rr <command> [options]");
  lines.push("  rrr           Quick alias for 'rr run'");
  lines.push("");
  lines.push("COMMANDS:");

  // Filter out hidden commands and format
  const publicCommands = commands.filter((c) => !c.hidden);

  // Calculate max display name length (including aliases like "list (ls)")
  const getDisplayName = (cmd: CommandDef): string =>
    cmd.aliases?.length ? `${cmd.name} (${cmd.aliases.join(", ")})` : cmd.name;
  const maxNameLen = Math.max(...publicCommands.map((c) => getDisplayName(c).length));

  for (const cmd of publicCommands) {
    const displayName = getDisplayName(cmd);
    lines.push(`  ${displayName.padEnd(maxNameLen + 2)} ${cmd.description}`);
  }

  lines.push("");
  lines.push("OPTIONS:");
  lines.push("  -h, --help      Show help for a command");
  lines.push("  -v, --version   Show version number");
  lines.push("");
  lines.push("Run 'rr <command> --help' for more information on a command.");

  return lines.join("\n");
}
