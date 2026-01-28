import { describe, expect, test } from "bun:test";
import { type CommandDef, formatCommandHelp, formatMainHelp, parseCommand } from "@/lib/cli-parser";

// Test command definitions
const simpleCommand: CommandDef = {
  name: "test",
  description: "A test command",
  options: [{ name: "verbose", alias: "v", type: "boolean", description: "Enable verbose output" }],
};

const commandWithValues: CommandDef = {
  name: "run",
  description: "Run something",
  options: [
    { name: "force", alias: "f", type: "boolean", description: "Force operation" },
    { name: "list", alias: "l", type: "boolean", description: "List items" },
    { name: "max", alias: "m", type: "number", description: "Max iterations", default: 5 },
    { name: "output", alias: "o", type: "string", description: "Output file" },
  ],
  examples: ["rr run", "rr run --max=3"],
};

const commandWithPositional: CommandDef = {
  name: "connect",
  description: "Connect to session",
  positional: [{ name: "session", description: "Session name to connect to" }],
};

const commandWithRequiredOption: CommandDef = {
  name: "deploy",
  description: "Deploy to target",
  options: [
    { name: "target", alias: "t", type: "string", description: "Deploy target", required: true },
  ],
};

const hiddenCommand: CommandDef = {
  name: "_internal",
  description: "Internal command",
  hidden: true,
};

