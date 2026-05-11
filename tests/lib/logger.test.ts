import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  appendLog,
  computeProjectStats,
  computeSessionStats,
  createLogSession,
  deleteSessionFiles,
  generateLogFilename,
  getGitBranch,
  getLatestProjectLogSession,
  getProjectName,
  getProjectWorktreesDir,
  getSummaryPath,
  listLogSessions,
  listProjectLogSessions,
  readLog,
  readLogIncremental,
  readSessionSummary,
  sanitizeForFilename,
} from "@/lib/logger";
import type { HandoffEntry, IterationEntry, SessionEndEntry, SystemEntry } from "@/lib/types";
import { buildFixEntry, buildFixSummary } from "../test-utils/fix-summary";

function createStoredFinding(id: `F${string}`, priority: "P0" | "P1" | "P2" | "P3") {
  return {
    id,
    fingerprint: `fp-${id}`,
    locationKey: `src/file-${id}.ts:10:12`,
    title: `Finding ${id}`,
    body: `Body for ${id}`,
    priority,
    confidenceScore: 0.91,
    filePath: `src/file-${id}.ts`,
    startLine: 10,
    endLine: 12,
  };
}

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
    test("uses basename with a stable hash suffix", () => {
      expect(getProjectName("/Users/ken/projects/my-app")).toMatch(/^my-app-[0-9a-f]{8}$/);
    });

    test("sanitizes the basename portion", () => {
      expect(getProjectName("/path/to/My Project")).toMatch(/^my-project-[0-9a-f]{8}$/);
    });

    test("returns unknown-project for root path", () => {
      expect(getProjectName("/")).toBe("unknown-project");
    });

    test("differentiates same-name folders in different locations", () => {
      const a = getProjectName("/work/api");
      const b = getProjectName("/personal/api");
      expect(a).not.toBe(b);
      expect(a).toMatch(/^api-[0-9a-f]{8}$/);
      expect(b).toMatch(/^api-[0-9a-f]{8}$/);
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

    test("returns branch name for git repository", async () => {
      const repoPath = await mkdtemp(join(tempDir, "repo-"));
      const initResult = Bun.spawnSync(["git", "init"], {
        cwd: repoPath,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(initResult.exitCode).toBe(0);

      const branch = await getGitBranch(repoPath);
      expect(branch).toBeString();
      expect(branch?.length).toBeGreaterThan(0);
    });
  });

  describe("createLogSession", () => {
    test("creates project logs directory and returns log file path", async () => {
      const projectPath = "/path/to/my-project";
      const logPath = await createLogSession(tempDir, projectPath);
      expect(logPath).toContain(join(tempDir, getProjectName(projectPath), "logs"));
      expect(logPath).toEndWith(".jsonl");
    });

    test("includes branch in filename when provided", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/my-project", "main");
      expect(logPath).toContain("_main.jsonl");
    });
  });

  describe("getProjectWorktreesDir", () => {
    test("returns the per-project worktrees directory under storage root", () => {
      const projectPath = "/path/to/my-project";

      expect(getProjectWorktreesDir(tempDir, projectPath)).toBe(
        join(tempDir, getProjectName(projectPath), "worktrees")
      );
    });
  });

  describe("getSummaryPath", () => {
    test("replaces .jsonl with .summary.json", () => {
      expect(getSummaryPath("/tmp/logs/session.jsonl")).toBe("/tmp/logs/session.summary.json");
    });

    test("appends .summary.json when path is not .jsonl", () => {
      expect(getSummaryPath("/tmp/logs/session")).toBe("/tmp/logs/session.summary.json");
    });
  });

  describe("readSessionSummary", () => {
    test("returns null when summary file does not exist", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project");
      const summary = await readSessionSummary(logPath);
      expect(summary).toBeNull();
    });

    test("returns null when schema version does not match", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project");
      const summaryPath = getSummaryPath(logPath);
      await Bun.write(
        summaryPath,
        JSON.stringify({
          schemaVersion: 999,
          logPath,
          summaryPath,
        })
      );

      const summary = await readSessionSummary(logPath);
      expect(summary).toBeNull();
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
        fixes: buildFixSummary({ decision: "APPLY_SELECTIVELY" }),
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

    test("ignores blank lines while parsing log content", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project");
      const systemEntry: SystemEntry = {
        type: "system",
        timestamp: Date.now(),
        projectPath: "/path/to/project",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      };

      await Bun.write(logPath, `\n\n${JSON.stringify(systemEntry)}\n\n`, { createPath: true });

      const entries = await readLog(logPath);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.type).toBe("system");
    });

    test("updates summary after appending entries", async () => {
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

      const iterationEntry: IterationEntry = {
        type: "iteration",
        timestamp: Date.now(),
        iteration: 1,
        duration: 5000,
      };

      const sessionEndEntry: SessionEndEntry = {
        type: "session_end",
        timestamp: Date.now(),
        status: "completed",
        reason: "No issues found - code is clean",
        iterations: 1,
        reviewOutcome: "incomplete",
        mergeReady: true,
        commitSha: "retained-commit-sha",
        worktreeBranch: "rr-worktree-test",
      };

      await appendLog(logPath, systemEntry);
      await appendLog(logPath, iterationEntry);
      await appendLog(logPath, sessionEndEntry);

      const summary = await readSessionSummary(logPath);
      expect(summary).not.toBeNull();
      expect(summary?.status).toBe("completed");
      expect(summary?.iterations).toBe(1);
      expect(summary?.hasIteration).toBe(true);
      expect(summary?.gitBranch).toBe("main");
      expect(summary?.reason).toContain("code is clean");
      expect(summary?.reviewOutcome).toBe("incomplete");
      expect(summary?.mergeReady).toBe(true);
      expect(summary?.commitSha).toBe("retained-commit-sha");
      expect(summary?.worktreeBranch).toBe("rr-worktree-test");
    });

    test("tracks batch-first workflow counts in the session summary", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project", "main");

      const systemEntry: SystemEntry = {
        type: "system",
        timestamp: 1_700_000_000_000,
        sessionId: "session-123",
        projectPath: "/path/to/project",
        gitBranch: "main",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      };

      await appendLog(logPath, systemEntry);
      await appendLog(logPath, {
        type: "review_iteration",
        timestamp: 1_700_000_001_000,
        iteration: 1,
        phase: "review",
        sessionStatus: "running",
        duration: 1_000,
        findings: [createStoredFinding("F001", "P0"), createStoredFinding("F002", "P2")],
        netNewFindingIds: ["F001", "F002"],
      });
      await appendLog(logPath, {
        type: "review_iteration",
        timestamp: 1_700_000_002_000,
        iteration: 2,
        phase: "review",
        sessionStatus: "running",
        duration: 2_000,
        findings: [createStoredFinding("F003", "P1")],
        netNewFindingIds: ["F003"],
      });
      await appendLog(logPath, {
        type: "finding_selection",
        timestamp: 1_700_000_003_000,
        selectionMode: "priority",
        selectedFindingIds: ["F001", "F003"],
      });
      await appendLog(logPath, {
        type: "batch_fix",
        timestamp: 1_700_000_004_000,
        duration: 1_500,
        selectedFindingIds: ["F001", "F003"],
        fixResults: [
          {
            findingId: "F001",
            status: "resolved",
            summary: "Resolved F001",
          },
          {
            findingId: "F003",
            status: "unresolved",
            summary: "Could not safely remediate F003",
          },
        ],
      });
      await appendLog(logPath, {
        type: "session_end",
        timestamp: 1_700_000_005_000,
        status: "completed",
        reason: "Some selected findings remain unresolved after remediation.",
        iterations: 2,
        phase: "complete",
        sessionStatus: "completed",
        reviewOutcome: "incomplete",
      });

      const summary = await readSessionSummary(logPath);

      expect(summary).not.toBeNull();
      expect(summary?.phase).toBe("complete");
      expect(summary?.sessionStatus).toBe("completed");
      expect(summary?.reviewOutcome).toBe("incomplete");
      expect(summary?.iterations).toBe(2);
      expect(summary?.totalDuration).toBe(4_500);
      expect(summary?.priorityCounts).toEqual({
        P0: 1,
        P1: 1,
        P2: 1,
        P3: 0,
      });
      expect(summary?.totalFindings).toBe(3);
      expect(summary?.totalSelectedFindings).toBe(2);
      expect(summary?.totalResolvedSelectedFindings).toBe(1);
      expect(summary?.totalUnresolvedSelectedFindings).toBe(1);
    });

    test("applies incremental summary updates for each appended event", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project", "main");

      const systemEntry: SystemEntry = {
        type: "system",
        timestamp: 1_700_000_000_000,
        projectPath: "/path/to/project",
        gitBranch: "main",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      };
      const iterationEntry: IterationEntry = {
        type: "iteration",
        timestamp: 1_700_000_001_000,
        iteration: 1,
        duration: 1_500,
        fixes: buildFixSummary({
          decision: "APPLY_SELECTIVELY",
          fixes: [
            buildFixEntry({
              id: 1,
              title: "Fix auth guard",
              priority: "P0",
              file: "auth.ts",
            }),
          ],
          skipped: [{ id: 2, title: "Skip docs", priority: "P2", reason: "not required" }],
        }),
      };
      const sessionEndEntry: SessionEndEntry = {
        type: "session_end",
        timestamp: 1_700_000_002_000,
        status: "completed",
        reason: "No issues found - code is clean",
        iterations: 1,
        reviewOutcome: "clean",
        mergeReady: true,
        commitSha: "clean-commit-sha",
        worktreeBranch: "rr-worktree-clean",
      };

      await appendLog(logPath, systemEntry);
      const summaryAfterSystem = await readSessionSummary(logPath);
      expect(summaryAfterSystem).not.toBeNull();
      expect(summaryAfterSystem?.projectPath).toBe("/path/to/project");
      expect(summaryAfterSystem?.gitBranch).toBe("main");
      expect(summaryAfterSystem?.status).toBe("unknown");
      expect(summaryAfterSystem?.iterations).toBe(0);
      expect(summaryAfterSystem?.totalFixes).toBe(0);

      await appendLog(logPath, iterationEntry);
      const summaryAfterIteration = await readSessionSummary(logPath);
      expect(summaryAfterIteration).not.toBeNull();
      expect(summaryAfterIteration?.status).toBe("completed");
      expect(summaryAfterIteration?.iterations).toBe(1);
      expect(summaryAfterIteration?.hasIteration).toBe(true);
      expect(summaryAfterIteration?.totalFixes).toBe(1);
      expect(summaryAfterIteration?.totalSkipped).toBe(1);
      expect(summaryAfterIteration?.priorityCounts.P0).toBe(1);
      expect(summaryAfterIteration?.priorityCounts.P2).toBe(0);
      expect(summaryAfterIteration?.totalDuration).toBe(1_500);

      await appendLog(logPath, sessionEndEntry);
      const summaryAfterEnd = await readSessionSummary(logPath);
      expect(summaryAfterEnd).not.toBeNull();
      expect(summaryAfterEnd?.status).toBe("completed");
      expect(summaryAfterEnd?.endedAt).toBe(1_700_000_002_000);
      expect(summaryAfterEnd?.reason).toContain("code is clean");
      expect(summaryAfterEnd?.iterations).toBe(1);
      expect(summaryAfterEnd?.totalFixes).toBe(1);
      expect(summaryAfterEnd?.totalSkipped).toBe(1);
      expect(summaryAfterEnd?.reviewOutcome).toBe("clean");
      expect(summaryAfterEnd?.mergeReady).toBe(true);
      expect(summaryAfterEnd?.commitSha).toBe("clean-commit-sha");
      expect(summaryAfterEnd?.worktreeBranch).toBe("rr-worktree-clean");
    });

    test("serializes concurrent appends to the same log", async () => {
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
        timestamp: Date.now() + 1,
        iteration: 1,
        fixes: buildFixSummary({
          decision: "APPLY_SELECTIVELY",
          fixes: [buildFixEntry({ id: 1, title: "Fix 1", priority: "P1", file: "a.ts" })],
        }),
      };
      const iter2: IterationEntry = {
        type: "iteration",
        timestamp: Date.now() + 2,
        iteration: 2,
        fixes: buildFixSummary({
          decision: "APPLY_SELECTIVELY",
          fixes: [buildFixEntry({ id: 2, title: "Fix 2", priority: "P0", file: "b.ts" })],
        }),
      };
      const sessionEndEntry: SessionEndEntry = {
        type: "session_end",
        timestamp: Date.now() + 3,
        status: "completed",
        reason: "done",
        iterations: 2,
      };

      await Promise.all([
        appendLog(logPath, systemEntry),
        appendLog(logPath, iter1),
        appendLog(logPath, iter2),
        appendLog(logPath, sessionEndEntry),
      ]);

      const entries = await readLog(logPath);
      expect(entries.length).toBe(4);
      expect(entries[0]?.type).toBe("system");
      expect(entries[1]?.type).toBe("iteration");
      expect(entries[2]?.type).toBe("iteration");
      expect(entries[3]?.type).toBe("session_end");

      const summary = await readSessionSummary(logPath);
      expect(summary).not.toBeNull();
      expect(summary?.status).toBe("completed");
      expect(summary?.iterations).toBe(2);
      expect(summary?.totalFixes).toBe(2);
    });

    test("writes summaries atomically without leftover temp files", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project");
      const systemEntry: SystemEntry = {
        type: "system",
        timestamp: Date.now(),
        projectPath: "/path/to/project",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      };

      await appendLog(logPath, systemEntry);

      const summaryPath = getSummaryPath(logPath);
      const summary = await readSessionSummary(logPath);
      expect(summary).not.toBeNull();

      const summaryDir = dirname(summaryPath);
      const summaryFilename = basename(summaryPath);
      const tmpPattern = `${summaryFilename}.tmp.*`;
      const glob = new Bun.Glob(tmpPattern);
      const leftovers: string[] = [];
      for await (const file of glob.scan({ cwd: summaryDir })) {
        leftovers.push(file);
      }

      expect(leftovers.length).toBe(0);
    });

    test("derives summary project name from project directory when log has no system entry", async () => {
      const projectPath = "/path/to/project";
      const logPath = join(tempDir, getProjectName(projectPath), "logs", "manual.jsonl");

      await appendLog(logPath, {
        type: "iteration",
        timestamp: Date.now(),
        iteration: 1,
      } as IterationEntry);

      const summary = await readSessionSummary(logPath);
      expect(summary).not.toBeNull();
      expect(summary?.projectName).toBe(getProjectName(projectPath));
    });

    test("uses empty-summary initialization when an existing log file is zero bytes", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project");
      const systemEntry: SystemEntry = {
        type: "system",
        timestamp: Date.now(),
        projectPath: "/path/to/project",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      };

      await Bun.write(logPath, "", { createPath: true });
      await appendLog(logPath, systemEntry);

      const summary = await readSessionSummary(logPath);
      expect(summary).not.toBeNull();
      expect(summary?.iterations).toBe(0);
      expect(summary?.projectPath).toBe("/path/to/project");
    });

    test("cleans up temporary summary file when atomic rename fails", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project");
      const summaryPath = getSummaryPath(logPath);
      const summaryFilename = basename(summaryPath);
      const systemEntry: SystemEntry = {
        type: "system",
        timestamp: Date.now(),
        projectPath: "/path/to/project",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      };

      await Bun.write(join(summaryPath, "blocker"), "x", { createPath: true });

      await expect(appendLog(logPath, systemEntry)).rejects.toThrow();

      const glob = new Bun.Glob(`${summaryFilename}.tmp.*`);
      const leftovers: string[] = [];
      for await (const file of glob.scan({ cwd: dirname(summaryPath) })) {
        leftovers.push(file);
      }
      expect(leftovers).toEqual([]);

      await rm(summaryPath, { recursive: true, force: true });
      await deleteSessionFiles(logPath);
    });

    test("preserves existing log content when appending without active writer", async () => {
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
        timestamp: Date.now() + 1,
        iteration: 1,
        fixes: buildFixSummary({
          decision: "APPLY_SELECTIVELY",
          fixes: [buildFixEntry({ id: 1, title: "Fix 1", priority: "P1", file: "a.ts" })],
        }),
      };
      const iter2: IterationEntry = {
        type: "iteration",
        timestamp: Date.now() + 2,
        iteration: 2,
      };

      await Bun.write(logPath, `${JSON.stringify(systemEntry)}\n${JSON.stringify(iter1)}\n`, {
        createPath: true,
      });
      expect(await Bun.file(getSummaryPath(logPath)).exists()).toBe(false);

      await appendLog(logPath, iter2);

      const entries = await readLog(logPath);
      expect(entries.length).toBe(3);
      expect(entries[0]?.type).toBe("system");
      expect(entries[1]?.type).toBe("iteration");
      expect(entries[2]?.type).toBe("iteration");

      const summary = await readSessionSummary(logPath);
      expect(summary).not.toBeNull();
      expect(summary?.iterations).toBe(2);
      expect(summary?.totalFixes).toBe(1);
    });

    test("marks summary as interrupted when iteration error includes interrupt text", async () => {
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
        timestamp: Date.now() + 1,
        iteration: 1,
        error: {
          phase: "reviewer",
          message: "Interrupted by user",
        },
      };

      await appendLog(logPath, systemEntry);
      await appendLog(logPath, iterEntry);

      const summary = await readSessionSummary(logPath);
      expect(summary?.status).toBe("interrupted");
    });
  });

  describe("handoff summary tracking", () => {
    test("records handoff status from session_end and later handoff events", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project");

      const systemEntry: SystemEntry = {
        type: "system",
        timestamp: 1_700_000_000_000,
        projectPath: "/path/to/project",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      };
      const sessionEnd: SessionEndEntry = {
        type: "session_end",
        timestamp: 1_700_000_001_000,
        status: "completed",
        reason: "Review complete",
        iterations: 1,
        reviewOutcome: "incomplete",
        handoffStatus: "pending-apply",
        handoffUpdatedAt: 1_700_000_001_000,
        commitSha: "retained-commit-sha",
      };
      const handoffEntry: HandoffEntry = {
        type: "handoff",
        timestamp: 1_700_000_002_000,
        handoffStatus: "applied-manual",
        commitSha: "retained-commit-sha",
      };

      await appendLog(logPath, systemEntry);
      await appendLog(logPath, sessionEnd);
      await appendLog(logPath, handoffEntry);

      const summary = await readSessionSummary(logPath);
      expect(summary?.handoffStatus).toBe("applied-manual");
      expect(summary?.handoffUpdatedAt).toBe(1_700_000_002_000);
      expect(summary?.commitSha).toBe("retained-commit-sha");

      const stats = await computeSessionStats({
        path: logPath,
        name: "session.jsonl",
        projectName: getProjectName("/path/to/project"),
        timestamp: Bun.file(logPath).lastModified,
      });
      expect(stats.handoffStatus).toBe("applied-manual");
      expect(stats.handoffUpdatedAt).toBe(1_700_000_002_000);
    });
  });

  describe("readLogIncremental", () => {
    test("returns reset for an existing empty log file", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project");
      await Bun.write(logPath, "", { createPath: true });

      const result = await readLogIncremental(logPath);
      expect(result.mode).toBe("reset");
      expect(result.entries).toEqual([]);
      expect(result.state.offsetBytes).toBe(0);
      expect(result.state.trailingPartialLine).toBe("");
      expect(result.state.boundaryProbe).toBe("");
    });

    test("returns reset with all entries on first read", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project");
      const systemEntry: SystemEntry = {
        type: "system",
        timestamp: 1_700_000_000_000,
        projectPath: "/path/to/project",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      };
      const iterationEntry: IterationEntry = {
        type: "iteration",
        timestamp: 1_700_000_000_001,
        iteration: 1,
      };

      await Bun.write(
        logPath,
        `${JSON.stringify(systemEntry)}\n${JSON.stringify(iterationEntry)}\n`,
        { createPath: true }
      );

      const result = await readLogIncremental(logPath);
      expect(result.mode).toBe("reset");
      expect(result.entries).toHaveLength(2);
      expect(result.state.logPath).toBe(logPath);
      expect(result.state.offsetBytes).toBe(Bun.file(logPath).size);
      expect(result.state.trailingPartialLine).toBe("");
    });

    test("parses a single complete line without trailing newline", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project");
      const systemEntry: SystemEntry = {
        type: "system",
        timestamp: 1_700_000_000_000,
        projectPath: "/path/to/project",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      };

      await Bun.write(logPath, JSON.stringify(systemEntry), { createPath: true });
      const result = await readLogIncremental(logPath);
      expect(result.mode).toBe("reset");
      expect(result.entries).toHaveLength(1);
      expect(result.state.trailingPartialLine).toBe("");
    });

    test("returns only appended entries on incremental read", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project");
      const systemEntry: SystemEntry = {
        type: "system",
        timestamp: 1_700_000_000_000,
        projectPath: "/path/to/project",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      };
      const iterationEntry: IterationEntry = {
        type: "iteration",
        timestamp: 1_700_000_000_001,
        iteration: 1,
      };

      await Bun.write(logPath, `${JSON.stringify(systemEntry)}\n`, { createPath: true });
      const first = await readLogIncremental(logPath);
      expect(first.entries).toHaveLength(1);

      const existing = await Bun.file(logPath).text();
      await Bun.write(logPath, `${existing}${JSON.stringify(iterationEntry)}\n`, {
        createPath: true,
      });

      const second = await readLogIncremental(logPath, first.state);
      expect(second.mode).toBe("incremental");
      expect(second.entries).toHaveLength(1);
      expect(second.entries[0]?.type).toBe("iteration");
      expect(second.state.trailingPartialLine).toBe("");
    });

    test("returns unchanged when size and mtime match previous snapshot", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project");
      const systemEntry: SystemEntry = {
        type: "system",
        timestamp: 1_700_000_000_000,
        projectPath: "/path/to/project",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      };

      await Bun.write(logPath, `${JSON.stringify(systemEntry)}\n`, { createPath: true });
      const first = await readLogIncremental(logPath);
      const second = await readLogIncremental(logPath, first.state);

      expect(second.mode).toBe("unchanged");
      expect(second.entries).toEqual([]);
      expect(second.state.boundaryProbe).toBe(first.state.boundaryProbe);
    });

    test("falls back to reset when mtime changes without size change", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project");
      const systemEntry: SystemEntry = {
        type: "system",
        timestamp: 1_700_000_000_000,
        projectPath: "/path/to/project",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      };

      await Bun.write(logPath, `${JSON.stringify(systemEntry)}\n`, { createPath: true });
      const first = await readLogIncremental(logPath);

      await Bun.sleep(10);
      const sameContent = await Bun.file(logPath).text();
      await Bun.write(logPath, sameContent, { createPath: true });

      const second = await readLogIncremental(logPath, first.state);
      expect(second.mode).toBe("reset");
      expect(second.entries).toHaveLength(1);
    });

    test("falls back to reset when previous state has newer mtime than file", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project");
      const systemEntry: SystemEntry = {
        type: "system",
        timestamp: 1_700_000_000_000,
        projectPath: "/path/to/project",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      };
      const iterationEntry: IterationEntry = {
        type: "iteration",
        timestamp: 1_700_000_000_001,
        iteration: 1,
      };

      await Bun.write(logPath, `${JSON.stringify(systemEntry)}\n`, { createPath: true });
      const first = await readLogIncremental(logPath);
      const existing = await Bun.file(logPath).text();
      await Bun.write(logPath, `${existing}${JSON.stringify(iterationEntry)}\n`, {
        createPath: true,
      });

      const second = await readLogIncremental(logPath, {
        ...first.state,
        lastModified: Bun.file(logPath).lastModified + 1_000_000,
      });
      expect(second.mode).toBe("reset");
      expect(second.entries).toHaveLength(2);
    });

    test("supports previous state with zero offset and empty boundary probe", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project");
      const systemEntry: SystemEntry = {
        type: "system",
        timestamp: 1_700_000_000_000,
        projectPath: "/path/to/project",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      };
      await Bun.write(logPath, "", { createPath: true });

      const previousState = {
        logPath,
        offsetBytes: 0,
        lastModified: Bun.file(logPath).lastModified,
        trailingPartialLine: "",
        boundaryProbe: "",
      };
      await Bun.write(logPath, `${JSON.stringify(systemEntry)}\n`, { createPath: true });

      const result = await readLogIncremental(logPath, previousState);
      expect(result.mode).toBe("incremental");
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]?.type).toBe("system");
    });

    test("buffers partial trailing line and parses it when completed", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project");
      const systemEntry: SystemEntry = {
        type: "system",
        timestamp: 1_700_000_000_000,
        projectPath: "/path/to/project",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      };
      const partialLine = '{"type":"iteration","timestamp":1700000000001,"iteration":1';

      await Bun.write(logPath, `${JSON.stringify(systemEntry)}\n${partialLine}`, {
        createPath: true,
      });

      const first = await readLogIncremental(logPath);
      expect(first.mode).toBe("reset");
      expect(first.entries).toHaveLength(1);
      expect(first.state.trailingPartialLine).toBe(partialLine);

      const existing = await Bun.file(logPath).text();
      await Bun.write(logPath, `${existing},"duration":10}\n`, { createPath: true });

      const second = await readLogIncremental(logPath, first.state);
      expect(second.mode).toBe("incremental");
      expect(second.entries).toHaveLength(1);
      expect(second.entries[0]?.type).toBe("iteration");
      const iterationEntry = second.entries[0] as IterationEntry;
      expect(iterationEntry.duration).toBe(10);
      expect(second.state.trailingPartialLine).toBe("");
    });

    test("falls back to reset when file is truncated", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project");
      const systemEntry: SystemEntry = {
        type: "system",
        timestamp: 1_700_000_000_000,
        projectPath: "/path/to/project",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      };
      const replacementEntry: SystemEntry = {
        ...systemEntry,
        timestamp: 1_700_000_000_100,
        projectPath: "/path/to/new-project",
      };
      const extraEntry: IterationEntry = {
        type: "iteration",
        timestamp: 1_700_000_000_001,
        iteration: 1,
      };

      await Bun.write(logPath, `${JSON.stringify(systemEntry)}\n${JSON.stringify(extraEntry)}\n`, {
        createPath: true,
      });
      const first = await readLogIncremental(logPath);
      expect(first.mode).toBe("reset");

      await Bun.write(logPath, `${JSON.stringify(replacementEntry)}\n`, { createPath: true });
      const second = await readLogIncremental(logPath, first.state);
      expect(second.mode).toBe("reset");
      expect(second.entries).toHaveLength(1);
      const nextSystemEntry = second.entries[0] as SystemEntry;
      expect(nextSystemEntry.projectPath).toBe("/path/to/new-project");
    });

    test("falls back to reset when file is rewritten and regrows past previous offset", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project");
      const systemEntry: SystemEntry = {
        type: "system",
        timestamp: 1_700_000_000_000,
        projectPath: "/path/to/project",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      };
      const extraEntry: IterationEntry = {
        type: "iteration",
        timestamp: 1_700_000_000_001,
        iteration: 1,
      };

      await Bun.write(logPath, `${JSON.stringify(systemEntry)}\n${JSON.stringify(extraEntry)}\n`, {
        createPath: true,
      });
      const first = await readLogIncremental(logPath);
      expect(first.mode).toBe("reset");

      const replacementEntry: SystemEntry = {
        ...systemEntry,
        timestamp: 1_700_000_000_100,
        projectPath: `/path/to/rewritten-${"x".repeat(512)}`,
      };
      await Bun.write(logPath, `${JSON.stringify(replacementEntry)}\n`, { createPath: true });
      expect(Bun.file(logPath).size).toBeGreaterThan(first.state.offsetBytes);

      const second = await readLogIncremental(logPath, first.state);
      expect(second.mode).toBe("reset");
      expect(second.entries).toHaveLength(1);
      const nextSystemEntry = second.entries[0] as SystemEntry;
      expect(nextSystemEntry.projectPath).toBe(replacementEntry.projectPath);
    });

    test("returns empty reset result when file is missing", async () => {
      const missingPath = join(tempDir, "missing", "session.jsonl");
      const result = await readLogIncremental(missingPath);
      expect(result.mode).toBe("reset");
      expect(result.entries).toEqual([]);
      expect(result.state.offsetBytes).toBe(0);
      expect(result.state.trailingPartialLine).toBe("");
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
      expect(sessions[0]?.projectName).toBe(getProjectName("/path/to/project-b"));
    });

    test("ignores jsonl files in the worktrees directory", async () => {
      const worktreeLogPath = join(
        getProjectWorktreesDir(tempDir, "/path/to/project-a"),
        "ignored.jsonl"
      );
      await Bun.write(worktreeLogPath, '{"type":"system"}\n', { createPath: true });

      const sessions = await listLogSessions(tempDir);
      expect(sessions).toEqual([]);
    });

    test("returns empty array when no sessions", async () => {
      const sessions = await listLogSessions(tempDir);
      expect(sessions).toEqual([]);
    });

    test("returns empty array when logsDir is not a directory", async () => {
      const filePath = join(tempDir, "not-a-directory");
      await Bun.write(filePath, "x");

      const sessions = await listLogSessions(filePath);
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
      expect(sessions.every((s) => s.projectName === getProjectName("/path/to/project-a"))).toBe(
        true
      );
    });

    test("returns empty array when logsDir is not a directory", async () => {
      const filePath = join(tempDir, "not-a-directory");
      await Bun.write(filePath, "x");

      const sessions = await listProjectLogSessions(filePath, "/path/to/project-a");
      expect(sessions).toEqual([]);
    });
  });

  describe("getLatestProjectLogSession", () => {
    test("returns newest session for a project", async () => {
      const projectPath = "/path/to/project-a";

      const olderPath = await createLogSession(tempDir, projectPath);
      await appendLog(olderPath, {
        type: "system",
        timestamp: Date.now(),
        projectPath,
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      } as SystemEntry);

      await Bun.sleep(10);

      const newerPath = await createLogSession(tempDir, projectPath, "feature");
      await appendLog(newerPath, {
        type: "system",
        timestamp: Date.now(),
        projectPath,
        gitBranch: "feature",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      } as SystemEntry);

      const latest = await getLatestProjectLogSession(tempDir, projectPath);
      expect(latest).not.toBeNull();
      expect(latest?.path).toBe(newerPath);
    });

    test("returns null when project has no sessions", async () => {
      const latest = await getLatestProjectLogSession(tempDir, "/path/to/project-a");
      expect(latest).toBeNull();
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
        fixes: buildFixSummary({
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
          skipped: [{ id: 3, title: "Minor style", priority: "P3", reason: "Not important" }],
        }),
      };

      await appendLog(logPath, systemEntry);
      await appendLog(logPath, iterEntry);

      const session = {
        path: logPath,
        name: "test.jsonl",
        projectName: getProjectName("/path/to/project"),
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
        projectName: getProjectName("/path/to/project"),
        timestamp: Date.now(),
      };
      const stats = await computeSessionStats(session);

      expect(stats.totalFixes).toBe(0);
      expect(stats.status).toBe("failed");
    });

    test("uses session_end status when present", async () => {
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
        duration: 1000,
      };

      const sessionEndEntry: SessionEndEntry = {
        type: "session_end",
        timestamp: Date.now(),
        status: "interrupted",
        reason: "Review cycle was interrupted",
        iterations: 1,
        reviewOutcome: "incomplete",
        mergeReady: true,
        commitSha: "retained-commit-sha",
        worktreeBranch: "rr-worktree-incomplete",
      };

      await appendLog(logPath, systemEntry);
      await appendLog(logPath, iterEntry);
      await appendLog(logPath, sessionEndEntry);

      const session = {
        path: logPath,
        name: "test.jsonl",
        projectName: getProjectName("/path/to/project"),
        timestamp: Date.now(),
      };
      const stats = await computeSessionStats(session);

      expect(stats.status).toBe("interrupted");
      expect(stats.iterations).toBe(1);
      expect(stats.reviewOutcome).toBe("incomplete");
      expect(stats.mergeReady).toBe(true);
      expect(stats.commitSha).toBe("retained-commit-sha");
      expect(stats.worktreeBranch).toBe("rr-worktree-incomplete");
    });

    test("does not revive a transient worktree branch once session_end omits it", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project");

      const systemEntry: SystemEntry = {
        type: "system",
        timestamp: Date.now(),
        projectPath: "/path/to/project",
        worktreeBranch: "rr-worktree-transient",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      };

      const sessionEndEntry: SessionEndEntry = {
        type: "session_end",
        timestamp: Date.now(),
        status: "completed",
        reason: "No issues found - code is clean",
        iterations: 0,
        reviewOutcome: "clean",
      };

      await appendLog(logPath, systemEntry);
      await appendLog(logPath, sessionEndEntry);

      const session = {
        path: logPath,
        name: "test.jsonl",
        projectName: getProjectName("/path/to/project"),
        timestamp: Date.now(),
      };
      const stats = await computeSessionStats(session);

      expect(stats.worktreeBranch).toBeUndefined();
    });

    test("handles empty log", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project");

      const session = {
        path: logPath,
        name: "test.jsonl",
        projectName: getProjectName("/path/to/project"),
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
        projectName: getProjectName("/path/to/project"),
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
        projectName: getProjectName("/path/to/project"),
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
        projectName: getProjectName("/path/to/project"),
        timestamp: Date.now(),
      };
      const stats = await computeSessionStats(session);

      expect(stats.totalDuration).toBeUndefined();
    });

    test("uses fresh metrics when summary is stale", async () => {
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
        fixes: buildFixSummary({
          decision: "APPLY_SELECTIVELY",
          fixes: [buildFixEntry({ id: 1, title: "Fix 1", priority: "P1", file: "a.ts" })],
        }),
      };

      // Write initial log and summary
      await appendLog(logPath, systemEntry);
      await appendLog(logPath, iter1);

      // Verify summary was created with correct values
      const summary1 = await readSessionSummary(logPath);
      expect(summary1?.totalFixes).toBe(1);

      // Simulate a crash scenario: manually append to log file without updating summary
      const iter2: IterationEntry = {
        type: "iteration",
        timestamp: Date.now(),
        iteration: 2,
        fixes: buildFixSummary({
          decision: "APPLY_SELECTIVELY",
          fixes: [
            buildFixEntry({ id: 2, title: "Fix 2", priority: "P0", file: "b.ts" }),
            buildFixEntry({ id: 3, title: "Fix 3", priority: "P2", file: "c.ts" }),
          ],
        }),
      };

      // Directly append to log without calling appendLog (simulating crash between writes)
      // Sleep first to ensure mtime difference between summary and upcoming log write
      await Bun.sleep(50);
      const logFile = Bun.file(logPath);
      const existing = await logFile.text();
      await Bun.write(logPath, `${existing}${JSON.stringify(iter2)}\n`);

      // Now computeSessionStats should detect stale summary and use fresh metrics
      const session = {
        path: logPath,
        name: "test.jsonl",
        projectName: getProjectName("/path/to/project"),
        timestamp: Date.now(),
      };
      const stats = await computeSessionStats(session);

      // Should reflect all 3 fixes from both iterations, not just 1 from stale summary
      expect(stats.totalFixes).toBe(3);
      expect(stats.iterations).toBe(2);
    });

    test("rebuilds summary when summary file is corrupted", async () => {
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
        fixes: buildFixSummary({
          decision: "APPLY_SELECTIVELY",
          fixes: [buildFixEntry({ id: 1, title: "Fix 1", priority: "P0", file: "a.ts" })],
        }),
      };

      await appendLog(logPath, systemEntry);
      await appendLog(logPath, iter1);

      const summaryPath = getSummaryPath(logPath);
      await Bun.write(summaryPath, "{ definitely not json");

      const session = {
        path: logPath,
        name: "test.jsonl",
        projectName: getProjectName("/path/to/project"),
        timestamp: Date.now(),
      };
      const stats = await computeSessionStats(session);
      expect(stats.totalFixes).toBe(1);
      expect(stats.iterations).toBe(1);

      const repairedSummary = await readSessionSummary(logPath);
      expect(repairedSummary).not.toBeNull();
      expect(repairedSummary?.totalFixes).toBe(1);
      expect(repairedSummary?.iterations).toBe(1);
    });

    test("uses session_end status from rebuilt summary when summary file is missing", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project");
      const systemEntry: SystemEntry = {
        type: "system",
        timestamp: Date.now(),
        projectPath: "/path/to/project",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      };
      const sessionEndEntry: SessionEndEntry = {
        type: "session_end",
        timestamp: Date.now() + 1,
        status: "interrupted",
        reason: "manual stop",
        iterations: 0,
      };

      await Bun.write(
        logPath,
        `${JSON.stringify(systemEntry)}\n${JSON.stringify(sessionEndEntry)}\n`,
        {
          createPath: true,
        }
      );

      const session = {
        path: logPath,
        name: "test.jsonl",
        projectName: getProjectName("/path/to/project"),
        timestamp: Date.now(),
      };
      const stats = await computeSessionStats(session);
      expect(stats.status).toBe("interrupted");
      expect(stats.iterations).toBe(0);
    });

    test("derives interrupted status from rebuilt iteration error message", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project");
      const systemEntry: SystemEntry = {
        type: "system",
        timestamp: Date.now(),
        projectPath: "/path/to/project",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      };
      const interruptedIteration: IterationEntry = {
        type: "iteration",
        timestamp: Date.now() + 1,
        iteration: 1,
        error: {
          phase: "reviewer",
          message: "Interrupt signal received",
        },
      };

      await Bun.write(
        logPath,
        `${JSON.stringify(systemEntry)}\n${JSON.stringify(interruptedIteration)}\n`,
        { createPath: true }
      );

      const session = {
        path: logPath,
        name: "test.jsonl",
        projectName: getProjectName("/path/to/project"),
        timestamp: Date.now(),
      };
      const stats = await computeSessionStats(session);
      expect(stats.status).toBe("interrupted");
      expect(stats.iterations).toBe(1);
    });

    test("derives failed status from rebuilt non-interrupt iteration error", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project");
      const systemEntry: SystemEntry = {
        type: "system",
        timestamp: Date.now(),
        projectPath: "/path/to/project",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      };
      const failedIteration: IterationEntry = {
        type: "iteration",
        timestamp: Date.now() + 1,
        iteration: 1,
        error: {
          phase: "reviewer",
          message: "Agent crashed unexpectedly",
        },
      };

      await Bun.write(
        logPath,
        `${JSON.stringify(systemEntry)}\n${JSON.stringify(failedIteration)}\n`,
        {
          createPath: true,
        }
      );

      const session = {
        path: logPath,
        name: "test.jsonl",
        projectName: getProjectName("/path/to/project"),
        timestamp: Date.now(),
      };
      const stats = await computeSessionStats(session);
      expect(stats.status).toBe("failed");
      expect(stats.iterations).toBe(1);
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
        fixes: buildFixSummary({
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
        }),
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
        fixes: buildFixSummary({
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
          skipped: [{ id: 3, title: "Skip 1", priority: "P3", reason: "minor" }],
        }),
      } as IterationEntry);

      const sessions = await listProjectLogSessions(tempDir, "/path/to/project");
      const projectStats = await computeProjectStats(getProjectName("/path/to/project"), sessions);

      expect(projectStats.totalFixes).toBe(3);
      expect(projectStats.totalSkipped).toBe(1);
      expect(projectStats.priorityCounts.P0).toBe(1);
      expect(projectStats.priorityCounts.P1).toBe(1);
      expect(projectStats.priorityCounts.P2).toBe(1);
      expect(projectStats.sessionCount).toBe(2);
      expect(projectStats.averageIterations).toBe(1);
      expect(projectStats.displayName).toBe("project");
    });

    test("counts unresolved batch-fix results in fix-rate stats", async () => {
      const logPath = await createLogSession(tempDir, "/path/to/project", "main");
      await appendLog(logPath, {
        type: "system",
        timestamp: Date.now(),
        projectPath: "/path/to/project",
        gitBranch: "main",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      } as SystemEntry);
      await appendLog(logPath, {
        type: "batch_fix",
        timestamp: Date.now(),
        selectedFindingIds: ["F001", "F002"],
        fixResults: [
          {
            findingId: "F001",
            status: "resolved",
            summary: "Resolved F001",
          },
          {
            findingId: "F002",
            status: "unresolved",
            summary: "Could not safely remediate F002",
          },
        ],
      });

      const sessions = await listProjectLogSessions(tempDir, "/path/to/project");
      const projectStats = await computeProjectStats(getProjectName("/path/to/project"), sessions);

      expect(projectStats.totalFixes).toBe(1);
      expect(projectStats.totalSkipped).toBe(1);
      expect(projectStats.fixRate).toBe(0.5);
      expect(projectStats.sessions[0]?.totalResolvedSelectedFindings).toBe(1);
      expect(projectStats.sessions[0]?.totalUnresolvedSelectedFindings).toBe(1);
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
      const projectStats = await computeProjectStats(getProjectName("/path/to/project"), sessions);

      expect(projectStats.displayName).toBe("project");
    });
  });

  describe("deleteSessionFiles", () => {
    test("deletes both session files when they exist", async () => {
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
      await appendLog(logPath, systemEntry);

      expect(await Bun.file(logPath).exists()).toBe(true);
      expect(await Bun.file(getSummaryPath(logPath)).exists()).toBe(true);

      await deleteSessionFiles(logPath);

      expect(await Bun.file(logPath).exists()).toBe(false);
      expect(await Bun.file(getSummaryPath(logPath)).exists()).toBe(false);
    });

    test("succeeds when no files exist", async () => {
      const logPath = join(tempDir, "nonexistent", "session.jsonl");

      // Should not throw
      await deleteSessionFiles(logPath);
    });
  });
});
