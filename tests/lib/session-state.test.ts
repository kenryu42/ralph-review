import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProjectName } from "@/lib/logger";
import {
  cleanupStaleSessionStates,
  createSessionId,
  createSessionState,
  getLatestProjectActiveSession,
  getSessionStatePath,
  isProcessAlive,
  listAllActiveSessions,
  listProjectActiveSessions,
  PENDING_STARTUP_TIMEOUT_MS,
  readSessionState,
  removeAllSessionStates,
  removeSessionState,
  SESSION_STATE_SCHEMA_VERSION,
  STOPPING_STALE_AFTER_MS,
  touchSessionHeartbeat,
  updateSessionState,
} from "@/lib/session-state";

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

describe("session-state", () => {
  let tempLogsDir: string;

  beforeEach(async () => {
    tempLogsDir = join(tmpdir(), `ralph-session-state-test-${Date.now()}-${crypto.randomUUID()}`);
    await mkdir(tempLogsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempLogsDir, { recursive: true, force: true });
  });

  test("builds a per-session state path inside the project storage directory", () => {
    const projectPath = "/Users/foo/my-project";
    const sessionId = "session-123";
    const projectName = getProjectName(projectPath);

    expect(getSessionStatePath(tempLogsDir, projectPath, sessionId)).toBe(
      `${tempLogsDir}/${projectName}/session-${sessionId}.json`
    );
  });

  test("creates unique session ids", () => {
    const first = createSessionId();
    const second = createSessionId();

    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
  });

  test("stores multiple active session states for the same project", async () => {
    const projectPath = "/Users/test/project";

    await createSessionState(tempLogsDir, projectPath, "rr-test-a", {
      sessionId: "session-a",
      branch: "main",
      state: "running",
    });
    await createSessionState(tempLogsDir, projectPath, "rr-test-b", {
      sessionId: "session-b",
      branch: "main",
      state: "running",
    });

    const sessionA = await readSessionState(tempLogsDir, projectPath, "session-a");
    const sessionB = await readSessionState(tempLogsDir, projectPath, "session-b");
    const projectSessions = await listProjectActiveSessions(tempLogsDir, projectPath);

    expect(sessionA?.schemaVersion).toBe(SESSION_STATE_SCHEMA_VERSION);
    expect(sessionA?.sessionName).toBe("rr-test-a");
    expect(sessionB?.schemaVersion).toBe(SESSION_STATE_SCHEMA_VERSION);
    expect(sessionB?.sessionName).toBe("rr-test-b");
    expect(projectSessions.map((session) => session.sessionId).sort()).toEqual([
      "session-a",
      "session-b",
    ]);
  });

  test("rejects blank session ids when creating session state", async () => {
    await expect(
      createSessionState(tempLogsDir, "/Users/test/project-invalid", "rr-invalid", {
        sessionId: "   ",
      })
    ).rejects.toThrow("sessionId is required");
  });

  test("returns null when the session state file contains invalid JSON", async () => {
    const projectPath = "/Users/test/project-invalid-json";
    const sessionPath = getSessionStatePath(tempLogsDir, projectPath, "session-invalid-json");

    await mkdir(join(tempLogsDir, getProjectName(projectPath)), { recursive: true });
    await Bun.write(sessionPath, "{invalid");

    const session = await readSessionState(tempLogsDir, projectPath, "session-invalid-json");

    expect(session).toBeNull();
  });

  test("returns null when the session state file is missing required fields", async () => {
    const projectPath = "/Users/test/project-invalid-shape";
    const sessionPath = getSessionStatePath(tempLogsDir, projectPath, "session-invalid-shape");

    await mkdir(join(tempLogsDir, getProjectName(projectPath)), { recursive: true });
    await Bun.write(
      sessionPath,
      JSON.stringify({
        sessionId: "session-invalid-shape",
        sessionName: "rr-invalid-shape",
        startTime: Date.now(),
        projectPath,
        state: "not-a-valid-state",
      })
    );

    const session = await readSessionState(tempLogsDir, projectPath, "session-invalid-shape");

    expect(session).toBeNull();
  });

  test("updates heartbeats and removes only the targeted session state", async () => {
    const projectPath = "/Users/test/project-targeted";

    await createSessionState(tempLogsDir, projectPath, "rr-test-a", {
      sessionId: "session-a",
      branch: "main",
      state: "running",
    });
    await createSessionState(tempLogsDir, projectPath, "rr-test-b", {
      sessionId: "session-b",
      branch: "main",
      state: "running",
    });

    const before = await readSessionState(tempLogsDir, projectPath, "session-a");
    expect(before).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 5));
    const touched = await touchSessionHeartbeat(tempLogsDir, projectPath, "session-a");
    const updated = await updateSessionState(
      tempLogsDir,
      projectPath,
      "session-a",
      {
        iteration: 3,
        currentAgent: "fixer",
      },
      { expectedSessionId: "session-a" }
    );
    const removed = await removeSessionState(tempLogsDir, projectPath, "session-b", {
      expectedSessionId: "session-b",
    });

    const after = await readSessionState(tempLogsDir, projectPath, "session-a");
    const other = await readSessionState(tempLogsDir, projectPath, "session-b");

    expect(touched).toBe(true);
    expect(updated).toBe(true);
    expect(removed).toBe(true);
    expect((after?.lastHeartbeat ?? 0) > (before?.lastHeartbeat ?? 0)).toBe(true);
    expect(after?.iteration).toBe(3);
    expect(after?.currentAgent).toBe("fixer");
    expect(other).toBeNull();
  });

  test("returns false when updating a missing session state", async () => {
    const updated = await updateSessionState(
      tempLogsDir,
      "/Users/test/project-missing-update",
      "missing-session",
      { state: "running" }
    );

    expect(updated).toBe(false);
  });

  test("returns false when session state update guard does not match", async () => {
    const projectPath = "/Users/test/project-guard-update";

    await createSessionState(tempLogsDir, projectPath, "rr-test-guard", {
      sessionId: "session-guard",
      branch: "main",
      state: "running",
      reason: "keep",
    });

    const updated = await updateSessionState(
      tempLogsDir,
      projectPath,
      "session-guard",
      { state: "stopping" },
      { expectedSessionId: "different-session-id" }
    );
    const session = await readSessionState(tempLogsDir, projectPath, "session-guard");

    expect(updated).toBe(false);
    expect(session?.state).toBe("running");
  });

  test("stores handoff metadata on create and update", async () => {
    const projectPath = "/Users/test/project-handoff";

    await createSessionState(tempLogsDir, projectPath, "rr-handoff", {
      sessionId: "session-handoff",
      branch: "main",
      state: "running",
      handoffStatus: "pending-apply",
      handoffUpdatedAt: 1_700_000_000_000,
      commitSha: "commit-sha-1",
    });

    await updateSessionState(tempLogsDir, projectPath, "session-handoff", {
      handoffStatus: "applied-auto",
      handoffUpdatedAt: 1_700_000_000_100,
    });

    const session = await readSessionState(tempLogsDir, projectPath, "session-handoff");

    expect(session?.handoffStatus).toBe("applied-auto");
    expect(session?.handoffUpdatedAt).toBe(1_700_000_000_100);
    expect(session?.commitSha).toBe("commit-sha-1");
  });

  test("stores workflow metadata on create and update", async () => {
    const projectPath = "/Users/test/project-workflow";

    await createSessionState(tempLogsDir, projectPath, "rr-workflow", {
      sessionId: "session-workflow",
      branch: "main",
      state: "running",
      currentPhase: "discovery",
      sessionStatus: "running",
      artifactPath: "/tmp/findings/session-workflow.json",
      reviewedSnapshotPath: "/tmp/reviewed/session-workflow",
      sourceFingerprint: "fingerprint-1",
      accumulatedFindings: [createStoredFinding("F001", "P0")],
      selectedFindingIds: ["F001"],
      latestAudit: {
        resolvedFindingIds: [],
        unresolvedFindingIds: ["F001"],
        regressionFindings: [],
      },
    });

    await updateSessionState(tempLogsDir, projectPath, "session-workflow", {
      currentPhase: "final-audit",
      sessionStatus: "completed",
      selectedFindingIds: ["F001", "F002"],
      latestAudit: {
        resolvedFindingIds: ["F001"],
        unresolvedFindingIds: ["F002"],
        regressionFindings: [createStoredFinding("F010", "P1")],
      },
    });

    const session = await readSessionState(tempLogsDir, projectPath, "session-workflow");

    expect(session?.currentPhase).toBe("final-audit");
    expect(session?.sessionStatus).toBe("completed");
    expect(session?.artifactPath).toBe("/tmp/findings/session-workflow.json");
    expect(session?.reviewedSnapshotPath).toBe("/tmp/reviewed/session-workflow");
    expect(session?.sourceFingerprint).toBe("fingerprint-1");
    expect(session?.accumulatedFindings?.map((finding) => finding.id)).toEqual(["F001"]);
    expect(session?.selectedFindingIds).toEqual(["F001", "F002"]);
    expect(session?.latestAudit?.resolvedFindingIds).toEqual(["F001"]);
    expect(session?.latestAudit?.unresolvedFindingIds).toEqual(["F002"]);
    expect(session?.latestAudit?.regressionFindings.map((finding) => finding.id)).toEqual(["F010"]);
  });

  test("removes fields when updateSessionState receives undefined values", async () => {
    const projectPath = "/Users/test/project-undefined-update";

    await createSessionState(tempLogsDir, projectPath, "rr-test-update", {
      sessionId: "session-update",
      branch: "main",
      state: "running",
      reason: "stop requested",
      worktreeBranch: "rr-worktree-session-update",
    });

    const updated = await updateSessionState(tempLogsDir, projectPath, "session-update", {
      reason: undefined,
      worktreeBranch: undefined,
    });
    const session = await readSessionState(tempLogsDir, projectPath, "session-update");

    expect(updated).toBe(true);
    expect(session?.reason).toBeUndefined();
    expect(session?.worktreeBranch).toBeUndefined();
  });

  test("returns false when removing a missing session state", async () => {
    const removed = await removeSessionState(
      tempLogsDir,
      "/Users/test/project-missing-remove",
      "missing-session"
    );

    expect(removed).toBe(false);
  });

  test("returns false when remove guard does not match", async () => {
    const projectPath = "/Users/test/project-guard-remove";

    await createSessionState(tempLogsDir, projectPath, "rr-test-remove", {
      sessionId: "session-remove",
      branch: "main",
      state: "running",
    });

    const removed = await removeSessionState(tempLogsDir, projectPath, "session-remove", {
      expectedSessionId: "different-session-id",
    });
    const session = await readSessionState(tempLogsDir, projectPath, "session-remove");

    expect(removed).toBe(false);
    expect(session?.sessionId).toBe("session-remove");
  });

  test("returns the newest active session for a project", async () => {
    const projectPath = "/Users/test/project-newest";

    await createSessionState(tempLogsDir, projectPath, "rr-older", {
      sessionId: "session-old",
      branch: "main",
      state: "running",
      startTime: 100,
      lastHeartbeat: Date.now(),
    });
    await createSessionState(tempLogsDir, projectPath, "rr-newer", {
      sessionId: "session-new",
      branch: "main",
      state: "running",
      startTime: 200,
      lastHeartbeat: Date.now(),
    });

    const latest = await getLatestProjectActiveSession(tempLogsDir, projectPath);

    expect(latest?.sessionId).toBe("session-new");
    expect(latest?.sessionName).toBe("rr-newer");
  });

  test("returns null when a project has no active sessions", async () => {
    const latest = await getLatestProjectActiveSession(tempLogsDir, "/Users/test/project-empty");

    expect(latest).toBeNull();
  });

  test("cleans stale session states without removing healthy sibling sessions", async () => {
    const projectPath = "/Users/test/project-cleanup";

    await createSessionState(tempLogsDir, projectPath, "rr-stale", {
      sessionId: "session-stale",
      branch: "main",
      state: "running",
      pid: 999_999,
      startTime: Date.now() - 60_000,
      lastHeartbeat: Date.now() - 60_000,
    });
    await createSessionState(tempLogsDir, projectPath, "rr-healthy", {
      sessionId: "session-healthy",
      branch: "main",
      state: "running",
      pid: process.pid,
      startTime: Date.now() - 5_000,
      lastHeartbeat: Date.now(),
    });

    const cleaned = await cleanupStaleSessionStates(tempLogsDir, projectPath);
    const projectSessions = await listProjectActiveSessions(tempLogsDir, projectPath);

    expect(cleaned).toBe(true);
    expect(projectSessions.map((session) => session.sessionId)).toEqual(["session-healthy"]);
  });

  test("keeps pending session states that are still within startup timeout", async () => {
    const projectPath = "/Users/test/project-pending-fresh";

    await createSessionState(tempLogsDir, projectPath, "rr-pending", {
      sessionId: "session-pending",
      branch: "main",
      state: "pending",
      startTime: Date.now() - (PENDING_STARTUP_TIMEOUT_MS - 1_000),
      lastHeartbeat: Date.now() - 500,
    });

    const cleaned = await cleanupStaleSessionStates(tempLogsDir, projectPath);
    const projectSessions = await listProjectActiveSessions(tempLogsDir, projectPath);

    expect(cleaned).toBe(false);
    expect(projectSessions.map((session) => session.sessionId)).toEqual(["session-pending"]);
  });

  test("removes pending session states that never started", async () => {
    const projectPath = "/Users/test/project-pending-stale";

    await createSessionState(tempLogsDir, projectPath, "rr-pending-stale", {
      sessionId: "session-pending-stale",
      branch: "main",
      state: "pending",
      startTime: Date.now() - (PENDING_STARTUP_TIMEOUT_MS + 1_000),
      lastHeartbeat: Date.now() - (PENDING_STARTUP_TIMEOUT_MS + 1_000),
    });

    const projectSessions = await listProjectActiveSessions(tempLogsDir, projectPath);
    const session = await readSessionState(tempLogsDir, projectPath, "session-pending-stale");

    expect(projectSessions).toEqual([]);
    expect(session).toBeNull();
  });

  test("keeps stopping session states with a fresh heartbeat", async () => {
    const projectPath = "/Users/test/project-stopping-fresh";

    await createSessionState(tempLogsDir, projectPath, "rr-stopping", {
      sessionId: "session-stopping",
      branch: "main",
      state: "stopping",
      startTime: Date.now() - 10_000,
      lastHeartbeat: Date.now() - (STOPPING_STALE_AFTER_MS - 1_000),
    });

    const projectSessions = await listProjectActiveSessions(tempLogsDir, projectPath);

    expect(projectSessions.map((session) => session.sessionId)).toEqual(["session-stopping"]);
  });

  test("removes stale stopping session states after tmux exits", async () => {
    const projectPath = "/Users/test/project-stopping-stale";

    await createSessionState(tempLogsDir, projectPath, "rr-stopping-stale", {
      sessionId: "session-stopping-stale",
      branch: "main",
      state: "stopping",
      startTime: Date.now() - 30_000,
      lastHeartbeat: Date.now() - (STOPPING_STALE_AFTER_MS + 1_000),
    });

    const cleaned = await cleanupStaleSessionStates(tempLogsDir, projectPath);
    const session = await readSessionState(tempLogsDir, projectPath, "session-stopping-stale");

    expect(cleaned).toBe(true);
    expect(session).toBeNull();
  });

  test("removes terminal session states from active listings", async () => {
    const projectPath = "/Users/test/project-terminal";

    await createSessionState(tempLogsDir, projectPath, "rr-completed", {
      sessionId: "session-completed",
      branch: "main",
      state: "completed",
      endTime: Date.now(),
    });

    const projectSessions = await listProjectActiveSessions(tempLogsDir, projectPath);
    const session = await readSessionState(tempLogsDir, projectPath, "session-completed");

    expect(projectSessions).toEqual([]);
    expect(session).toBeNull();
  });

  test("lists active sessions across projects", async () => {
    await createSessionState(tempLogsDir, "/Users/test/project-a", "rr-a", {
      sessionId: "session-a",
      branch: "main",
      state: "running",
      startTime: 100,
      lastHeartbeat: Date.now(),
    });
    await createSessionState(tempLogsDir, "/Users/test/project-b", "rr-b", {
      sessionId: "session-b",
      branch: "feature",
      state: "running",
      startTime: 200,
      lastHeartbeat: Date.now(),
    });

    const sessions = await listAllActiveSessions(tempLogsDir);

    expect(sessions.map((session) => session.sessionId)).toEqual(["session-b", "session-a"]);
  });

  test("removes all session states across projects", async () => {
    await createSessionState(tempLogsDir, "/Users/test/project-a", "rr-a", {
      sessionId: "session-a",
      branch: "main",
      state: "running",
    });
    await createSessionState(tempLogsDir, "/Users/test/project-b", "rr-b", {
      sessionId: "session-b",
      branch: "main",
      state: "running",
    });

    await removeAllSessionStates(tempLogsDir);

    expect(await listAllActiveSessions(tempLogsDir)).toEqual([]);
  });

  test("reports whether a process is alive", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(999_999)).toBe(false);
  });
});