describe("cli-parser", () => {
  describe("parseCommand", () => {
    describe("boolean flags", () => {
      test("parses --flag correctly", () => {
        const result = parseCommand(simpleCommand, ["--verbose"]);
        expect(result.values.verbose).toBe(true);
      });

      test("parses -f alias correctly", () => {
        const result = parseCommand(simpleCommand, ["-v"]);
        expect(result.values.verbose).toBe(true);
      });

      test("defaults boolean to false when not provided", () => {
        const result = parseCommand(simpleCommand, []);
        expect(result.values.verbose).toBe(false);
      });

      test("parses multiple boolean flags", () => {
        const result = parseCommand(commandWithValues, ["-f", "--list"]);
        expect(result.values.force).toBe(true);
        expect(result.values.list).toBe(true);
      });
    });

    describe("value flags", () => {
      test("parses --key=value correctly", () => {
        const result = parseCommand(commandWithValues, ["--max=10"]);
        expect(result.values.max).toBe(10);
      });

      test("parses --key value correctly", () => {
        const result = parseCommand(commandWithValues, ["--max", "10"]);
        expect(result.values.max).toBe(10);
      });

      test("parses -k value correctly", () => {
        const result = parseCommand(commandWithValues, ["-m", "10"]);
        expect(result.values.max).toBe(10);
      });

      test("parses string value with --key=value", () => {
        const result = parseCommand(commandWithValues, ["--output=file.txt"]);
        expect(result.values.output).toBe("file.txt");
      });

      test("parses string value with --key value", () => {
        const result = parseCommand(commandWithValues, ["--output", "file.txt"]);
        expect(result.values.output).toBe("file.txt");
      });

      test("parses string value with -o value", () => {
        const result = parseCommand(commandWithValues, ["-o", "file.txt"]);
        expect(result.values.output).toBe("file.txt");
      });
    });

    describe("default values", () => {
      test("applies default values when option not provided", () => {
        const result = parseCommand(commandWithValues, []);
        expect(result.values.max).toBe(5);
      });

      test("overrides default with provided value", () => {
        const result = parseCommand(commandWithValues, ["--max=3"]);
        expect(result.values.max).toBe(3);
      });
    });

    describe("positional arguments", () => {
      test("captures positional after flags", () => {
        const result = parseCommand(commandWithPositional, ["mysession"]);
        expect(result.positional).toEqual(["mysession"]);
      });

      test("captures positional mixed with flags", () => {
        const result = parseCommand(commandWithValues, ["--list", "arg1", "arg2"]);
        expect(result.values.list).toBe(true);
        expect(result.positional).toEqual(["arg1", "arg2"]);
      });

      test("treats args after -- as positional", () => {
        const result = parseCommand(simpleCommand, ["--", "--not-a-flag"]);
        expect(result.positional).toEqual(["--not-a-flag"]);
      });

      test("handles multiple positional args in order", () => {
        const result = parseCommand(commandWithPositional, ["first", "second", "third"]);
        expect(result.positional).toEqual(["first", "second", "third"]);
      });
    });

    describe("error handling", () => {
      test("throws on unknown long flag", () => {
        expect(() => parseCommand(simpleCommand, ["--invalid"])).toThrow(
          "Unknown option: --invalid"
        );
      });

      test("throws on unknown short flag", () => {
        expect(() => parseCommand(simpleCommand, ["-x"])).toThrow("Unknown option: -x");
      });

      test("throws on multi-char short flag", () => {
        expect(() => parseCommand(simpleCommand, ["-ls"])).toThrow(
          "Invalid option: -ls. Use --ls for long options or -l -s for multiple short options"
        );
      });

      test("throws on missing required option", () => {
        expect(() => parseCommand(commandWithRequiredOption, [])).toThrow(
          "Missing required option: --target"
        );
      });

      test("throws on missing value for non-boolean option", () => {
        expect(() => parseCommand(commandWithValues, ["--max"])).toThrow(
          "Option --max requires a value"
        );
      });

      test("throws on invalid number value", () => {
        expect(() => parseCommand(commandWithValues, ["--max=abc"])).toThrow(
          "Option --max requires a number"
        );
      });
    });

    describe("type coercion", () => {
      test("coerces number type from string", () => {
        const result = parseCommand(commandWithValues, ["--max=42"]);
        expect(result.values.max).toBe(42);
        expect(typeof result.values.max).toBe("number");
      });

      test("handles negative numbers", () => {
        const result = parseCommand(commandWithValues, ["--max=-5"]);
        expect(result.values.max).toBe(-5);
      });

      test("handles decimal numbers", () => {
        const result = parseCommand(commandWithValues, ["--max=3.14"]);
        expect(result.values.max).toBe(3.14);
      });
    });

    describe("edge cases", () => {
      test("handles empty argv", () => {
        const result = parseCommand(simpleCommand, []);
        expect(result.values.verbose).toBe(false);
        expect(result.positional).toEqual([]);
      });

      test("handles value with equals sign", () => {
        const result = parseCommand(commandWithValues, ["--output=path=with=equals"]);
        expect(result.values.output).toBe("path=with=equals");
      });

      test("handles empty string value", () => {
        const result = parseCommand(commandWithValues, ["--output="]);
        expect(result.values.output).toBe("");
      });
    });
  });

  describe("formatCommandHelp", () => {
    test("includes command name and description", () => {
      const help = formatCommandHelp(simpleCommand);
      expect(help).toContain("test");
      expect(help).toContain("A test command");
    });

    test("formats options with aliases", () => {
      const help = formatCommandHelp(simpleCommand);
      expect(help).toContain("--verbose");
      expect(help).toContain("-v");
    });

    test("shows option descriptions", () => {
      const help = formatCommandHelp(simpleCommand);
      expect(help).toContain("Enable verbose output");
    });

    test("shows default values", () => {
      const help = formatCommandHelp(commandWithValues);
      expect(help).toContain("default: 5");
    });

    test("marks required options", () => {
      const help = formatCommandHelp(commandWithRequiredOption);
      expect(help).toContain("required");
    });

    test("shows examples when provided", () => {
      const help = formatCommandHelp(commandWithValues);
      expect(help).toContain("rr run");
      expect(help).toContain("rr run --max=3");
    });

    test("shows positional arguments", () => {
      const help = formatCommandHelp(commandWithPositional);
      expect(help).toContain("<session>");
    });
  });

  describe("formatMainHelp", () => {
    const commands: CommandDef[] = [simpleCommand, commandWithValues, hiddenCommand];

    test("lists all public commands", () => {
      const help = formatMainHelp(commands, "1.0.0");
      expect(help).toContain("test");
      expect(help).toContain("run");
    });

    test("excludes hidden commands", () => {
      const help = formatMainHelp(commands, "1.0.0");
      expect(help).not.toContain("_internal");
    });

    test("includes version", () => {
      const help = formatMainHelp(commands, "2.5.0");
      expect(help).toContain("2.5.0");
    });
  });
});
