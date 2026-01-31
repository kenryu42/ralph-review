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

const commandWithMultiplePositionals: CommandDef = {
  name: "copy",
  description: "Copy files",
  positional: [
    { name: "source", description: "Source file" },
    { name: "dest", description: "Destination file" },
    { name: "extra", description: "Extra arg" },
  ],
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
        const cmdWithTwoPositionals: CommandDef = {
          name: "copy",
          description: "Copy files",
          options: [
            { name: "force", alias: "f", type: "boolean", description: "Force operation" },
            { name: "list", alias: "l", type: "boolean", description: "List items" },
          ],
          positional: [
            { name: "source", description: "Source file" },
            { name: "dest", description: "Destination file" },
          ],
        };
        const result = parseCommand(cmdWithTwoPositionals, ["--list", "arg1", "arg2"]);
        expect(result.values.list).toBe(true);
        expect(result.positional).toEqual(["arg1", "arg2"]);
      });

      test("treats args after -- as positional", () => {
        const result = parseCommand(commandWithPositional, ["--", "--not-a-flag"]);
        expect(result.positional).toEqual(["--not-a-flag"]);
      });

      test("handles multiple positional args in order", () => {
        const result = parseCommand(commandWithMultiplePositionals, ["first", "second", "third"]);
        expect(result.positional).toEqual(["first", "second", "third"]);
      });
    });

    describe("positional argument validation", () => {
      test("throws on unexpected positional for command without positional def", () => {
        expect(() => parseCommand(simpleCommand, ["unexpected"])).toThrow(
          /unexpected argument "unexpected"/
        );
      });

      test("throws on multiple unexpected positionals (reports first)", () => {
        expect(() => parseCommand(simpleCommand, ["a", "b", "c"])).toThrow(
          /unexpected argument "a"/
        );
      });

      test("throws on positional args after --", () => {
        expect(() => parseCommand(simpleCommand, ["--", "extra"])).toThrow(
          /unexpected argument "extra"/
        );
      });

      test("throws on positional that looks like a command", () => {
        expect(() => parseCommand(simpleCommand, ["init"])).toThrow(/unexpected argument "init"/);
      });

      test("accepts positional for command with positional def", () => {
        const result = parseCommand(commandWithPositional, ["mysession"]);
        expect(result.positional).toEqual(["mysession"]);
      });

      test("throws on extra positional beyond defined count", () => {
        expect(() => parseCommand(commandWithPositional, ["a", "b"])).toThrow(
          /unexpected argument "b"/
        );
      });

      test("throws when required positional is missing", () => {
        const cmdWithRequired: CommandDef = {
          name: "test",
          description: "Test",
          positional: [{ name: "target", description: "Target", required: true }],
        };
        expect(() => parseCommand(cmdWithRequired, [])).toThrow(
          /missing required argument <target>/
        );
      });

      test("allows missing optional positional", () => {
        const result = parseCommand(commandWithPositional, []);
        expect(result.positional).toEqual([]);
      });
    });

    describe("error message quality", () => {
      test("unknown option includes command name", () => {
        expect.assertions(3);
        try {
          parseCommand(commandWithValues, ["--invalid"]);
        } catch (e) {
          expect((e as Error).message).toContain("run");
          expect((e as Error).message).toContain("unknown option");
          expect((e as Error).message).toContain("--invalid");
        }
      });

      test("unknown option suggests similar option", () => {
        expect.assertions(2);
        // --max5 should suggest --max
        try {
          parseCommand(commandWithValues, ["--max5"]);
        } catch (e) {
          expect((e as Error).message).toContain("Did you mean");
          expect((e as Error).message).toContain("--max 5");
        }
      });

      test("unknown option shows valid options", () => {
        expect.assertions(2);
        try {
          parseCommand(commandWithValues, ["--invalid"]);
        } catch (e) {
          expect((e as Error).message).toContain("--force");
          expect((e as Error).message).toContain("--list");
        }
      });

      test("unexpected positional includes command name", () => {
        expect.assertions(2);
        try {
          parseCommand(simpleCommand, ["extra"]);
        } catch (e) {
          expect((e as Error).message).toContain("test");
          expect((e as Error).message).toContain("unexpected argument");
        }
      });

      test("unexpected positional states no positionals allowed", () => {
        expect.assertions(1);
        try {
          parseCommand(simpleCommand, ["extra"]);
        } catch (e) {
          expect((e as Error).message).toMatch(/does not (take|accept) positional/i);
        }
      });
    });

    describe("error handling", () => {
      test("throws on unknown long flag", () => {
        expect(() => parseCommand(simpleCommand, ["--invalid"])).toThrow(
          /unknown option "--invalid"/
        );
      });

      test("throws on unknown short flag", () => {
        expect(() => parseCommand(simpleCommand, ["-x"])).toThrow(/unknown option "-x"/);
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
