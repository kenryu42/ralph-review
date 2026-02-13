import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cleanupStaleLockfile,
  createLockfile,
  getLockPath,
  hasActiveLockfile,
  isProcessAlive,
  LOCK_SCHEMA_VERSION,
  listAllActiveSessions,
  PENDING_STARTUP_TIMEOUT_MS,
  RUNNING_STALE_AFTER_MS,
  readLockfile,
  removeLockfile,
  STOPPING_STALE_AFTER_MS,
  touchHeartbeat,
  updateLockfile,
} from "@/lib/lockfile";

describe("lockfile", () => {
  let tempLogsDir: string;

  beforeEach(async () => {
    tempLogsDir = join(tmpdir(), `ralph-lockfile-test-${Date.now()}`);
    await mkdir(tempLogsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempLogsDir, { recursive: true, force: true });
  });

  describe("getLockPath", () => {
    test("returns flattened project lock path", () => {
      const result = getLockPath(tempLogsDir, "/Users/foo/my-project");
      expect(result).toContain("users-foo-my-project.lock");
      expect(result).toBe(`${tempLogsDir}/users-foo-my-project.lock`);
    });
  });

  describe("createLockfile / readLockfile", () => {
    test("creates v2 lockfile with lifecycle metadata", async () => {
      const projectPath = "/Users/test/project";

      await createLockfile(tempLogsDir, projectPath, "rr-test-123", "main");

      const data = await readLockfile(tempLogsDir, projectPath);
      expect(data).not.toBeNull();
      expect(data?.schemaVersion).toBe(LOCK_SCHEMA_VERSION);
      expect(typeof data?.sessionId).toBe("string");
      expect(data?.sessionName).toBe("rr-test-123");
      expect(data?.projectPath).toBe(projectPath);
      expect(data?.branch).toBe("main");
      expect(data?.state).toBe("pending");
      expect(data?.mode).toBe("background");
      expect(data?.currentAgent).toBeNull();
      expect(typeof data?.lastHeartbeat).toBe("number");
    });

    test("readLockfile returns null for missing lock", async () => {
      const data = await readLockfile(tempLogsDir, "/nonexistent/path");
      expect(data).toBeNull();
    });
  });

  describe("updateLockfile", () => {
    test("updates fields in existing lockfile", async () => {
      const projectPath = "/Users/test/project";
      await createLockfile(tempLogsDir, projectPath, "rr-test-123", "main");

      const before = await readLockfile(tempLogsDir, projectPath);
      const applied = await updateLockfile(
        tempLogsDir,
        projectPath,
        {
          iteration: 3,
          state: "running",
          mode: "foreground",
          currentAgent: "fixer",
        },
        { expectedSessionId: before?.sessionId }
      );

      expect(applied).toBe(true);
      const after = await readLockfile(tempLogsDir, projectPath);
      expect(after?.iteration).toBe(3);
      expect(after?.state).toBe("running");
      expect(after?.mode).toBe("foreground");
      expect(after?.currentAgent).toBe("fixer");
    });

    test("rejects update when expectedSessionId mismatches", async () => {
      const projectPath = "/Users/test/project-guard";
      await createLockfile(tempLogsDir, projectPath, "rr-test-guard", "main");

      const applied = await updateLockfile(
        tempLogsDir,
        projectPath,
        {
          iteration: 99,
        },
        { expectedSessionId: "different-session-id" }
      );

      expect(applied).toBe(false);
      const data = await readLockfile(tempLogsDir, projectPath);
      expect(data?.iteration).toBeUndefined();
    });

    test("clears optional fields when updated with undefined", async () => {
      const projectPath = "/Users/test/project-clear";
      await createLockfile(tempLogsDir, projectPath, "rr-test-clear", "main");

      const created = await readLockfile(tempLogsDir, projectPath);
      await updateLockfile(
        tempLogsDir,
        projectPath,
        {
          reviewSummary: {
            findings: [],
            overall_correctness: "patch is correct",
            overall_explanation: "clean",
            overall_confidence_score: 0.99,
          },
          codexReviewText: "hello",
        },
        { expectedSessionId: created?.sessionId }
      );

      await updateLockfile(
        tempLogsDir,
        projectPath,
        {
          reviewSummary: undefined,
          codexReviewText: undefined,
        },
        { expectedSessionId: created?.sessionId }
      );

      const data = await readLockfile(tempLogsDir, projectPath);
      expect(data?.reviewSummary).toBeUndefined();
      expect(data?.codexReviewText).toBeUndefined();
    });
  });

  describe("touchHeartbeat", () => {
    test("updates lastHeartbeat for matching session", async () => {
      const projectPath = "/Users/test/project-heartbeat";
      await createLockfile(tempLogsDir, projectPath, "rr-heartbeat", "main");

      const before = await readLockfile(tempLogsDir, projectPath);
      expect(before).not.toBeNull();
      const previousHeartbeat = before?.lastHeartbeat ?? 0;

      await new Promise((resolve) => setTimeout(resolve, 5));
      const touched = await touchHeartbeat(tempLogsDir, projectPath, before?.sessionId);
      expect(touched).toBe(true);

      const after = await readLockfile(tempLogsDir, projectPath);
      expect((after?.lastHeartbeat ?? 0) > previousHeartbeat).toBe(true);
    });
  });

  describe("removeLockfile", () => {
    test("removes lockfile with matching session guard", async () => {
      const projectPath = "/Users/test/project";
      await createLockfile(tempLogsDir, projectPath, "rr-test-123", "main");
      const lock = await readLockfile(tempLogsDir, projectPath);

      const removed = await removeLockfile(tempLogsDir, projectPath, {
        expectedSessionId: lock?.sessionId,
      });

      expect(removed).toBe(true);
      expect(await readLockfile(tempLogsDir, projectPath)).toBeNull();
    });

    test("does not remove lockfile when guard does not match", async () => {
      const projectPath = "/Users/test/project-guard";
      await createLockfile(tempLogsDir, projectPath, "rr-test-guard", "main");

      const removed = await removeLockfile(tempLogsDir, projectPath, {
        expectedSessionId: "different-session-id",
      });

      expect(removed).toBe(false);
      expect(await readLockfile(tempLogsDir, projectPath)).not.toBeNull();
    });
  });

  describe("isProcessAlive", () => {
    test("returns true for current process", () => {
      expect(isProcessAlive(process.pid)).toBe(true);
    });

    test("returns false for invalid/non-existent pid", () => {
      expect(isProcessAlive(-1)).toBe(false);
      expect(isProcessAlive(999999999)).toBe(false);
    });
  });

  describe("cleanupStaleLockfile", () => {
    test("keeps pending lockfile within startup timeout", async () => {
      const projectPath = "/Users/test/project-pending-fresh";
      await createLockfile(tempLogsDir, projectPath, "rr-pending-fresh", {
        branch: "main",
        state: "pending",
        startTime: Date.now(),
        lastHeartbeat: Date.now(),
        pid: 999999999,
      });

      const cleaned = await cleanupStaleLockfile(tempLogsDir, projectPath);
      expect(cleaned).toBe(false);
      expect(await readLockfile(tempLogsDir, projectPath)).not.toBeNull();
    });

    test("removes pending lockfile after startup timeout when tmux session is missing", async () => {
      const projectPath = "/Users/test/project-pending-stale";
      const oldStartTime = Date.now() - PENDING_STARTUP_TIMEOUT_MS - 2_000;
      await createLockfile(tempLogsDir, projectPath, "rr-pending-stale", {
        branch: "main",
        state: "pending",
        startTime: oldStartTime,
        lastHeartbeat: oldStartTime,
        pid: 999999999,
      });

      const cleaned = await cleanupStaleLockfile(tempLogsDir, projectPath);
      expect(cleaned).toBe(true);
      expect(await readLockfile(tempLogsDir, projectPath)).toBeNull();
    });

    test("removes stale running lockfile when heartbeat expired and pid is dead", async () => {
      const projectPath = "/Users/test/project-running-stale";
      const oldHeartbeat = Date.now() - RUNNING_STALE_AFTER_MS - 2_000;
      await createLockfile(tempLogsDir, projectPath, "rr-running-stale", {
        branch: "main",
        state: "running",
        lastHeartbeat: oldHeartbeat,
        startTime: oldHeartbeat,
        pid: 999999999,
      });

      const cleaned = await cleanupStaleLockfile(tempLogsDir, projectPath);
      expect(cleaned).toBe(true);
      expect(await readLockfile(tempLogsDir, projectPath)).toBeNull();
    });

    test("keeps running lockfile with fresh heartbeat", async () => {
      const projectPath = "/Users/test/project-running-fresh";
      await createLockfile(tempLogsDir, projectPath, "rr-running-fresh", {
        branch: "main",
        state: "running",
        lastHeartbeat: Date.now(),
        startTime: Date.now(),
        pid: 999999999,
      });

      const cleaned = await cleanupStaleLockfile(tempLogsDir, projectPath);
      expect(cleaned).toBe(false);
      expect(await readLockfile(tempLogsDir, projectPath)).not.toBeNull();
    });

    test("removes stale stopping lockfile when tmux session is gone", async () => {
      const projectPath = "/Users/test/project-stopping-stale";
      const oldHeartbeat = Date.now() - STOPPING_STALE_AFTER_MS - 2_000;
      await createLockfile(tempLogsDir, projectPath, "rr-stopping-stale", {
        branch: "main",
        state: "stopping",
        lastHeartbeat: oldHeartbeat,
        startTime: oldHeartbeat,
        pid: 999999999,
      });

      const cleaned = await cleanupStaleLockfile(tempLogsDir, projectPath);
      expect(cleaned).toBe(true);
      expect(await readLockfile(tempLogsDir, projectPath)).toBeNull();
    });
  });

  describe("hasActiveLockfile", () => {
    test("returns true for fresh active lock", async () => {
      const projectPath = "/Users/test/project-active";
      await createLockfile(tempLogsDir, projectPath, "rr-active", {
        branch: "main",
        state: "running",
        lastHeartbeat: Date.now(),
      });

      const active = await hasActiveLockfile(tempLogsDir, projectPath);
      expect(active).toBe(true);
    });

    test("returns false for terminal lock", async () => {
      const projectPath = "/Users/test/project-terminal";
      await createLockfile(tempLogsDir, projectPath, "rr-terminal", {
        branch: "main",
        state: "completed",
        lastHeartbeat: Date.now(),
      });

      const active = await hasActiveLockfile(tempLogsDir, projectPath);
      expect(active).toBe(false);
    });
  });

  describe("listAllActiveSessions", () => {
    test("returns only active non-stale sessions", async () => {
      await createLockfile(tempLogsDir, "/project/active", "rr-active-123", {
        branch: "main",
        state: "running",
        lastHeartbeat: Date.now(),
      });
      await createLockfile(tempLogsDir, "/project/terminal", "rr-terminal-123", {
        branch: "main",
        state: "completed",
        lastHeartbeat: Date.now(),
      });
      await createLockfile(tempLogsDir, "/project/stale", "rr-stale-123", {
        branch: "main",
        state: "running",
        lastHeartbeat: Date.now() - RUNNING_STALE_AFTER_MS - 2_000,
        pid: 999999999,
      });

      const sessions = await listAllActiveSessions(tempLogsDir);
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.sessionName).toBe("rr-active-123");
    });
  });
});
