/**
 * CLI argument parser utility
 * Provides standardized parsing for command-line options and positional arguments
 */

/**
 * CLI Error with structured information for helpful error messages
 */
export class CliError extends Error {
  constructor(
    public readonly command: string,
    public readonly type: "unknown_option" | "unexpected_argument" | "missing_required",
    public readonly arg: string,
    public readonly validOptions?: string[],
    public readonly suggestion?: string,
    public readonly expectedPositionalCount?: number
  ) {
    super(
      CliError.formatMessage(command, type, arg, validOptions, suggestion, expectedPositionalCount)
    );
    this.name = "CliError";
  }

  static formatMessage(
    command: string,
    type: "unknown_option" | "unexpected_argument" | "missing_required",
    arg: string,
    validOptions?: string[],
    suggestion?: string,
    expectedPositionalCount?: number
  ): string {
    const lines: string[] = [];

    if (type === "unknown_option") {
      lines.push(`${command}: unknown option "${arg}"`);
    } else if (type === "unexpected_argument") {
      lines.push(`${command}: unexpected argument "${arg}"`);
      if (expectedPositionalCount && expectedPositionalCount > 0) {
        lines.push(
          `This command takes at most ${expectedPositionalCount} positional argument${expectedPositionalCount > 1 ? "s" : ""}.`
        );
      } else {
        lines.push("This command does not take positional arguments.");
      }
    } else if (type === "missing_required") {
      lines.push(`${command}: missing required argument <${arg}>`);
    }

    if (suggestion) {
      lines.push(`Did you mean "${suggestion}"?`);
    }

    if (validOptions && validOptions.length > 0) {
      lines.push(`Valid options: ${validOptions.join(", ")}`);
    }

    lines.push(`Run: rr ${command} --help`);
    return lines.join("\n");
  }
}

/**
 * Suggest a correction for an unknown option based on valid options
 * Uses simple heuristics to detect common typos
 */
function suggestOption(input: string, validOptions: string[]): string | undefined {
  // Check for missing space (e.g., --max5 -> --max 5)
  for (const opt of validOptions) {
    if (input.startsWith(opt) && input.length > opt.length) {
      return `${opt} ${input.slice(opt.length)}`;
    }
  }

  // Check for prefix match (e.g., --ma -> --max)
  const inputWithoutDashes = input.replace(/^-+/, "");
  for (const opt of validOptions) {
    const optWithoutDashes = opt.replace(/^-+/, "");
    if (
      optWithoutDashes.startsWith(inputWithoutDashes) &&
      inputWithoutDashes.length >= 2 &&
      inputWithoutDashes.length < optWithoutDashes.length
    ) {
      return opt;
    }
  }

  return undefined;
}

/**
 * Option definition for a command
 */
export interface OptionDef {
  name: string;
  alias?: string;
  type: "boolean" | "string" | "number";
  description: string;
  default?: boolean | string | number;
  required?: boolean;
  placeholder?: string;
}

/**
 * Positional argument definition
 */
export interface PositionalDef {
  name: string;
  description: string;
  required?: boolean;
}

/**
 * Command definition
 */
export interface CommandDef {
  name: string;
  aliases?: string[];
  description: string;
  options?: OptionDef[];
  positional?: PositionalDef[];
  examples?: string[];
  hidden?: boolean;
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
 * Consume a value for a non-boolean option from argv
 */
function consumeOptionValue(
  opt: OptionDef,
  argv: string[],
  currentIndex: number,
  inlineValue?: string
): { value: string; nextIndex: number } {
  if (inlineValue !== undefined) {
    return { value: inlineValue, nextIndex: currentIndex };
  }
  const nextArg = argv[currentIndex + 1];
  if (nextArg !== undefined && (!nextArg.startsWith("-") || /^-\d/.test(nextArg))) {
    return { value: nextArg, nextIndex: currentIndex + 1 };
  }
  throw new Error(`Option --${opt.name} requires a value`);
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
    const arg = argv[i] as string;

    // Handle -- separator
    if (arg === "--" && !afterDoubleDash) {
      afterDoubleDash = true;
      i++;
      continue;
    }

    if (afterDoubleDash) {
      positional.push(arg);
      i++;
      continue;
    }

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
        const validOptions = options.map((o) => `--${o.name}`);
        const suggestion = suggestOption(arg, validOptions);
        throw new CliError(def.name, "unknown_option", arg, validOptions, suggestion);
      }

