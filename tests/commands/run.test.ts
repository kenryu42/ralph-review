import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCommandDef } from "@/cli";
import {
  classifyRunCompletion,
  formatRunAgentsNote,
  type RunOptions,
  resolveRunSimplifierEnabled,
  resolveRunSoundOverride,
} from "@/commands/run";
import { parseCommand } from "@/lib/cli-parser";
import { runDiagnostics } from "@/lib/diagnostics";
import { createLockfile, lockfileExists, removeLockfile } from "@/lib/lockfile";
import type { Config } from "@/lib/types";
import { createCapabilities, createConfig } from "../helpers/diagnostics";

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

    test("parses --simplifier option", () => {
      const { values } = parseCommand<RunOptions>(runDef, ["--simplifier"]);
      expect(values.simplifier).toBe(true);
    });

    test("parses --sound option", () => {
      const { values } = parseCommand<RunOptions>(runDef, ["--sound"]);
      expect(values.sound).toBe(true);
    });

    test("parses --no-sound option", () => {
      const { values } = parseCommand<RunOptions>(runDef, ["--no-sound"]);
      expect(values["no-sound"]).toBe(true);
    });
  });

  describe("resolveRunSoundOverride", () => {
    test("returns on for --sound", () => {
      expect(resolveRunSoundOverride({ sound: true })).toBe("on");
    });

    test("returns off for --no-sound", () => {
      expect(resolveRunSoundOverride({ "no-sound": true })).toBe("off");
    });

    test("returns undefined when no overrides are set", () => {
      expect(resolveRunSoundOverride({})).toBeUndefined();
    });

    test("throws when both sound overrides are provided", () => {
      expect(() => resolveRunSoundOverride({ sound: true, "no-sound": true })).toThrow(
        "Cannot use --sound and --no-sound together"
      );
    });
  });

  describe("resolveRunSimplifierEnabled", () => {
    test("returns true when --simplifier is passed even if config is false", () => {
      const config = {
        ...createConfig(),
        run: { simplifier: false },
      } satisfies Config;
      expect(resolveRunSimplifierEnabled({ simplifier: true }, config)).toBe(true);
    });

    test("uses config default when --simplifier is not passed", () => {
      const config = {
        ...createConfig(),
        run: { simplifier: true },
      } satisfies Config;
      expect(resolveRunSimplifierEnabled({}, config)).toBe(true);
    });

    test("defaults to false when config run settings are missing", () => {
      const config = {
        ...createConfig(),
      };
      delete config.run;

      expect(resolveRunSimplifierEnabled({}, config)).toBe(false);
      expect(resolveRunSimplifierEnabled({}, null)).toBe(false);
    });
  });

  describe("formatRunAgentsNote", () => {
    test("includes Simplifier line when simplifier is enabled with configured code-simplifier", () => {
      const config = createConfig();

      const note = formatRunAgentsNote(config, {
        simplifier: true,
      });

      expect(note).toContain("Reviewer:");
      expect(note).toContain("Fixer:");
      expect(note).toContain("Simplifier: Droid");
      expect(note).toContain("Review:");
    });

    test("falls back to reviewer details when code-simplifier is not configured", () => {
      const config = createConfig();
      delete config["code-simplifier"];

      const note = formatRunAgentsNote(config, {
        simplifier: true,
      });

      expect(note).toContain("Simplifier: Codex");
    });

    test("omits Simplifier line when simplifier is disabled", () => {
      const config = createConfig();

      const note = formatRunAgentsNote(config, {
        simplifier: false,
      });

      expect(note).not.toContain("Simplifier:");
    });
  });

  describe("run diagnostics integration", () => {
    test("fails when configured dynamic model is unavailable", async () => {
      const capabilities = createCapabilities();
      const config = createConfig();
      config.reviewer = {
        agent: "opencode",
        model: "missing-model",
      };

      const report = await runDiagnostics("run", {
        capabilitiesByAgent: capabilities,
        dependencies: {
          configExists: async () => true,
          loadConfig: async () => config,
          isGitRepository: async () => true,
          hasUncommittedChanges: async () => true,
          cleanupStaleLockfile: async () => false,
          hasActiveLockfile: async () => false,
          isTmuxInstalled: () => true,
        },
      });

      expect(report.hasErrors).toBe(true);
      expect(report.items.some((item) => item.id === "config-reviewer-model-missing")).toBe(true);
    });

    test("keeps warnings non-blocking", async () => {
      const capabilities = createCapabilities();
      capabilities.opencode.probeWarnings = ["probe warning"];

      const report = await runDiagnostics("run", {
        capabilitiesByAgent: capabilities,
        dependencies: {
          configExists: async () => true,
          loadConfig: async () => createConfig(),
          isGitRepository: async () => true,
          hasUncommittedChanges: async () => true,
          cleanupStaleLockfile: async () => false,
          hasActiveLockfile: async () => false,
          isTmuxInstalled: () => true,
        },
      });

      expect(report.hasErrors).toBe(false);
      expect(report.hasWarnings).toBe(true);
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
