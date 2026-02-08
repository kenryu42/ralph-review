import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cleanupStaleLockfile,
  createLockfile,
  getLockPath,
  isProcessAlive,
  listAllActiveSessions,
  readLockfile,
  removeLockfile,
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
    test("returns path with sanitized project name and .lock extension", () => {
      const result = getLockPath(tempLogsDir, "/Users/foo/my-project");
      expect(result).toContain("users-foo-my-project.lock");
      // Should be flat, not nested in a branch directory
      expect(result).toBe(`${tempLogsDir}/users-foo-my-project.lock`);
    });

    test("handles different project paths", () => {
      const result1 = getLockPath(tempLogsDir, "/project/alpha");
      const result2 = getLockPath(tempLogsDir, "/project/beta");
      expect(result1).not.toBe(result2);
      expect(result1).toContain("project-alpha.lock");
      expect(result2).toContain("project-beta.lock");
    });
  });

  describe("createLockfile / readLockfile", () => {
    test("creates lockfile with correct data", async () => {
      const projectPath = "/Users/test/project";
      const branch = "main";

      await createLockfile(tempLogsDir, projectPath, "rr-test-123", branch);

      const data = await readLockfile(tempLogsDir, projectPath);
      expect(data).not.toBeNull();
      expect(data?.sessionName).toBe("rr-test-123");
      expect(data?.projectPath).toBe(projectPath);
      expect(data?.branch).toBe("main");
      expect(data?.pid).toBe(process.pid);
      expect(data?.status).toBe("pending");
      expect(data?.currentAgent).toBeNull();
      expect(typeof data?.startTime).toBe("number");
    });

    test("creates lockfile without branch (uses default)", async () => {
      const projectPath = "/Users/test/project-no-branch";

      await createLockfile(tempLogsDir, projectPath, "rr-test-456");

      const data = await readLockfile(tempLogsDir, projectPath);
      expect(data).not.toBeNull();
      expect(data?.sessionName).toBe("rr-test-456");
      expect(data?.branch).toBe("default");
    });

    test("readLockfile returns null when file does not exist", async () => {
      const data = await readLockfile(tempLogsDir, "/nonexistent/path");
      expect(data).toBeNull();
    });
  });

  describe("removeLockfile", () => {
    test("removes existing lockfile", async () => {
      const projectPath = "/Users/test/project";

      await createLockfile(tempLogsDir, projectPath, "rr-test-123", "main");
      await removeLockfile(tempLogsDir, projectPath);

      const data = await readLockfile(tempLogsDir, projectPath);
      expect(data).toBeNull();
    });

    test("does not throw when lockfile does not exist", async () => {
      await expect(removeLockfile(tempLogsDir, "/nonexistent/path")).resolves.toBeUndefined();
    });
  });

  describe("updateLockfile", () => {
    test("updates iteration in existing lockfile", async () => {
      const projectPath = "/Users/test/project";

      await createLockfile(tempLogsDir, projectPath, "rr-test-123", "main");
      await updateLockfile(tempLogsDir, projectPath, { iteration: 3 });

      const data = await readLockfile(tempLogsDir, projectPath);
      expect(data?.iteration).toBe(3);
      expect(data?.sessionName).toBe("rr-test-123"); // preserved
    });

    test("updates currentAgent in existing lockfile", async () => {
      const projectPath = "/Users/test/project-agent";

      await createLockfile(tempLogsDir, projectPath, "rr-test-agent", "main");
      await updateLockfile(tempLogsDir, projectPath, { currentAgent: "fixer" });

      const data = await readLockfile(tempLogsDir, projectPath);
      expect(data?.currentAgent).toBe("fixer");
    });

    test("does nothing when lockfile does not exist", async () => {
      await expect(
        updateLockfile(tempLogsDir, "/nonexistent/path", { iteration: 1 })
      ).resolves.toBeUndefined();
    });

    test("stores and retrieves reviewSummary", async () => {
      const projectPath = "/Users/test/project-review";

      await createLockfile(tempLogsDir, projectPath, "rr-test-review", "main");
      await updateLockfile(tempLogsDir, projectPath, {
        reviewSummary: {
          findings: [
            {
              title: "Missing null check",
              body: "Could crash",
              confidence_score: 0.9,
              priority: 1,
              code_location: {
                absolute_file_path: "/src/foo.ts",
                line_range: { start: 10, end: 12 },
              },
            },
          ],
          overall_correctness: "patch is incorrect",
          overall_explanation: "Has issues",
          overall_confidence_score: 0.85,
        },
      });

      const data = await readLockfile(tempLogsDir, projectPath);
      expect(data?.reviewSummary).toBeDefined();
      expect(data?.reviewSummary?.findings).toHaveLength(1);
      expect(data?.reviewSummary?.findings[0]?.title).toBe("Missing null check");
    });

    test("stores and retrieves codexReviewText", async () => {
      const projectPath = "/Users/test/project-codex";

      await createLockfile(tempLogsDir, projectPath, "rr-test-codex", "main");
      await updateLockfile(tempLogsDir, projectPath, {
        codexReviewText: "Some codex review output text",
      });

      const data = await readLockfile(tempLogsDir, projectPath);
      expect(data?.codexReviewText).toBe("Some codex review output text");
    });

    test("clears reviewSummary when set to undefined via spread", async () => {
      const projectPath = "/Users/test/project-clear";

      await createLockfile(tempLogsDir, projectPath, "rr-test-clear", "main");
      await updateLockfile(tempLogsDir, projectPath, {
        reviewSummary: {
          findings: [],
          overall_correctness: "patch is correct",
          overall_explanation: "Clean",
          overall_confidence_score: 0.95,
        },
      });

      // Verify it's set
      let data = await readLockfile(tempLogsDir, projectPath);
      expect(data?.reviewSummary).toBeDefined();

      // Clear by setting undefined (spread semantics)
      await updateLockfile(tempLogsDir, projectPath, {
        reviewSummary: undefined,
        codexReviewText: undefined,
      });

      data = await readLockfile(tempLogsDir, projectPath);
      // Keys explicitly set to undefined are deleted from the lockfile
      expect(data?.reviewSummary).toBeUndefined();
    });
  });

  describe("isProcessAlive", () => {
    test("returns true for current process", () => {
      expect(isProcessAlive(process.pid)).toBe(true);
    });

    test("returns false for non-existent PID", () => {
      // Use a very high PID that's unlikely to exist
      expect(isProcessAlive(999999999)).toBe(false);
    });
  });

  describe("cleanupStaleLockfile", () => {
    test("removes lockfile when PID is dead", async () => {
      const projectPath = "/Users/test/project";

      // Create lockfile manually with dead PID
      const lockPath = getLockPath(tempLogsDir, projectPath);
      await Bun.write(
        lockPath,
        JSON.stringify({
          sessionName: "rr-dead-session",
          startTime: Date.now(),
          pid: 999999999, // dead PID
          projectPath,
          branch: "main",
        })
      );

      const cleaned = await cleanupStaleLockfile(tempLogsDir, projectPath);
      expect(cleaned).toBe(true);

      const data = await readLockfile(tempLogsDir, projectPath);
      expect(data).toBeNull();
    });

    test("keeps lockfile when PID is alive", async () => {
      const projectPath = "/Users/test/project";

      await createLockfile(tempLogsDir, projectPath, "rr-test-123", "main");

      const cleaned = await cleanupStaleLockfile(tempLogsDir, projectPath);
      expect(cleaned).toBe(false);

      const data = await readLockfile(tempLogsDir, projectPath);
      expect(data).not.toBeNull();
    });

    test("returns false when lockfile does not exist", async () => {
      const cleaned = await cleanupStaleLockfile(tempLogsDir, "/nonexistent/path");
      expect(cleaned).toBe(false);
    });

    test("keeps pending lockfile during grace period even with dead PID", async () => {
      const projectPath = "/Users/test/project-pending";

      // Create lockfile manually with dead PID but pending status and recent timestamp
      const lockPath = getLockPath(tempLogsDir, projectPath);
      await Bun.write(
        lockPath,
        JSON.stringify({
          sessionName: "rr-pending-session",
          startTime: Date.now(), // Just created
          pid: 999999999, // Dead PID - would normally be stale
          projectPath,
          branch: "main",
          status: "pending",
        })
      );

      // Should NOT clean up because it's pending and within grace period
      const cleaned = await cleanupStaleLockfile(tempLogsDir, projectPath);
      expect(cleaned).toBe(false);

      const data = await readLockfile(tempLogsDir, projectPath);
      expect(data).not.toBeNull();
    });

    test("removes old pending lockfile that exceeded grace period", async () => {
      const projectPath = "/Users/test/project-old-pending";

      // Create lockfile manually with dead PID, pending status but old timestamp
      const lockPath = getLockPath(tempLogsDir, projectPath);
      await Bun.write(
        lockPath,
        JSON.stringify({
          sessionName: "rr-old-pending-session",
          startTime: Date.now() - 60_000, // 60 seconds ago (> 30 second grace period)
          pid: 999999999, // Dead PID
          projectPath,
          branch: "main",
          status: "pending",
        })
      );

      // Should clean up because pending lockfile exceeded grace period
      const cleaned = await cleanupStaleLockfile(tempLogsDir, projectPath);
      expect(cleaned).toBe(true);

      const data = await readLockfile(tempLogsDir, projectPath);
      expect(data).toBeNull();
    });
  });

  describe("listAllActiveSessions", () => {
    test("returns empty array when no lockfiles exist", async () => {
      const sessions = await listAllActiveSessions(tempLogsDir);
      expect(sessions).toEqual([]);
    });

    test("lists active sessions across multiple projects", async () => {
      await createLockfile(tempLogsDir, "/project/one", "rr-one-123", "main");
      await createLockfile(tempLogsDir, "/project/two", "rr-two-456", "develop");

      const sessions = await listAllActiveSessions(tempLogsDir);
      expect(sessions.length).toBe(2);

      const sessionNames = sessions.map((session) => session.sessionName);
      expect(sessionNames).toContain("rr-one-123");
      expect(sessionNames).toContain("rr-two-456");
    });

    test("excludes stale sessions with dead PIDs", async () => {
      // Create active session
      await createLockfile(tempLogsDir, "/project/active", "rr-active-123", "main");

      // Create stale session with dead PID
      const staleLockPath = getLockPath(tempLogsDir, "/project/stale");
      await Bun.write(
        staleLockPath,
        JSON.stringify({
          sessionName: "rr-stale-999",
          startTime: Date.now(),
          pid: 999999999,
          projectPath: "/project/stale",
          branch: "main",
        })
      );

      const sessions = await listAllActiveSessions(tempLogsDir);
      expect(sessions.length).toBe(1);
      expect(sessions[0]?.sessionName).toBe("rr-active-123");
    });

    test("includes pending sessions during grace period even with dead PID", async () => {
      // Create pending session with dead PID (simulating tmux startup)
      const pendingLockPath = getLockPath(tempLogsDir, "/project/pending");
      await Bun.write(
        pendingLockPath,
        JSON.stringify({
          sessionName: "rr-pending-123",
          startTime: Date.now(), // Just created
          pid: 999999999, // Dead PID
          projectPath: "/project/pending",
          branch: "main",
          status: "pending",
        })
      );

      const sessions = await listAllActiveSessions(tempLogsDir);
      expect(sessions.length).toBe(1);
      expect(sessions[0]?.sessionName).toBe("rr-pending-123");
    });

    test("excludes old pending sessions that exceeded grace period", async () => {
      // Create old pending session that exceeded grace period
      const oldPendingLockPath = getLockPath(tempLogsDir, "/project/old-pending");
      await Bun.write(
        oldPendingLockPath,
        JSON.stringify({
          sessionName: "rr-old-pending-123",
          startTime: Date.now() - 60_000, // 60 seconds ago
          pid: 999999999, // Dead PID
          projectPath: "/project/old-pending",
          branch: "main",
          status: "pending",
        })
      );

      const sessions = await listAllActiveSessions(tempLogsDir);
      expect(sessions.length).toBe(0);
    });
  });
});
