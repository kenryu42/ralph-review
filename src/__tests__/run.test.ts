import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";

describe("run command", () => {
  describe("validatePrerequisites", () => {
    const { validatePrerequisites } = require("../commands/run");

    test("returns errors array", async () => {
      // This will likely return errors in test environment
      const result = await validatePrerequisites();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("isGitRepo", () => {
    const { isGitRepo } = require("../commands/run");

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
    const { hasUncommittedChanges } = require("../commands/run");

    test("returns boolean", async () => {
      const result = await hasUncommittedChanges();
      expect(typeof result).toBe("boolean");
    });
  });

  describe("createLockfile / removeLockfile", () => {
    const { createLockfile, removeLockfile, lockfileExists } = require("../commands/run");
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
