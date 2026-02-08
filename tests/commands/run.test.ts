import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCommandDef } from "@/cli";
import {
  classifyRunCompletion,
  hasUncommittedChanges,
  isGitRepo,
  type RunOptions,
  validatePrerequisites,
} from "@/commands/run";
import { parseCommand } from "@/lib/cli-parser";
import { createLockfile, lockfileExists, removeLockfile } from "@/lib/lockfile";

describe("run command", () => {
  describe("classifyRunCompletion", () => {
    test("returns success for clean run", () => {
      const state = classifyRunCompletion({
        success: true,
        finalStatus: "completed",
        iterations: 2,
        reason: "No issues found - code is clean",
        sessionPath: "/tmp/session",
      });
      expect(state).toBe("success");
    });

    test("returns warning for max-iteration completion with remaining issues", () => {
      const state = classifyRunCompletion({
        success: false,
        finalStatus: "completed",
        iterations: 5,
        reason: "Max iterations (5) reached - some issues may remain",
        sessionPath: "/tmp/session",
      });
      expect(state).toBe("warning");
    });

    test("returns warning for interrupted runs", () => {
      const state = classifyRunCompletion({
        success: false,
        finalStatus: "interrupted",
        iterations: 3,
        reason: "Review cycle was interrupted",
        sessionPath: "/tmp/session",
      });
      expect(state).toBe("warning");
    });

    test("returns error for failed terminal result", () => {
      const state = classifyRunCompletion({
        success: false,
        finalStatus: "failed",
        iterations: 1,
        reason: "Reviewer failed with exit code 1",
        sessionPath: "/tmp/session",
      });
      expect(state).toBe("error");
    });
  });

  describe("option parsing via cli-parser", () => {
    const runDef = getCommandDef("run");
    if (!runDef) throw new Error("run command def not found");

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

    test("parses --force option", () => {
      const { values } = parseCommand<RunOptions>(runDef, ["--force"]);
      expect(values.force).toBe(true);
    });

    test("parses -f shorthand", () => {
      const { values } = parseCommand<RunOptions>(runDef, ["-f"]);
      expect(values.force).toBe(true);
    });

    test("parses --commit option", () => {
      const { values } = parseCommand<RunOptions>(runDef, ["--commit", "abc123"]);
      expect(values.commit).toBe("abc123");
    });

    test("parses --custom option", () => {
      const { values } = parseCommand<RunOptions>(runDef, ["--custom", "Focus on security"]);
      expect(values.custom).toBe("Focus on security");
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
      await createLockfile(tempDir, "/test/project", "test-session", "main");
      const exists = await lockfileExists(tempDir, "/test/project");
      expect(exists).toBe(true);
    });

    test("lockfileExists returns true when exists", async () => {
      await createLockfile(tempDir, "/test/project", "test-session", "main");
      const exists = await lockfileExists(tempDir, "/test/project");
      expect(exists).toBe(true);
    });

    test("lockfileExists returns false when not exists", async () => {
      const exists = await lockfileExists(tempDir, "/nonexistent/path");
      expect(exists).toBe(false);
    });

    test("removeLockfile removes file", async () => {
      await createLockfile(tempDir, "/test/project", "test-session", "main");
      await removeLockfile(tempDir, "/test/project");
      const exists = await lockfileExists(tempDir, "/test/project");
      expect(exists).toBe(false);
    });
  });
});
