import { describe, expect, test } from "bun:test";
import {
  COMMANDS,
  getCommandDef,
  getVersion,
  parseArgs,
  printCommandHelp,
  printUsage,
} from "@/cli";

describe("cli", () => {
  describe("parseArgs", () => {
    test("parses command correctly", () => {
      const result = parseArgs(["init"]);
      expect(result.command).toBe("init");
    });

    test("handles no command", () => {
      const result = parseArgs([]);
      expect(result.command).toBe("");
    });

    test("handles --help flag", () => {
      const result = parseArgs(["--help"]);
      expect(result.showHelp).toBe(true);
    });

    test("handles --version flag", () => {
      const result = parseArgs(["--version"]);
      expect(result.showVersion).toBe(true);
    });

    test("handles command with --help", () => {
      const result = parseArgs(["run", "--help"]);
      expect(result.command).toBe("run");
      expect(result.showHelp).toBe(true);
    });

    test("collects command arguments that are not help/version flags", () => {
      const result = parseArgs(["run", "--max", "5"]);
      expect(result.command).toBe("run");
      expect(result.args).toEqual(["--max", "5"]);
    });
  });

  describe("getVersion", () => {
    test("returns version string", () => {
      const version = getVersion();
      expect(typeof version).toBe("string");
      expect(version.length).toBeGreaterThan(0);
    });
  });

  describe("printUsage", () => {
    test("returns usage string with all public commands", () => {
      const usage = printUsage();
      expect(usage).toContain("ralph-review");
      expect(usage).toContain("init");
      expect(usage).toContain("config");
      expect(usage).toContain("run");
      expect(usage).toContain("list");
      expect(usage).toContain("status");
      expect(usage).toContain("stop");
      expect(usage).toContain("logs");
      expect(usage).toContain("dashboard");
      expect(usage).toContain("doctor");
    });

    test("excludes hidden commands from main help", () => {
      const usage = printUsage();
      expect(usage).not.toContain("_run-foreground");
    });

    test("includes version in help", () => {
      const usage = printUsage();
      const version = getVersion();
      expect(usage).toContain(version);
    });
  });

  describe("COMMANDS", () => {
    test("contains all expected commands", () => {
      const names = COMMANDS.map((c) => c.name);
      expect(names).toContain("init");
      expect(names).toContain("config");
      expect(names).toContain("run");
      expect(names).toContain("list");
      expect(names).toContain("status");
      expect(names).toContain("stop");
      expect(names).toContain("logs");
      expect(names).toContain("dashboard");
      expect(names).toContain("doctor");
      expect(names).toContain("_run-foreground");
    });

    test("run command has correct options", () => {
      const runCmd = COMMANDS.find((c) => c.name === "run");
      expect(runCmd).toBeDefined();
      const optionNames = runCmd?.options?.map((o) => o.name) ?? [];
      expect(optionNames).toContain("max");
      expect(optionNames).toContain("force");
      expect(optionNames).toContain("base");
      expect(optionNames).toContain("uncommitted");
      expect(optionNames).toContain("commit");
      expect(optionNames).toContain("custom");
      expect(optionNames).toContain("simplifier");
      expect(optionNames).toContain("sound");
      expect(optionNames).toContain("no-sound");
      expect(optionNames).not.toContain("list");
    });

    test("list command has ls alias", () => {
      const listCmd = COMMANDS.find((c) => c.name === "list");
      expect(listCmd).toBeDefined();
      expect(listCmd?.aliases).toContain("ls");
    });

    test("only config command defines positional args", () => {
      const publicCommands = COMMANDS.filter((c) => !c.hidden);
      for (const cmd of publicCommands) {
        if (cmd.name === "config") {
          expect(cmd.positional?.length).toBe(3);
          continue;
        }

        expect(cmd.positional).toBeUndefined();
      }
    });
  });

  describe("getCommandDef", () => {
    test("returns command definition for valid command", () => {
      const def = getCommandDef("run");
      expect(def).toBeDefined();
      expect(def?.name).toBe("run");
    });

    test("returns command definition when given alias", () => {
      const def = getCommandDef("ls");
      expect(def).toBeDefined();
      expect(def?.name).toBe("list");
    });

    test("returns undefined for invalid command", () => {
      const def = getCommandDef("nonexistent");
      expect(def).toBeUndefined();
    });
  });

  describe("printCommandHelp", () => {
    test("returns help for valid command", () => {
      const help = printCommandHelp("run");
      expect(help).toBeDefined();
      expect(help).toContain("--max");
    });

    test("returns help for config command", () => {
      const help = printCommandHelp("config");
      expect(help).toBeDefined();
      expect(help).toContain("rr config show");
      expect(help).toContain("rr config get reviewer.agent");
      expect(help).toContain("rr config set maxIterations 8");
      expect(help).toContain("rr config edit");
      expect(help).toContain("show = print full config");
      expect(help).toContain("get = read one key");
      expect(help).toContain("set = update one key");
      expect(help).toContain("edit = open in $EDITOR");
    });

    test("returns help for list command", () => {
      const help = printCommandHelp("list");
      expect(help).toBeDefined();
      expect(help).toContain("rr list");
      expect(help).toContain("rr ls");
    });

    test("returns help when given alias (ls -> list)", () => {
      const help = printCommandHelp("ls");
      expect(help).toBeDefined();
      expect(help).toContain("rr list");
      expect(help).toContain("rr ls");
    });

    test("returns undefined for invalid command", () => {
      const help = printCommandHelp("nonexistent");
      expect(help).toBeUndefined();
    });
  });
});