      if (opt.type === "boolean") {
        values[opt.name] = true;
      } else {
        const { value, nextIndex } = consumeOptionValue(opt, argv, i, inlineValue);
        i = nextIndex;
        values[opt.name] = parseValue(opt, value);
      }

      i++;
      continue;
    }

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
        const validOptions = options.map((o) =>
          o.alias ? `-${o.alias}, --${o.name}` : `--${o.name}`
        );
        throw new CliError(def.name, "unknown_option", `-${alias}`, validOptions);
      }

      if (opt.type === "boolean") {
        values[opt.name] = true;
      } else {
        const { value, nextIndex } = consumeOptionValue(opt, argv, i);
        i = nextIndex;
        values[opt.name] = parseValue(opt, value);
      }

      i++;
      continue;
    }

    positional.push(arg);
    i++;
  }

  for (const opt of options) {
    if (opt.required && values[opt.name] === undefined) {
      throw new Error(`Missing required option: --${opt.name}`);
    }
  }

  // Validate positional arguments
  const expectedPositionalCount = def.positional?.length ?? 0;

  // Check for unexpected positionals
  if (positional.length > expectedPositionalCount) {
    const unexpected = positional[expectedPositionalCount] as string;
    const validOptions = options.map((o) => `--${o.name}`);
    throw new CliError(
      def.name,
      "unexpected_argument",
      unexpected,
      validOptions,
      undefined,
      expectedPositionalCount
    );
  }

  // Check for missing required positionals
  if (def.positional) {
    for (let i = 0; i < def.positional.length; i++) {
      const posDef = def.positional[i];
      if (posDef?.required && positional[i] === undefined) {
        throw new CliError(def.name, "missing_required", posDef.name);
      }
    }
  }

  return { values: values as T, positional };
}

/**
 * Format help text for a single command
 */
export function formatCommandHelp(def: CommandDef): string {
  const lines: string[] = [];

  let usage = `rr ${def.name}`;
  if (def.positional?.length) {
    for (const pos of def.positional) {
      usage += pos.required ? ` <${pos.name}>` : ` [${pos.name}]`;
    }
  }
  if (def.options?.length) {
    usage += " [options]";
  }

  lines.push(`${def.description}`);
  lines.push("");
  lines.push("USAGE:");
  lines.push(`  ${usage}`);

  if (def.positional?.length) {
    lines.push("");
    lines.push("ARGUMENTS:");
    for (const pos of def.positional) {
      const req = pos.required ? " (required)" : "";
      lines.push(`  <${pos.name}>    ${pos.description}${req}`);
    }
  }

  if (def.options?.length) {
    lines.push("");
    lines.push("OPTIONS:");
    for (const opt of def.options) {
      const alias = opt.alias ? `-${opt.alias}, ` : "    ";
      const name = `--${opt.name}`;
      const valueHint =
        opt.type !== "boolean" ? ` <${opt.placeholder ?? opt.type.toUpperCase()}>` : "";
      const flag = `${alias}${name}${valueHint}`;

      const extras: string[] = [];
      if (opt.required) extras.push("required");
      if (opt.default !== undefined) extras.push(`default: ${opt.default}`);
      const extraStr = extras.length > 0 ? ` (${extras.join(", ")})` : "";

      lines.push(`  ${flag.padEnd(24)} ${opt.description}${extraStr}`);
    }
  }

  if (def.examples?.length) {
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
