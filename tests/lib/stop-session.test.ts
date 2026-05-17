import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { appendLog, computeSessionStats, createLogSession, getProjectName } from "@/lib/logger";
import type { ActiveSession, SessionState } from "@/lib/session-state";
import {
  STOP_SESSION_GRACE_PERIOD_MS,
  STOP_SESSION_NO_SUCCESSFUL_ITERATION_GRACE_PERIOD_MS,
  STOP_SESSION_POLL_INTERVAL_MS,
  stopActiveSession,
} from "@/lib/stop-session";
import { getPendingFixTarget } from "@/lib/tui/dashboard/dashboard-fix-state";
import type { LogEntry } from "@/lib/types";
import type {
  RemoveSessionStateCall,
  UpdateSessionStateCall,
} from "../helpers/session-state-calls";
import { createActiveSession as createTestActiveSession } from "../helpers/tui";

function createActiveSession(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return createTestActiveSession({
    sessionId: "session-123",
    sessionName: "rr-project-main",
    startTime: 1,
    lastHeartbeat: 1,
    pid: 123,
    projectPath: "/repo/project",
    branch: "main",
    state: "running",
    mode: "background",
    iteration: undefined,
    currentAgent: undefined,
    sessionPath: undefined,
    sessionStatePath: "/tmp/session-123.json",
    worktreeProjectPath: undefined,
    ...overrides,
  });
}

function recordSessionStep(steps: string[], label: string): (sessionName: string) => Promise<void> {
  return async (sessionName) => {
    steps.push(`${label}:${sessionName}`);
  };
}

function recordSleepStep(steps: string[]): (ms: number) => Promise<void> {
  return async (ms) => {
    steps.push(`sleep:${ms}`);
  };
}

function recordRemoveStep(steps: string[]): () => Promise<boolean> {
  return async () => {
    steps.push("remove");
    return true;
  };
}

function readInterruptedSession(session: ActiveSession): Promise<SessionState> {
  return Promise.resolve({
    ...session,
    state: "interrupted",
  });
}

function readLogAfterInitialEmpty(entry: LogEntry): () => Promise<LogEntry[]> {
  let readLogCallCount = 0;
  return async () => {
    readLogCallCount += 1;
    return readLogCallCount === 1 ? [] : [entry];
  };
}

function createStoredFinding() {
  return {
    id: "F001" as const,
    fingerprint: "fp-F001",
    title: "Missing guard",
    body: "Body",
    priority: "P1" as const,
    confidenceScore: 0.91,
    filePath: "src/file.ts",
    startLine: 10,
    endLine: 12,
  };
}

function createReviewIterationEntry(
  iteration: number,
  findings: ReturnType<typeof createStoredFinding>[] = []
): LogEntry {
  return {
    type: "review_iteration",
    timestamp: Date.now(),
    iteration,
    phase: "review",
    sessionStatus: "running",
    findings,
    netNewFindingIds: findings.map((finding) => finding.id),
  };
}

async function forceStopAndCollectAppendedEntries(
  session: ActiveSession,
  entries: LogEntry[]
): Promise<LogEntry[]> {
  const appendedEntries: LogEntry[] = [];

  await stopActiveSession(session, {
    updateSessionState: async () => true,
    sendInterrupt: async () => {},
    readLog: async () => entries,
    readSessionState: async (): Promise<SessionState> => session,
    sessionExists: async () => true,
    sleep: async () => {},
    killSession: async () => {},
    resolveSourceRepoPath: () => null,
    appendLog: async (_sessionPath, entry) => {
      appendedEntries.push(entry);
    },
    removeSessionState: async () => true,
  });

  return appendedEntries;
}

async function stopAndCollectDeletedSessionPaths(
  session: ActiveSession,
  readLog: () => Promise<LogEntry[]>
): Promise<string[]> {
  const deletedSessionPaths: string[] = [];

  await stopActiveSession(session, {
    updateSessionState: async () => true,
    sendInterrupt: async () => {},
    readLog,
    readSessionState: async () => readInterruptedSession(session),
    sessionExists: async () => false,
    killSession: async () => {},
    resolveSourceRepoPath: () => null,
    deleteSessionFiles: async (sessionPath) => {
      deletedSessionPaths.push(sessionPath);
    },
    removeSessionState: async () => true,
  });

  return deletedSessionPaths;
}

