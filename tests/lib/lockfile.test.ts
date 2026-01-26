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
    test("returns path with sanitized project and branch", () => {
      const result = getLockPath(tempLogsDir, "/Users/foo/my-project", "feature/add-stuff");
      expect(result).toContain("users-foo-my-project");
      expect(result).toContain("feature-add-stuff.lock");
    });

    test("uses 'default' when branch is undefined", () => {
      const result = getLockPath(tempLogsDir, "/Users/foo/my-project", undefined);
      expect(result).toContain("default.lock");
    });

    test("uses 'default' when branch is empty string", () => {
      const result = getLockPath(tempLogsDir, "/Users/foo/my-project", "");
      expect(result).toContain("default.lock");
    });
  });

  describe("createLockfile / readLockfile", () => {
    test("creates lockfile with correct data", async () => {
      const projectPath = "/Users/test/project";
      const branch = "main";

      await createLockfile(tempLogsDir, projectPath, branch, "rr-test-123");

      const data = await readLockfile(tempLogsDir, projectPath, branch);
      expect(data).not.toBeNull();
      expect(data?.sessionName).toBe("rr-test-123");
      expect(data?.projectPath).toBe(projectPath);
      expect(data?.branch).toBe("main");
      expect(data?.pid).toBe(process.pid);
      expect(data?.status).toBe("pending");
      expect(typeof data?.startTime).toBe("number");
    });

    test("readLockfile returns null when file does not exist", async () => {
      const data = await readLockfile(tempLogsDir, "/nonexistent/path", "main");
      expect(data).toBeNull();
    });
  });

  describe("removeLockfile", () => {
    test("removes existing lockfile", async () => {
      const projectPath = "/Users/test/project";
      const branch = "main";

      await createLockfile(tempLogsDir, projectPath, branch, "rr-test-123");
      await removeLockfile(tempLogsDir, projectPath, branch);

      const data = await readLockfile(tempLogsDir, projectPath, branch);
      expect(data).toBeNull();
    });

    test("does not throw when lockfile does not exist", async () => {
      await expect(
        removeLockfile(tempLogsDir, "/nonexistent/path", "main")
      ).resolves.toBeUndefined();
    });
  });

  describe("updateLockfile", () => {
    test("updates iteration in existing lockfile", async () => {
      const projectPath = "/Users/test/project";
      const branch = "main";

      await createLockfile(tempLogsDir, projectPath, branch, "rr-test-123");
      await updateLockfile(tempLogsDir, projectPath, branch, { iteration: 3 });

      const data = await readLockfile(tempLogsDir, projectPath, branch);
      expect(data?.iteration).toBe(3);
      expect(data?.sessionName).toBe("rr-test-123"); // preserved
    });

    test("does nothing when lockfile does not exist", async () => {
      await expect(
        updateLockfile(tempLogsDir, "/nonexistent/path", "main", { iteration: 1 })
      ).resolves.toBeUndefined();
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
      const branch = "main";

      // Create lockfile manually with dead PID
      const lockPath = getLockPath(tempLogsDir, projectPath, branch);
      const projectDir = lockPath.substring(0, lockPath.lastIndexOf("/"));
      await mkdir(projectDir, { recursive: true });
      await Bun.write(
        lockPath,
        JSON.stringify({
          sessionName: "rr-dead-session",
          startTime: Date.now(),
          pid: 999999999, // dead PID
          projectPath,
          branch,
        })
      );

      const cleaned = await cleanupStaleLockfile(tempLogsDir, projectPath, branch);
      expect(cleaned).toBe(true);

      const data = await readLockfile(tempLogsDir, projectPath, branch);
      expect(data).toBeNull();
    });

    test("keeps lockfile when PID is alive", async () => {
      const projectPath = "/Users/test/project";
      const branch = "main";

      await createLockfile(tempLogsDir, projectPath, branch, "rr-test-123");

      const cleaned = await cleanupStaleLockfile(tempLogsDir, projectPath, branch);
      expect(cleaned).toBe(false);

      const data = await readLockfile(tempLogsDir, projectPath, branch);
      expect(data).not.toBeNull();
    });

    test("returns false when lockfile does not exist", async () => {
      const cleaned = await cleanupStaleLockfile(tempLogsDir, "/nonexistent/path", "main");
      expect(cleaned).toBe(false);
    });

    test("keeps pending lockfile during grace period even with dead PID", async () => {
      const projectPath = "/Users/test/project-pending";
      const branch = "main";

      // Create lockfile manually with dead PID but pending status and recent timestamp
      const lockPath = getLockPath(tempLogsDir, projectPath, branch);
      const projectDir = lockPath.substring(0, lockPath.lastIndexOf("/"));
      await mkdir(projectDir, { recursive: true });
      await Bun.write(
        lockPath,
        JSON.stringify({
          sessionName: "rr-pending-session",
          startTime: Date.now(), // Just created
          pid: 999999999, // Dead PID - would normally be stale
          projectPath,
          branch,
          status: "pending",
        })
      );

      // Should NOT clean up because it's pending and within grace period
      const cleaned = await cleanupStaleLockfile(tempLogsDir, projectPath, branch);
      expect(cleaned).toBe(false);

      const data = await readLockfile(tempLogsDir, projectPath, branch);
      expect(data).not.toBeNull();
    });

    test("removes old pending lockfile that exceeded grace period", async () => {
      const projectPath = "/Users/test/project-old-pending";
      const branch = "main";

      // Create lockfile manually with dead PID, pending status but old timestamp
      const lockPath = getLockPath(tempLogsDir, projectPath, branch);
      const projectDir = lockPath.substring(0, lockPath.lastIndexOf("/"));
      await mkdir(projectDir, { recursive: true });
      await Bun.write(
        lockPath,
        JSON.stringify({
          sessionName: "rr-old-pending-session",
          startTime: Date.now() - 60_000, // 60 seconds ago (> 30 second grace period)
          pid: 999999999, // Dead PID
          projectPath,
          branch,
          status: "pending",
        })
      );

      // Should clean up because pending lockfile exceeded grace period
      const cleaned = await cleanupStaleLockfile(tempLogsDir, projectPath, branch);
      expect(cleaned).toBe(true);

      const data = await readLockfile(tempLogsDir, projectPath, branch);
      expect(data).toBeNull();
    });
  });

  describe("listAllActiveSessions", () => {
    test("returns empty array when no lockfiles exist", async () => {
      const sessions = await listAllActiveSessions(tempLogsDir);
      expect(sessions).toEqual([]);
    });

    test("lists active sessions across multiple projects", async () => {
      await createLockfile(tempLogsDir, "/project/one", "main", "rr-one-123");
      await createLockfile(tempLogsDir, "/project/two", "develop", "rr-two-456");

      const sessions = await listAllActiveSessions(tempLogsDir);
      expect(sessions.length).toBe(2);

      const sessionNames = sessions.map((session) => session.sessionName);
      expect(sessionNames).toContain("rr-one-123");
      expect(sessionNames).toContain("rr-two-456");
    });

    test("excludes stale sessions with dead PIDs", async () => {
      // Create active session
      await createLockfile(tempLogsDir, "/project/active", "main", "rr-active-123");

      // Create stale session with dead PID
      const staleLockPath = getLockPath(tempLogsDir, "/project/stale", "main");
      const staleDir = staleLockPath.substring(0, staleLockPath.lastIndexOf("/"));
      await mkdir(staleDir, { recursive: true });
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
      const pendingLockPath = getLockPath(tempLogsDir, "/project/pending", "main");
      const pendingDir = pendingLockPath.substring(0, pendingLockPath.lastIndexOf("/"));
      await mkdir(pendingDir, { recursive: true });
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
      const oldPendingLockPath = getLockPath(tempLogsDir, "/project/old-pending", "main");
      const oldPendingDir = oldPendingLockPath.substring(0, oldPendingLockPath.lastIndexOf("/"));
      await mkdir(oldPendingDir, { recursive: true });
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
