import { test, expect, describe } from "bun:test";

describe("cli", () => {
  describe("parseArgs", () => {
    const { parseArgs } = require("../cli");

    test("parses command correctly", () => {
      const result = parseArgs(["init"]);
      expect(result.command).toBe("init");
    });

    test("parses flags correctly", () => {
      const result = parseArgs(["run", "--review-only"]);
      expect(result.command).toBe("run");
      expect(result.args).toContain("--review-only");
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
  });

  describe("getVersion", () => {
    const { getVersion } = require("../cli");

    test("returns version string", () => {
      const version = getVersion();
      expect(typeof version).toBe("string");
      expect(version.length).toBeGreaterThan(0);
    });
  });

  describe("printUsage", () => {
    const { printUsage } = require("../cli");

    test("returns usage string", () => {
      const usage = printUsage();
      expect(usage).toContain("ralph-review");
      expect(usage).toContain("init");
      expect(usage).toContain("run");
      expect(usage).toContain("attach");
      expect(usage).toContain("status");
      expect(usage).toContain("stop");
      expect(usage).toContain("logs");
    });
  });
});