async function stopAndCollectSteps(
  session: ActiveSession,
  readLog: () => Promise<LogEntry[]>,
  overrides: Partial<Parameters<typeof stopActiveSession>[1]> = {}
): Promise<string[]> {
  const steps: string[] = [];
  await stopActiveSession(session, {
    updateSessionState: async () => true,
    sendInterrupt: recordSessionStep(steps, "interrupt"),
    readLog,
    readSessionState: async (): Promise<SessionState> => session,
    sessionExists: async () => true,
    sleep: recordSleepStep(steps),
    killSession: recordSessionStep(steps, "kill"),
    discardSessionWorktree: (worktree) => {
      steps.push(`discard:${worktree.worktreeProjectPath}`);
    },
    resolveSourceRepoPath: () => null,
    removeSessionState: recordRemoveStep(steps),
    ...overrides,
  });
  return steps;
}

describe("stopActiveSession", () => {
  test("force kills the tmux session when it does not stop within the grace period", async () => {
    const session = createActiveSession();
    const steps: string[] = [];
    const now = 123_456_789;
    const originalNow = Date.now;
    const updateSessionStateCalls: UpdateSessionStateCall[] = [];
    const removeSessionStateCalls: RemoveSessionStateCall[] = [];

    Date.now = () => now;

    try {
      await stopActiveSession(session, {
        updateSessionState: async (_storageRoot, projectPath, sessionId, updates, options) => {
          steps.push("update");
          updateSessionStateCalls.push({
            projectPath,
            sessionId,
            updates,
            expectedSessionId: options?.expectedSessionId,
          });
          return true;
        },
        sendInterrupt: async (sessionName) => {
          steps.push(`interrupt:${sessionName}`);
        },
        readSessionState: async (): Promise<SessionState> => session,
        sessionExists: async () => true,
        sleep: async (ms) => {
          steps.push(`sleep:${ms}`);
        },
        killSession: async (sessionName) => {
          steps.push(`kill:${sessionName}`);
        },
        removeSessionState: async (_storageRoot, projectPath, sessionId, options) => {
          steps.push("remove");
          removeSessionStateCalls.push({
            projectPath,
            sessionId,
            expectedSessionId: options?.expectedSessionId,
          });
          return true;
        },
      });
    } finally {
      Date.now = originalNow;
    }

    expect(steps[0]).toBe("update");
    expect(steps[1]).toBe("interrupt:rr-project-main");
    expect(steps.filter((step) => step === `sleep:${STOP_SESSION_POLL_INTERVAL_MS}`)).toHaveLength(
      Math.ceil(STOP_SESSION_GRACE_PERIOD_MS / STOP_SESSION_POLL_INTERVAL_MS)
    );
    expect(steps.at(-2)).toBe("kill:rr-project-main");
    expect(steps.at(-1)).toBe("remove");
    expect(updateSessionStateCalls).toEqual([
      {
        projectPath: "/repo/project",
        sessionId: "session-123",
        updates: {
          state: "stopping",
          lastHeartbeat: now,
        },
        expectedSessionId: "session-123",
      },
    ]);
    expect(removeSessionStateCalls).toEqual([
      {
        projectPath: "/repo/project",
        sessionId: "session-123",
        expectedSessionId: "session-123",
      },
    ]);
  });

  test("waits for terminal session state and skips force killing when cleanup completes", async () => {
    const session = createActiveSession();
    const steps: string[] = [];
    const sessionStates: Array<SessionState | null> = [
      session,
      { ...session, state: "interrupted" },
    ];

    await stopActiveSession(session, {
      updateSessionState: async () => true,
      sendInterrupt: recordSessionStep(steps, "interrupt"),
      readSessionState: async () => sessionStates.shift() ?? null,
      sessionExists: async () => true,
      sleep: recordSleepStep(steps),
      killSession: recordSessionStep(steps, "kill"),
      removeSessionState: recordRemoveStep(steps),
    });

    expect(steps).toEqual([
      `interrupt:${session.sessionName}`,
      `sleep:${STOP_SESSION_POLL_INTERVAL_MS}`,
      "remove",
    ]);
    expect(steps).not.toContain(`kill:${session.sessionName}`);
  });

  test("force kills quickly and discards the worktree when no successful review iteration exists", async () => {
    const session = createActiveSession({
      sessionPath: "/tmp/session-123.jsonl",
      worktreeProjectPath: "/tmp/worktrees/session-123",
      worktreeBranch: "rr-worktree-session-123",
    });
    const steps = await stopAndCollectSteps(session, async () => [], {
      resolveSourceRepoPath: () => "/repo/project",
    });

    expect(steps[0]).toBe(`interrupt:${session.sessionName}`);
    expect(steps.filter((step) => step === `sleep:${STOP_SESSION_POLL_INTERVAL_MS}`)).toHaveLength(
      Math.ceil(
        STOP_SESSION_NO_SUCCESSFUL_ITERATION_GRACE_PERIOD_MS / STOP_SESSION_POLL_INTERVAL_MS
      )
    );
    expect(steps).toContain(`kill:${session.sessionName}`);
    expect(steps).toContain(`discard:${session.worktreeProjectPath}`);
    expect(steps.at(-1)).toBe("remove");
  });

  test("waits the full grace period when review_iteration progress already exists", async () => {
    const session = createActiveSession({
      sessionPath: "/tmp/session-123.jsonl",
    });
    const steps = await stopAndCollectSteps(session, async () => [
      {
        type: "review_iteration",
        timestamp: Date.now(),
        iteration: 1,
        phase: "review",
        sessionStatus: "running",
        findings: [],
        netNewFindingIds: [],
      },
    ]);

    expect(steps[0]).toBe(`interrupt:${session.sessionName}`);
    expect(steps.filter((step) => step === `sleep:${STOP_SESSION_POLL_INTERVAL_MS}`)).toHaveLength(
      Math.ceil(STOP_SESSION_GRACE_PERIOD_MS / STOP_SESSION_POLL_INTERVAL_MS)
    );
    expect(steps).toContain(`kill:${session.sessionName}`);
    expect(steps.at(-1)).toBe("remove");
  });

  test("deletes session log artifacts after stopping when no iteration entry was ever recorded", async () => {
    const sessionPath = "/tmp/session-123.jsonl";
    const session = createActiveSession({
      sessionPath,
    });

    const deletedSessionPaths = await stopAndCollectDeletedSessionPaths(session, async () => []);

    expect(deletedSessionPaths).toEqual([sessionPath]);
  });

  test("keeps session log artifacts when an iteration entry is recorded during shutdown", async () => {
    const session = createActiveSession({
      sessionPath: "/tmp/session-123.jsonl",
    });

    const deletedSessionPaths = await stopAndCollectDeletedSessionPaths(
      session,
      readLogAfterInitialEmpty({
        type: "iteration",
        timestamp: Date.now(),
        iteration: 1,
        error: {
          phase: "reviewer",
          message: "Interrupted by user",
        },
      })
    );

    expect(deletedSessionPaths).toEqual([]);
  });

  test("keeps session log artifacts when a review_iteration entry is recorded during shutdown", async () => {
    const session = createActiveSession({
      sessionPath: "/tmp/session-123.jsonl",
    });

    const deletedSessionPaths = await stopAndCollectDeletedSessionPaths(
      session,
      readLogAfterInitialEmpty({
        type: "review_iteration",
        timestamp: Date.now(),
        iteration: 1,
        phase: "review",
        sessionStatus: "running",
        findings: [],
        netNewFindingIds: [],
      })
    );

    expect(deletedSessionPaths).toEqual([]);
  });

  test("appends interrupted session_end after force killing a review session with findings", async () => {
    const session = createActiveSession({
      sessionPath: "/tmp/session-123.jsonl",
    });
    const appendedEntries = await forceStopAndCollectAppendedEntries(session, [
      createReviewIterationEntry(1, [createStoredFinding()]),
      createReviewIterationEntry(2),
    ]);

    expect(appendedEntries).toEqual([
      expect.objectContaining({
        type: "session_end",
        status: "interrupted",
        sessionStatus: "interrupted",
        phase: "review",
        reviewOutcome: "findings-pending",
        iterations: 2,
        reason: "Review stopped by user.",
      }),
    ]);
  });

  test("force-stopped review session with persisted findings becomes fixable from session stats", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "ralph-stop-session-test-"));
    const projectPath = "/repo/project";
    const logPath = await createLogSession(tempDir, projectPath, "main");
    const finding = createStoredFinding();

    try {
      await appendLog(logPath, {
        type: "system",
        timestamp: Date.now(),
        sessionId: "session-123",
        projectPath,
        gitBranch: "main",
        reviewer: { agent: "claude" },
        fixer: { agent: "codex" },
        maxIterations: 3,
      });
      await appendLog(logPath, {
        type: "review_iteration",
        timestamp: Date.now(),
        iteration: 1,
        phase: "review",
        sessionStatus: "running",
        findings: [finding],
        netNewFindingIds: [finding.id],
      });

      const session = createActiveSession({
        sessionPath: logPath,
      });

      await stopActiveSession(session, {
        updateSessionState: async () => true,
        sendInterrupt: async () => {},
        readSessionState: async (): Promise<SessionState> => session,
        sessionExists: async () => true,
        sleep: async () => {},
        killSession: async () => {},
        resolveSourceRepoPath: () => null,
        removeSessionState: async () => true,
      });

      const stats = await computeSessionStats({
        path: logPath,
        name: basename(logPath),
        projectName: getProjectName(projectPath),
        timestamp: Date.now(),
      });

      expect(stats.status).toBe("interrupted");
      expect(stats.reviewOutcome).toBe("findings-pending");
      expect(getPendingFixTarget(stats, [finding])).toEqual({
        sessionId: "session-123",
        projectPath,
        findings: [finding],
        commandScope: "artifact",
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("appends incomplete session_end after force killing a review session without findings", async () => {
    const session = createActiveSession({
      sessionPath: "/tmp/session-123.jsonl",
    });
    const appendedEntries = await forceStopAndCollectAppendedEntries(session, [
      createReviewIterationEntry(1),
    ]);

    expect(appendedEntries).toEqual([
      expect.objectContaining({
        type: "session_end",
        status: "interrupted",
        sessionStatus: "interrupted",
        phase: "review",
        reviewOutcome: "incomplete",
        iterations: 1,
      }),
    ]);
  });

  test("does not append duplicate session_end after force killing a terminalized review session", async () => {
    const session = createActiveSession({
      sessionPath: "/tmp/session-123.jsonl",
    });
    const appendedEntries = await forceStopAndCollectAppendedEntries(session, [
      createReviewIterationEntry(1),
      {
        type: "session_end",
        timestamp: Date.now(),
        status: "interrupted",
        reason: "Review was interrupted.",
        iterations: 1,
        phase: "review",
        sessionStatus: "interrupted",
        reviewOutcome: "incomplete",
      },
    ]);

    expect(appendedEntries).toEqual([]);
  });

  test("keeps the worktree when a successful iteration is recorded during shutdown", async () => {
    const session = createActiveSession({
      sessionPath: "/tmp/session-123.jsonl",
      worktreeProjectPath: "/tmp/worktrees/session-123",
      worktreeBranch: "rr-worktree-session-123",
    });
    const discardedWorktreePaths: string[] = [];

    await stopActiveSession(session, {
      updateSessionState: async () => true,
      sendInterrupt: async () => {},
      readLog: readLogAfterInitialEmpty({
        type: "iteration",
        timestamp: Date.now(),
        iteration: 1,
        fixes: {
          decision: "NO_CHANGES_NEEDED",
          fixes: [],
          skipped: [],
        },
      }),
      readSessionState: async () => readInterruptedSession(session),
      sessionExists: async () => false,
      killSession: async () => {},
      discardSessionWorktree: (worktree) => {
        discardedWorktreePaths.push(worktree.worktreeProjectPath);
      },
      resolveSourceRepoPath: () => "/repo/project",
      removeSessionState: async () => true,
    });

    expect(discardedWorktreePaths).toEqual([]);
  });
});
