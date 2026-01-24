import { describe, expect, test } from "bun:test";
import { getVersion, parseArgs, printUsage } from "@/cli";

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
  });

  describe("getVersion", () => {
    test("returns version string", () => {
      const version = getVersion();
      expect(typeof version).toBe("string");
      expect(version.length).toBeGreaterThan(0);
    });
  });

  describe("printUsage", () => {
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
