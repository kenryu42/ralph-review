import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendLog,
  buildDashboardData,
  computeProjectStats,
  computeSessionStats,
  createLogSession,
  generateLogFilename,
  getGitBranch,
  getProjectName,
  listLogSessions,
  listProjectLogSessions,
  readLog,
  sanitizeForFilename,
} from "@/lib/logger";
import type { IterationEntry, SystemEntry } from "@/lib/types";

describe("logger", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ralph-logger-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("sanitizeForFilename", () => {
    test("replaces filesystem-unsafe characters", () => {
      expect(sanitizeForFilename("foo/bar")).toBe("foo-bar");
      expect(sanitizeForFilename("foo\\bar")).toBe("foo-bar");
      expect(sanitizeForFilename("foo:bar")).toBe("foo-bar");
      expect(sanitizeForFilename("foo*bar")).toBe("foo-bar");
    });

    test("replaces whitespace with hyphens", () => {
      expect(sanitizeForFilename("foo bar")).toBe("foo-bar");
      expect(sanitizeForFilename("foo  bar")).toBe("foo-bar");
    });

    test("collapses multiple hyphens", () => {
      expect(sanitizeForFilename("foo---bar")).toBe("foo-bar");
      expect(sanitizeForFilename("foo//:bar")).toBe("foo-bar");
    });

    test("trims leading/trailing hyphens", () => {
      expect(sanitizeForFilename("-foo-")).toBe("foo");
      expect(sanitizeForFilename("---foo---")).toBe("foo");
    });

    test("converts to lowercase", () => {
      expect(sanitizeForFilename("FooBar")).toBe("foobar");
    });
  });

  describe("getProjectName", () => {
    test("uses full path for uniqueness", () => {
      expect(getProjectName("/Users/ken/projects/my-app")).toBe("users-ken-projects-my-app");
    });

    test("sanitizes the full path", () => {
      expect(getProjectName("/path/to/My Project")).toBe("path-to-my-project");
    });

    test("returns unknown-project for root path", () => {
      expect(getProjectName("/")).toBe("unknown-project");
    });

    test("differentiates same-name folders in different locations", () => {
      const a = getProjectName("/work/api");
      const b = getProjectName("/personal/api");
      expect(a).not.toBe(b);
      expect(a).toBe("work-api");
      expect(b).toBe("personal-api");
    });
  });

  describe("generateLogFilename", () => {
    test("generates filename with timestamp only", () => {
      const date = new Date("2024-01-15T10:30:00.000Z");
      const filename = generateLogFilename(date);
      expect(filename).toBe("2024-01-15T10-30-00.jsonl");
    });

    test("includes sanitized branch in filename", () => {
      const date = new Date("2024-01-15T10:30:00.000Z");
      const filename = generateLogFilename(date, "main");
      expect(filename).toBe("2024-01-15T10-30-00_main.jsonl");
    });

    test("sanitizes branch name with slashes", () => {
      const date = new Date("2024-01-15T10:30:00.000Z");
      const filename = generateLogFilename(date, "feature/auth");
      expect(filename).toBe("2024-01-15T10-30-00_feature-auth.jsonl");
    });
  });

  describe("getGitBranch", () => {
    test("returns undefined for non-git directory", async () => {
      const branch = await getGitBranch(tempDir);
      expect(branch).toBeUndefined();
    });

    // Note: testing actual git branch detection requires a real git repo
    // which we skip in unit tests
  });

  describe("createLogSession", () => {
    test("creates project directory and returns log file path", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/my-project");
      expect(logPath).toContain("my-project");
      expect(logPath).toEndWith(".jsonl");
    });

    test("includes branch in filename when provided", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/my-project", "main");
      expect(logPath).toContain("_main.jsonl");
    });
  });

  describe("appendLog and readLog", () => {
    test("appends and reads system entry", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project");

      const entry: SystemEntry = {
        type: "system",
        timestamp: Date.now(),
        projectPath: "/path/to/project",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      };

      await appendLog(logPath, entry);
      const entries = await readLog(logPath);

      expect(entries.length).toBe(1);
      expect(entries[0]?.type).toBe("system");
      const systemEntry = entries[0] as SystemEntry;
      expect(systemEntry.projectPath).toBe("/path/to/project");
    });

    test("appends and reads iteration entry", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project");

      const entry: IterationEntry = {
        type: "iteration",
        timestamp: Date.now(),
        iteration: 1,
        duration: 5000,
        fixes: {
          decision: "APPLY_SELECTIVELY",
          fixes: [],
          skipped: [],
        },
      };

      await appendLog(logPath, entry);
      const entries = await readLog(logPath);

      expect(entries.length).toBe(1);
      expect(entries[0]?.type).toBe("iteration");
      const iterEntry = entries[0] as IterationEntry;
      expect(iterEntry.iteration).toBe(1);
      expect(iterEntry.fixes?.decision).toBe("APPLY_SELECTIVELY");
    });

    test("appends multiple entries", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project");

      const systemEntry: SystemEntry = {
        type: "system",
        timestamp: Date.now(),
        projectPath: "/path/to/project",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      };

      const iterEntry: IterationEntry = {
        type: "iteration",
        timestamp: Date.now(),
        iteration: 1,
      };

      await appendLog(logPath, systemEntry);
      await appendLog(logPath, iterEntry);

      const entries = await readLog(logPath);
      expect(entries.length).toBe(2);
      expect(entries[0]?.type).toBe("system");
      expect(entries[1]?.type).toBe("iteration");
    });
  });

  describe("listLogSessions", () => {
    test("lists sessions across projects sorted by timestamp descending", async () => {
      // Create sessions and write entries to create the files
      const logA = await createLogSession(tempDir, "/path/to/project-a");
      const entryA: SystemEntry = {
        type: "system",
        timestamp: Date.now(),
        projectPath: "/path/to/project-a",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      };
      await appendLog(logA, entryA);

      await new Promise((r) => setTimeout(r, 10)); // Small delay for different timestamps

      const logB = await createLogSession(tempDir, "/path/to/project-b");
      const entryB: SystemEntry = {
        type: "system",
        timestamp: Date.now(),
        projectPath: "/path/to/project-b",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      };
      await appendLog(logB, entryB);

      const sessions = await listLogSessions(tempDir);
      expect(sessions.length).toBe(2);
      // Most recent first - now uses full sanitized path
      expect(sessions[0]?.projectName).toBe("path-to-project-b");
    });

    test("returns empty array when no sessions", async () => {
      const sessions = await listLogSessions(tempDir);
      expect(sessions).toEqual([]);
    });
  });

  describe("listProjectLogSessions", () => {
    test("lists sessions for specific project only", async () => {
      // Create sessions and write entries to create the files
      const logA1 = await createLogSession(tempDir, "/path/to/project-a");
      await appendLog(logA1, {
        type: "system",
        timestamp: Date.now(),
        projectPath: "/path/to/project-a",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      } as SystemEntry);

      const logB = await createLogSession(tempDir, "/path/to/project-b");
      await appendLog(logB, {
        type: "system",
        timestamp: Date.now(),
        projectPath: "/path/to/project-b",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      } as SystemEntry);

      await new Promise((r) => setTimeout(r, 10)); // Small delay

      const logA2 = await createLogSession(tempDir, "/path/to/project-a", "feature");
      await appendLog(logA2, {
        type: "system",
        timestamp: Date.now(),
        projectPath: "/path/to/project-a",
        gitBranch: "feature",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      } as SystemEntry);

      const sessions = await listProjectLogSessions(tempDir, "/path/to/project-a");
      expect(sessions.length).toBe(2);
      // Now uses full sanitized path
      expect(sessions.every((s) => s.projectName === "path-to-project-a")).toBe(true);
    });
  });

  describe("computeSessionStats", () => {
    test("computes stats from session with fixes", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project", "main");

      const systemEntry: SystemEntry = {
        type: "system",
        timestamp: Date.now(),
        projectPath: "/path/to/project",
        gitBranch: "main",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      };

      const iterEntry: IterationEntry = {
        type: "iteration",
        timestamp: Date.now(),
        iteration: 1,
        fixes: {
          decision: "APPLY_SELECTIVELY",
          fixes: [
            {
              id: 1,
              title: "Fix null check",
              priority: "P0",
              file: "auth.ts",
              claim: "Missing null check",
              evidence: "auth.ts:42",
              fix: "Added null check",
            },
            {
              id: 2,
              title: "Add validation",
              priority: "P1",
              file: "form.ts",
              claim: "Missing validation",
              evidence: "form.ts:10",
              fix: "Added validation",
            },
          ],
          skipped: [{ id: 3, title: "Minor style", reason: "Not important" }],
        },
      };

      await appendLog(logPath, systemEntry);
      await appendLog(logPath, iterEntry);

      const session = {
        path: logPath,
        name: "test.jsonl",
        projectName: "path-to-project",
        timestamp: Date.now(),
      };
      const stats = await computeSessionStats(session);

      expect(stats.totalFixes).toBe(2);
      expect(stats.totalSkipped).toBe(1);
      expect(stats.priorityCounts.P0).toBe(1);
      expect(stats.priorityCounts.P1).toBe(1);
      expect(stats.priorityCounts.P2).toBe(0);
      expect(stats.priorityCounts.P3).toBe(0);
      expect(stats.iterations).toBe(1);
      expect(stats.status).toBe("completed");
      expect(stats.gitBranch).toBe("main");
    });

    test("computes stats from session with error", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project");

      const systemEntry: SystemEntry = {
        type: "system",
        timestamp: Date.now(),
        projectPath: "/path/to/project",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      };

      const iterEntry: IterationEntry = {
        type: "iteration",
        timestamp: Date.now(),
        iteration: 1,
        error: {
          phase: "reviewer",
          message: "Agent crashed",
          exitCode: 1,
        },
      };

      await appendLog(logPath, systemEntry);
      await appendLog(logPath, iterEntry);

      const session = {
        path: logPath,
        name: "test.jsonl",
        projectName: "path-to-project",
        timestamp: Date.now(),
      };
      const stats = await computeSessionStats(session);

      expect(stats.totalFixes).toBe(0);
      expect(stats.status).toBe("failed");
    });

    test("handles empty log", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project");

      const session = {
        path: logPath,
        name: "test.jsonl",
        projectName: "path-to-project",
        timestamp: Date.now(),
      };
      const stats = await computeSessionStats(session);

      expect(stats.totalFixes).toBe(0);
      expect(stats.totalSkipped).toBe(0);
      expect(stats.iterations).toBe(0);
      expect(stats.status).toBe("unknown");
    });

    test("accumulates totalDuration from iteration entries", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project", "main");

      const systemEntry: SystemEntry = {
        type: "system",
        timestamp: Date.now(),
        projectPath: "/path/to/project",
        gitBranch: "main",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      };

      const iter1: IterationEntry = {
        type: "iteration",
        timestamp: Date.now(),
        iteration: 1,
        duration: 5000,
      };

      const iter2: IterationEntry = {
        type: "iteration",
        timestamp: Date.now(),
        iteration: 2,
        duration: 10000,
      };

      const iter3: IterationEntry = {
        type: "iteration",
        timestamp: Date.now(),
        iteration: 3,
        duration: 3000,
      };

      await appendLog(logPath, systemEntry);
      await appendLog(logPath, iter1);
      await appendLog(logPath, iter2);
      await appendLog(logPath, iter3);

      const session = {
        path: logPath,
        name: "test.jsonl",
        projectName: "path-to-project",
        timestamp: Date.now(),
      };
      const stats = await computeSessionStats(session);

      expect(stats.totalDuration).toBe(18000);
    });

    test("handles iterations without duration", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project");

      const systemEntry: SystemEntry = {
        type: "system",
        timestamp: Date.now(),
        projectPath: "/path/to/project",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      };

      const iter1: IterationEntry = {
        type: "iteration",
        timestamp: Date.now(),
        iteration: 1,
        duration: 5000,
      };

      const iter2: IterationEntry = {
        type: "iteration",
        timestamp: Date.now(),
        iteration: 2,
        // No duration field
      };

      await appendLog(logPath, systemEntry);
      await appendLog(logPath, iter1);
      await appendLog(logPath, iter2);

      const session = {
        path: logPath,
        name: "test.jsonl",
        projectName: "path-to-project",
        timestamp: Date.now(),
      };
      const stats = await computeSessionStats(session);

      expect(stats.totalDuration).toBe(5000);
    });

    test("returns undefined totalDuration when no iteration has duration", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project");

      const systemEntry: SystemEntry = {
        type: "system",
        timestamp: Date.now(),
        projectPath: "/path/to/project",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      };

      const iter1: IterationEntry = {
        type: "iteration",
        timestamp: Date.now(),
        iteration: 1,
        // No duration
      };

      await appendLog(logPath, systemEntry);
      await appendLog(logPath, iter1);

      const session = {
        path: logPath,
        name: "test.jsonl",
        projectName: "path-to-project",
        timestamp: Date.now(),
      };
      const stats = await computeSessionStats(session);

      expect(stats.totalDuration).toBeUndefined();
    });
  });

  describe("computeProjectStats", () => {
    test("aggregates stats from multiple sessions", async () => {
      // Create first session with P1 fix
      const logPath1 = await createLogSession(tempDir, "/path/to/project", "main");
      await appendLog(logPath1, {
        type: "system",
        timestamp: Date.now(),
        projectPath: "/path/to/project",
        gitBranch: "main",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      } as SystemEntry);
      await appendLog(logPath1, {
        type: "iteration",
        timestamp: Date.now(),
        iteration: 1,
        fixes: {
          decision: "APPLY_SELECTIVELY",
          fixes: [
            {
              id: 1,
              title: "Fix 1",
              priority: "P0",
              file: "a.ts",
              claim: "",
              evidence: "",
              fix: "",
            },
          ],
          skipped: [],
        },
      } as IterationEntry);

      await new Promise((r) => setTimeout(r, 10));

      // Create second session with P2 and P3 fixes
      const logPath2 = await createLogSession(tempDir, "/path/to/project", "feature");
      await appendLog(logPath2, {
        type: "system",
        timestamp: Date.now(),
        projectPath: "/path/to/project",
        gitBranch: "feature",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      } as SystemEntry);
      await appendLog(logPath2, {
        type: "iteration",
        timestamp: Date.now(),
        iteration: 1,
        fixes: {
          decision: "APPLY_MOST",
          fixes: [
            {
              id: 1,
              title: "Fix 2",
              priority: "P1",
              file: "b.ts",
              claim: "",
              evidence: "",
              fix: "",
            },
            {
              id: 2,
              title: "Fix 3",
              priority: "P2",
              file: "c.ts",
              claim: "",
              evidence: "",
              fix: "",
            },
          ],
          skipped: [{ id: 3, title: "Skip 1", reason: "minor" }],
        },
      } as IterationEntry);

      const sessions = await listProjectLogSessions(tempDir, "/path/to/project");
      const projectStats = await computeProjectStats("path-to-project", sessions);

      expect(projectStats.totalFixes).toBe(3);
      expect(projectStats.totalSkipped).toBe(1);
      expect(projectStats.priorityCounts.P0).toBe(1);
      expect(projectStats.priorityCounts.P1).toBe(1);
      expect(projectStats.priorityCounts.P2).toBe(1);
      expect(projectStats.sessionCount).toBe(2);
      expect(projectStats.successCount).toBe(2);
      expect(projectStats.displayName).toBe("project");
    });

    test("derives displayName from older sessions when latest lacks system entry", async () => {
      const projectPath = "/path/to/project";

      const logWithSystem = await createLogSession(tempDir, projectPath, "main");
      await appendLog(logWithSystem, {
        type: "system",
        timestamp: Date.now(),
        projectPath,
        gitBranch: "main",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      } as SystemEntry);
      await appendLog(logWithSystem, {
        type: "iteration",
        timestamp: Date.now(),
        iteration: 1,
      } as IterationEntry);

      await new Promise((r) => setTimeout(r, 10));

      const logWithoutSystem = await createLogSession(tempDir, projectPath, "feature");
      await appendLog(logWithoutSystem, {
        type: "iteration",
        timestamp: Date.now(),
        iteration: 1,
      } as IterationEntry);

      const sessions = await listProjectLogSessions(tempDir, projectPath);
      const projectStats = await computeProjectStats("path-to-project", sessions);

      expect(projectStats.displayName).toBe("project");
    });
  });

  describe("buildDashboardData", () => {
    test("builds dashboard data from logs directory", async () => {
      // Create sessions for two projects
      const logPathA = await createLogSession(tempDir, "/work/project-a", "main");
      await appendLog(logPathA, {
        type: "system",
        timestamp: Date.now(),
        projectPath: "/work/project-a",
        gitBranch: "main",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      } as SystemEntry);
      await appendLog(logPathA, {
        type: "iteration",
        timestamp: Date.now(),
        iteration: 1,
        fixes: {
          decision: "APPLY_SELECTIVELY",
          fixes: [
            {
              id: 1,
              title: "Fix A1",
              priority: "P0",
              file: "a.ts",
              claim: "",
              evidence: "",
              fix: "",
            },
            {
              id: 2,
              title: "Fix A2",
              priority: "P0",
              file: "a2.ts",
              claim: "",
              evidence: "",
              fix: "",
            },
          ],
          skipped: [],
        },
      } as IterationEntry);

      await new Promise((r) => setTimeout(r, 10));

      const logPathB = await createLogSession(tempDir, "/work/project-b", "develop");
      await appendLog(logPathB, {
        type: "system",
        timestamp: Date.now(),
        projectPath: "/work/project-b",
        gitBranch: "develop",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      } as SystemEntry);
      await appendLog(logPathB, {
        type: "iteration",
        timestamp: Date.now(),
        iteration: 1,
        fixes: {
          decision: "APPLY_MOST",
          fixes: [
            {
              id: 1,
              title: "Fix B1",
              priority: "P1",
              file: "b.ts",
              claim: "",
              evidence: "",
              fix: "",
            },
          ],
          skipped: [],
        },
      } as IterationEntry);

      const dashboard = await buildDashboardData(tempDir, "/work/project-a");

      expect(dashboard.currentProject).toBe("work-project-a");
      expect(dashboard.globalStats.totalFixes).toBe(3);
      expect(dashboard.globalStats.totalSessions).toBe(2);
      expect(dashboard.globalStats.priorityCounts.P0).toBe(2);
      expect(dashboard.globalStats.priorityCounts.P1).toBe(1);
      expect(dashboard.globalStats.successRate).toBe(100);
      expect(dashboard.projects.length).toBe(2);
    });

    test("handles empty logs directory", async () => {
      const dashboard = await buildDashboardData(tempDir);

      expect(dashboard.globalStats.totalFixes).toBe(0);
      expect(dashboard.globalStats.totalSessions).toBe(0);
      expect(dashboard.globalStats.successRate).toBe(0);
      expect(dashboard.projects.length).toBe(0);
    });

    test("clears currentProject when requested project has no sessions", async () => {
      const logPath = await createLogSession(tempDir, "/work/project-a", "main");
      await appendLog(logPath, {
        type: "system",
        timestamp: Date.now(),
        projectPath: "/work/project-a",
        gitBranch: "main",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      } as SystemEntry);
      await appendLog(logPath, {
        type: "iteration",
        timestamp: Date.now(),
        iteration: 1,
        fixes: { decision: "APPLY_SELECTIVELY", fixes: [], skipped: [] },
      } as IterationEntry);

      const dashboard = await buildDashboardData(tempDir, "/work/project-c");

      expect(dashboard.currentProject).toBeUndefined();
      expect(dashboard.projects.length).toBe(1);
    });

    test("calculates correct success rate with failures", async () => {
      // Create one successful session
      const logPath1 = await createLogSession(tempDir, "/work/project", "main");
      await appendLog(logPath1, {
        type: "system",
        timestamp: Date.now(),
        projectPath: "/work/project",
        gitBranch: "main",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      } as SystemEntry);
      await appendLog(logPath1, {
        type: "iteration",
        timestamp: Date.now(),
        iteration: 1,
        fixes: { decision: "APPLY_SELECTIVELY", fixes: [], skipped: [] },
      } as IterationEntry);

      await new Promise((r) => setTimeout(r, 10));

      // Create one failed session
      const logPath2 = await createLogSession(tempDir, "/work/project", "feature");
      await appendLog(logPath2, {
        type: "system",
        timestamp: Date.now(),
        projectPath: "/work/project",
        gitBranch: "feature",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      } as SystemEntry);
      await appendLog(logPath2, {
        type: "iteration",
        timestamp: Date.now(),
        iteration: 1,
        error: { phase: "reviewer", message: "Failed" },
      } as IterationEntry);

      const dashboard = await buildDashboardData(tempDir);

      expect(dashboard.globalStats.totalSessions).toBe(2);
      expect(dashboard.globalStats.successRate).toBe(50);
    });
  });
});
