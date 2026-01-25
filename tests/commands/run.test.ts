import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createLockfile,
  hasUncommittedChanges,
  isGitRepo,
  lockfileExists,
  removeLockfile,
  validatePrerequisites,
} from "@/commands/run";

describe("run command", () => {
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
