import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCommandDef } from "@/cli";
import {
  hasUncommittedChanges,
  isGitRepo,
  type RunOptions,
  validatePrerequisites,
} from "@/commands/run";
import { parseCommand } from "@/lib/cli-parser";
import { createLockfile, lockfileExists, removeLockfile } from "@/lib/lockfile";

describe("run command", () => {
  describe("option parsing via cli-parser", () => {
    const runDef = getCommandDef("run");
    if (!runDef) throw new Error("run command def not found");

    test("defaults to interactive mode (background: false)", () => {
      const { values } = parseCommand<RunOptions>(runDef, []);
      expect(values.background).toBe(false);
    });

    test("parses --background flag", () => {
      const { values } = parseCommand<RunOptions>(runDef, ["--background"]);
      expect(values.background).toBe(true);
    });

    test("parses -b shorthand", () => {
      const { values } = parseCommand<RunOptions>(runDef, ["-b"]);
      expect(values.background).toBe(true);
    });

    test("parses --max=N option", () => {
      const { values } = parseCommand<RunOptions>(runDef, ["--max=5"]);
      expect(values.max).toBe(5);
    });

    test("parses --max N option", () => {
      const { values } = parseCommand<RunOptions>(runDef, ["--max", "5"]);
      expect(values.max).toBe(5);
    });

    test("parses -m N shorthand", () => {
      const { values } = parseCommand<RunOptions>(runDef, ["-m", "3"]);
      expect(values.max).toBe(3);
    });
  });

  describe("validatePrerequisites", () => {
    test("returns errors array", async () => {
      // This will likely return errors in test environment
      const result = await validatePrerequisites();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("isGitRepo", () => {
    test("returns boolean", async () => {
      const result = await isGitRepo();
      expect(typeof result).toBe("boolean");
    });

    test("returns true in git repo", async () => {
      // We're in a git repo during tests
      const result = await isGitRepo();
      expect(result).toBe(true);
    });
  });

  describe("hasUncommittedChanges", () => {
    test("returns boolean", async () => {
      const result = await hasUncommittedChanges();
      expect(typeof result).toBe("boolean");
    });
  });

  describe("lockfile functions from @/lib/lockfile", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), "ralph-run-test-"));
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    test("createLockfile creates file", async () => {
      await createLockfile(tempDir, "/test/project", "main", "test-session");
      const exists = await lockfileExists(tempDir, "/test/project", "main");
      expect(exists).toBe(true);
    });

    test("lockfileExists returns true when exists", async () => {
      await createLockfile(tempDir, "/test/project", "main", "test-session");
      const exists = await lockfileExists(tempDir, "/test/project", "main");
      expect(exists).toBe(true);
    });

    test("lockfileExists returns false when not exists", async () => {
      const exists = await lockfileExists(tempDir, "/nonexistent/path", "main");
      expect(exists).toBe(false);
    });

    test("removeLockfile removes file", async () => {
      await createLockfile(tempDir, "/test/project", "main", "test-session");
      await removeLockfile(tempDir, "/test/project", "main");
      const exists = await lockfileExists(tempDir, "/test/project", "main");
      expect(exists).toBe(false);
    });
  });
});
