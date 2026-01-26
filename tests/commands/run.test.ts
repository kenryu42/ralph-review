import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createLockfile,
  hasUncommittedChanges,
  isGitRepo,
  lockfileExists,
  parseRunOptions,
  removeLockfile,
  validatePrerequisites,
} from "@/commands/run";

describe("run command", () => {
  describe("parseRunOptions", () => {
    test("defaults to interactive mode (background: false)", () => {
      const result = parseRunOptions([]);
      expect(result.background).toBe(false);
      expect(result.list).toBe(false);
    });

    test("parses --background flag", () => {
      const result = parseRunOptions(["--background"]);
      expect(result.background).toBe(true);
    });

    test("parses -b shorthand", () => {
      const result = parseRunOptions(["-b"]);
      expect(result.background).toBe(true);
    });

    test("parses --list flag", () => {
      const result = parseRunOptions(["--list"]);
      expect(result.list).toBe(true);
    });

    test("parses -ls shorthand", () => {
      const result = parseRunOptions(["-ls"]);
      expect(result.list).toBe(true);
    });

    test("parses --max=N option", () => {
      const result = parseRunOptions(["--max=5"]);
      expect(result.maxIterations).toBe(5);
    });

    test("throws on conflicting --background and --list", () => {
      expect(() => parseRunOptions(["--background", "--list"])).toThrow();
      expect(() => parseRunOptions(["-b", "-ls"])).toThrow();
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

  describe("createLockfile / removeLockfile", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), "ralph-run-test-"));
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    test("createLockfile creates file", async () => {
      const lockPath = join(tempDir, "run.lock");
      await createLockfile(lockPath, "test-session");
      const exists = await Bun.file(lockPath).exists();
      expect(exists).toBe(true);
    });

    test("lockfileExists returns true when exists", async () => {
      const lockPath = join(tempDir, "run.lock");
      await createLockfile(lockPath, "test-session");
      const exists = await lockfileExists(lockPath);
      expect(exists).toBe(true);
    });

    test("lockfileExists returns false when not exists", async () => {
      const lockPath = join(tempDir, "nonexistent.lock");
      const exists = await lockfileExists(lockPath);
      expect(exists).toBe(false);
    });

    test("removeLockfile removes file", async () => {
      const lockPath = join(tempDir, "run.lock");
      await createLockfile(lockPath, "test-session");
      await removeLockfile(lockPath);
      const exists = await Bun.file(lockPath).exists();
      expect(exists).toBe(false);
    });
  });
});
