import { afterEach, describe, expect, mock, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, createElement, useEffect } from "react";
import type { ActiveSession, LockData } from "@/lib/lockfile";
import type { LogIncrementalResult, LogIncrementalState, LogSession } from "@/lib/logger";
import type { DashboardState } from "@/lib/tui/types";
import type {
  Config,
  Finding,
  FixEntry,
  IterationEntry,
  Priority,
  ProjectStats,
  ReviewOptions,
  SessionStats,
  SkippedEntry,
  SystemEntry,
} from "@/lib/types";
import { createConfig } from "../../helpers/diagnostics";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createFix(id: number, title: string, priority: Priority = "P1"): FixEntry {
  return {
    id,
    title,
    priority,
    file: "src/example.ts",
    claim: "Claim",
    evidence: "Evidence",
    fix: "Fix",
  };
}

function createSkipped(id: number, title: string, priority: Priority = "P2"): SkippedEntry {
  return {
    id,
    title,
    priority,
    reason: "Not enough context",
  };
}

function createFinding(title: string): Finding {
  return {
    title,
    body: "Details",
    confidence_score: 0.9,
    priority: 1,
    code_location: {
      absolute_file_path: "/tmp/example.ts",
      line_range: { start: 10, end: 12 },
    },
  };
}

function createSystemEntry(overrides: Partial<SystemEntry> = {}): SystemEntry {
  return {
    type: "system",
    timestamp: 100,
    projectPath: "/repo/project",
    reviewer: { agent: "codex", model: "gpt-5.3-codex" },
    fixer: { agent: "claude", model: "claude-opus-4-6" },
    maxIterations: 5,
    ...overrides,
  };
}

function createIterationEntry(overrides: Partial<IterationEntry> = {}): IterationEntry {
  return {
    type: "iteration",
    timestamp: 200,
    iteration: 1,
    ...overrides,
  };
}

function createLockData(overrides: Partial<LockData> = {}): LockData {
  return {
    schemaVersion: 2,
    sessionId: "session-1",
    sessionName: "rr-project-main",
    startTime: Date.now() - 5_000,
    lastHeartbeat: Date.now(),
    pid: process.pid,
    projectPath: "/repo/project",
    branch: "main",
    state: "running",
    mode: "background",
    iteration: 1,
    currentAgent: "fixer",
    ...overrides,
  };
}

function createActiveSession(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    ...createLockData(overrides),
    lockPath: "/tmp/rr-project-main.lock",
  };
}

function createSessionStats(entries: (SystemEntry | IterationEntry)[]): SessionStats {
  return {
    sessionPath: "/tmp/logs/session.jsonl",
    sessionName: "session.jsonl",
    timestamp: Date.now(),
    status: "completed",
    totalFixes: 2,
    totalSkipped: 1,
    priorityCounts: { P0: 0, P1: 1, P2: 1, P3: 1 },
    iterations: 2,
    entries,
    reviewer: "codex",
    reviewerModel: "gpt-5.3-codex",
    reviewerDisplayName: "Codex",
    reviewerModelDisplayName: "GPT-5.3 Codex",
    fixer: "claude",
    fixerModel: "claude-opus-4-6",
    fixerDisplayName: "Claude",
    fixerModelDisplayName: "Claude Opus 4.6",
  };
}

function createProjectStats(sessions: SessionStats[]): ProjectStats {
  return {
    projectName: "repo-project",
    displayName: "repo-project",
    totalFixes: 2,
    totalSkipped: 1,
    priorityCounts: { P0: 0, P1: 1, P2: 1, P3: 1 },
    sessionCount: sessions.length,
    averageIterations: 2,
    fixRate: 0.66,
    sessions,
  };
}

interface DashboardHarnessOptions {
  projectPath?: string;
  refreshInterval?: number;
  ensureGitRepositoryAsync?: (projectPath: string) => Promise<boolean>;
  listAllActiveSessions?: () => Promise<ActiveSession[]>;
  readLockfile?: (logsDir: string | undefined, projectPath: string) => Promise<LockData | null>;
  getLatestProjectLogSession?: (
    logsDir: string | undefined,
    projectPath: string
  ) => Promise<LogSession | null>;
  loadConfig?: () => Promise<Config | null>;
  readLogIncremental?: (
    logPath: string,
    state?: LogIncrementalState
  ) => Promise<LogIncrementalResult>;
  listProjectLogSessions?: (
    logsDir: string | undefined,
    projectPath: string
  ) => Promise<LogSession[]>;
  computeSessionStats?: (session: LogSession) => Promise<SessionStats>;
  computeProjectStats?: (projectName: string, sessions: LogSession[]) => Promise<ProjectStats>;
  getProjectName?: (projectPath: string) => string;
  shouldCaptureTmux?: (params: {
    sessionChanged: boolean;
    liveMetaChanged: boolean;
    now: number;
    lastCaptureAt: number;
    currentIntervalMs: number;
  }) => boolean;
  getSessionOutput?: (sessionName: string, lines: number) => Promise<string>;
  computeNextTmuxCaptureInterval?: (params: {
    sessionChanged: boolean;
    liveMetaChanged: boolean;
    outputChanged: boolean;
    previousIntervalMs: number;
  }) => number;
}

interface DashboardHarness {
  getState: () => DashboardState | null;
  intervalCallbacks: Array<() => unknown>;
  clearIntervalCalls: Array<ReturnType<typeof setInterval>>;
  ensureGitRepositoryCalls: string[];
  readLockfileCallCount: () => number;
  readLogIncrementalCalls: Array<{ logPath: string; state: LogIncrementalState | undefined }>;
  shouldCaptureCalls: Array<{
    sessionChanged: boolean;
    liveMetaChanged: boolean;
    now: number;
    lastCaptureAt: number;
    currentIntervalMs: number;
  }>;
  computeNextIntervalCalls: Array<{
    sessionChanged: boolean;
    liveMetaChanged: boolean;
    outputChanged: boolean;
    previousIntervalMs: number;
  }>;
  getSessionOutputCalls: Array<{ sessionName: string; lines: number }>;
  runInterval: (index: number) => Promise<void>;
  flush: (cycles?: number) => Promise<void>;
  destroy: () => Promise<void>;
}

async function mountDashboardHarness(
  options: DashboardHarnessOptions = {}
): Promise<DashboardHarness> {
  const projectPath = options.projectPath ?? "/repo/project";
  const refreshInterval = options.refreshInterval ?? 10_000;
  const ensureGitRepositoryCalls: string[] = [];
  let readLockfileCalls = 0;
  const readLogIncrementalCalls: Array<{
    logPath: string;
    state: LogIncrementalState | undefined;
  }> = [];
  const shouldCaptureCalls: Array<{
    sessionChanged: boolean;
    liveMetaChanged: boolean;
    now: number;
    lastCaptureAt: number;
    currentIntervalMs: number;
  }> = [];
  const computeNextIntervalCalls: Array<{
    sessionChanged: boolean;
    liveMetaChanged: boolean;
    outputChanged: boolean;
    previousIntervalMs: number;
  }> = [];
  const getSessionOutputCalls: Array<{ sessionName: string; lines: number }> = [];

  const intervalCallbacks: Array<() => unknown> = [];
  const clearIntervalCalls: Array<ReturnType<typeof setInterval>> = [];
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;

  globalThis.setInterval = ((handler: Parameters<typeof setInterval>[0]) => {
    const callback =
      typeof handler === "function"
        ? () => (handler as (...args: unknown[]) => unknown)()
        : () => undefined;
    intervalCallbacks.push(callback);
    return intervalCallbacks.length as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval;

  globalThis.clearInterval = ((id: ReturnType<typeof setInterval>) => {
    clearIntervalCalls.push(id);
  }) as typeof clearInterval;

  const ensureGitRepositoryAsync =
    options.ensureGitRepositoryAsync ?? (async (_projectPath: string) => true);
  const listAllActiveSessions = options.listAllActiveSessions ?? (async () => []);
  const readLockfile = options.readLockfile ?? (async () => null);
  const getLatestProjectLogSession = options.getLatestProjectLogSession ?? (async () => null);
  const loadConfig = options.loadConfig ?? (async () => createConfig());
  const readLogIncremental =
    options.readLogIncremental ??
    (async (_logPath: string, state?: LogIncrementalState): Promise<LogIncrementalResult> => ({
      mode: "unchanged",
      entries: [],
      state:
        state ??
        ({
          logPath: "/tmp/logs/session.jsonl",
          offsetBytes: 0,
          lastModified: 1,
          trailingPartialLine: "",
        } satisfies LogIncrementalState),
    }));
  const listProjectLogSessions = options.listProjectLogSessions ?? (async () => []);
  const computeSessionStats =
    options.computeSessionStats ?? (async () => createSessionStats([createSystemEntry()]));
  const computeProjectStats =
    options.computeProjectStats ??
    (async (_projectName: string, sessions: LogSession[]) =>
      createProjectStats(sessions.map(() => createSessionStats([createSystemEntry()]))));
  const getProjectName =
    options.getProjectName ?? ((path: string) => path.split("/").at(-1) || "repo");
  const shouldCaptureTmux = options.shouldCaptureTmux ?? (() => false);
  const getSessionOutput = options.getSessionOutput ?? (async () => "");
  const computeNextTmuxCaptureInterval =
    options.computeNextTmuxCaptureInterval ?? (({ previousIntervalMs }) => previousIntervalMs);

  mock.module("@/lib/config", () => ({
    loadConfig,
  }));

  mock.module("@/lib/git", () => ({
    ensureGitRepositoryAsync: async (path: string) => {
      ensureGitRepositoryCalls.push(path);
      return ensureGitRepositoryAsync(path);
    },
  }));

  mock.module("@/lib/lockfile", () => ({
    listAllActiveSessions,
    readLockfile: async (logsDir: string | undefined, path: string) => {
      readLockfileCalls += 1;
      return readLockfile(logsDir, path);
    },
  }));

  mock.module("@/lib/logger", () => ({
    computeProjectStats,
    computeSessionStats,
    getLatestProjectLogSession,
    getProjectName,
    listProjectLogSessions,
    readLogIncremental: async (logPath: string, state?: LogIncrementalState) => {
      readLogIncrementalCalls.push({ logPath, state });
      return readLogIncremental(logPath, state);
    },
  }));

  mock.module("@/lib/tmux", () => ({
    TMUX_CAPTURE_MIN_INTERVAL_MS: 250,
    shouldCaptureTmux: (params: {
      sessionChanged: boolean;
      liveMetaChanged: boolean;
      now: number;
      lastCaptureAt: number;
      currentIntervalMs: number;
    }) => {
      shouldCaptureCalls.push(params);
      return shouldCaptureTmux(params);
    },
    getSessionOutput: async (sessionName: string, lines: number) => {
      getSessionOutputCalls.push({ sessionName, lines });
      return getSessionOutput(sessionName, lines);
    },
    computeNextTmuxCaptureInterval: (params: {
      sessionChanged: boolean;
      liveMetaChanged: boolean;
      outputChanged: boolean;
      previousIntervalMs: number;
    }) => {
      computeNextIntervalCalls.push(params);
      return computeNextTmuxCaptureInterval(params);
    },
  }));

  const { useDashboardState } = await import("@/lib/tui/use-dashboard-state");
  let latestState: DashboardState | null = null;

  function Probe() {
    const state = useDashboardState(projectPath, undefined, refreshInterval);
    useEffect(() => {
      latestState = state;
    }, [state]);
    return createElement("text", null, "dashboard-state-probe");
  }

  const setup = await testRender(createElement(Probe), {
    width: 80,
    height: 10,
  });

  async function flush(cycles: number = 4) {
    for (let i = 0; i < cycles; i += 1) {
      await act(async () => {
        await Promise.resolve();
        await setup.renderOnce();
      });
    }
  }

  async function runInterval(index: number) {
    const callback = intervalCallbacks[index];
    expect(callback).toBeDefined();
    await act(async () => {
      await callback?.();
      await Promise.resolve();
      await setup.renderOnce();
    });
  }

  async function destroy() {
    await act(async () => {
      setup.renderer.destroy();
    });
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }

  await flush();

  return {
    getState: () => latestState,
    intervalCallbacks,
    clearIntervalCalls,
    ensureGitRepositoryCalls,
    readLockfileCallCount: () => readLockfileCalls,
    readLogIncrementalCalls,
    shouldCaptureCalls,
    computeNextIntervalCalls,
    getSessionOutputCalls,
    runInterval,
    flush,
    destroy,
  };
}

afterEach(() => {
  mock.restore();
});

describe("useDashboardState hook", () => {
  test("hydrates heavy state from incremental logs and computes historical stats", async () => {
    const fixA = createFix(1, "Fix null guard", "P1");
    const fixB = createFix(2, "Fix race", "P0");
    const skippedA = createSkipped(3, "Skipped edge case", "P2");
    const reviewOptions: ReviewOptions = {
      baseBranch: "main",
      simplifier: true,
    };
    const logSession: LogSession = {
      path: "/tmp/logs/repo-project/session.jsonl",
      name: "session.jsonl",
      projectName: "repo-project",
      timestamp: 12_345,
    };

    const systemEntry = createSystemEntry({
      maxIterations: 8,
      reviewOptions,
    });
    const iterationOld = createIterationEntry({
      timestamp: 150,
      iteration: 1,
      fixes: {
        decision: "APPLY_MOST",
        fixes: [fixA],
        skipped: [],
      },
      review: {
        findings: [createFinding("Older finding")],
        overall_correctness: "patch is incorrect",
        overall_explanation: "Old review",
        overall_confidence_score: 0.8,
      },
    });
    const iterationLatest = createIterationEntry({
      timestamp: 250,
      iteration: 2,
      fixes: {
        decision: "APPLY_MOST",
        fixes: [fixB],
        skipped: [skippedA],
      },
      review: {
        findings: [createFinding("Latest finding")],
        overall_correctness: "patch is incorrect",
        overall_explanation: "Latest review",
        overall_confidence_score: 0.9,
      },
      codexReview: { text: "Latest codex review text" },
    });

    const stats = createSessionStats([systemEntry, iterationOld, iterationLatest]);
    const projectStats = createProjectStats([stats]);

    const harness = await mountDashboardHarness({
      listAllActiveSessions: async () => [createActiveSession()],
      readLockfile: async () => null,
      getLatestProjectLogSession: async () => logSession,
      readLogIncremental: async () => ({
        mode: "reset",
        entries: [systemEntry, iterationOld, iterationLatest],
        state: {
          logPath: logSession.path,
          offsetBytes: 100,
          lastModified: 111,
          trailingPartialLine: "",
        },
      }),
      listProjectLogSessions: async () => [logSession],
      computeSessionStats: async () => stats,
      computeProjectStats: async () => projectStats,
      loadConfig: async () => createConfig(),
      shouldCaptureTmux: () => false,
    });

    try {
      const state = harness.getState();
      expect(state).not.toBeNull();
      expect(state?.isLoading).toBe(false);
      expect(state?.error).toBeNull();
      expect(state?.maxIterations).toBe(8);
      expect(state?.reviewOptions).toEqual(reviewOptions);
      expect(state?.logEntries).toHaveLength(3);
      expect(state?.fixes).toEqual([fixA, fixB]);
      expect(state?.skipped).toEqual([skippedA]);
      expect(state?.iterationFixes).toEqual([fixB]);
      expect(state?.iterationSkipped).toEqual([skippedA]);
      expect(state?.iterationFindings[0]?.title).toBe("Latest finding");
      expect(state?.findings[0]?.title).toBe("Latest finding");
      expect(state?.latestReviewIteration).toBe(2);
      expect(state?.codexReviewText).toBe("Latest codex review text");
      expect(state?.lastSessionStats).toEqual(stats);
      expect(state?.projectStats).toEqual(projectStats);
      expect(state?.isGitRepo).toBe(true);
      expect(harness.readLogIncrementalCalls).toHaveLength(1);
      expect(harness.readLogIncrementalCalls[0]).toEqual({
        logPath: logSession.path,
        state: undefined,
      });
    } finally {
      await harness.destroy();
    }
  });

  test("reuses incremental parser state when log session path stays the same", async () => {
    const logSession: LogSession = {
      path: "/tmp/logs/repo-project/session.jsonl",
      name: "session.jsonl",
      projectName: "repo-project",
      timestamp: 12_345,
    };
    const firstState: LogIncrementalState = {
      logPath: logSession.path,
      offsetBytes: 10,
      lastModified: 1,
      trailingPartialLine: "",
    };
    const secondState: LogIncrementalState = {
      logPath: logSession.path,
      offsetBytes: 20,
      lastModified: 2,
      trailingPartialLine: "",
    };

    let readCount = 0;
    const harness = await mountDashboardHarness({
      readLockfile: async () => null,
      getLatestProjectLogSession: async () => logSession,
      readLogIncremental: async (_path: string, _state?: LogIncrementalState) => {
        readCount += 1;
        if (readCount === 1) {
          return {
            mode: "reset",
            entries: [createSystemEntry()],
            state: firstState,
          };
        }
        return {
          mode: "unchanged",
          entries: [],
          state: secondState,
        };
      },
      shouldCaptureTmux: () => false,
    });

    try {
      await harness.runInterval(0);
      expect(harness.readLogIncrementalCalls).toHaveLength(2);
      expect(harness.readLogIncrementalCalls[0]?.state).toBeUndefined();
      expect(harness.readLogIncrementalCalls[1]?.state).toEqual(firstState);
    } finally {
      await harness.destroy();
    }
  });

  test("falls back to null config and no incremental reads when no log session exists", async () => {
    const harness = await mountDashboardHarness({
      readLockfile: async () => createLockData(),
      getLatestProjectLogSession: async () => null,
      loadConfig: async () => {
        throw new Error("missing config");
      },
      shouldCaptureTmux: () => false,
    });

    try {
      const state = harness.getState();
      expect(state).not.toBeNull();
      expect(state?.config).toBeNull();
      expect(state?.logEntries).toEqual([]);
      expect(harness.readLogIncrementalCalls).toEqual([]);
      expect(state?.isLoading).toBe(false);
    } finally {
      await harness.destroy();
    }
  });

  test("surfaces heavy refresh errors as user-facing state", async () => {
    const harness = await mountDashboardHarness({
      ensureGitRepositoryAsync: async () => {
        throw new Error("heavy refresh failed");
      },
      shouldCaptureTmux: () => false,
    });

    try {
      const state = harness.getState();
      expect(state).not.toBeNull();
      expect(state?.error).toBe("heavy refresh failed");
      expect(state?.isLoading).toBe(false);
    } finally {
      await harness.destroy();
    }
  });

  test("skips re-entrant heavy refresh calls while one is already running", async () => {
    const gate = createDeferred<boolean>();
    const harness = await mountDashboardHarness({
      ensureGitRepositoryAsync: async () => gate.promise,
      shouldCaptureTmux: () => false,
    });

    try {
      await harness.runInterval(0);
      expect(harness.ensureGitRepositoryCalls).toHaveLength(1);
      gate.resolve(true);
      await harness.flush();
    } finally {
      await harness.destroy();
    }
  });

  test("captures live tmux output and keeps prior output when capture returns empty", async () => {
    const firstLock = createLockData({ iteration: 1, currentAgent: "fixer" });
    const secondLock = createLockData({ iteration: 2, currentAgent: "reviewer" });
    const lockResponses: Array<LockData | null> = [firstLock, firstLock, secondLock];
    let lockReadIndex = 0;

    let outputCall = 0;
    const harness = await mountDashboardHarness({
      readLockfile: async () => {
        const value = lockResponses[lockReadIndex] ?? secondLock;
        lockReadIndex += 1;
        return value;
      },
      shouldCaptureTmux: () => true,
      getSessionOutput: async () => {
        outputCall += 1;
        return outputCall === 1 ? "live output line" : "";
      },
      computeNextTmuxCaptureInterval: ({ previousIntervalMs, outputChanged }) =>
        outputChanged ? previousIntervalMs + 250 : previousIntervalMs + 500,
    });

    try {
      const stateAfterFirstCapture = harness.getState();
      expect(stateAfterFirstCapture?.tmuxOutput).toBe("live output line");
      expect(stateAfterFirstCapture?.currentAgent).toBe("fixer");

      await harness.runInterval(1);

      const stateAfterSecondCapture = harness.getState();
      expect(stateAfterSecondCapture?.tmuxOutput).toBe("live output line");
      expect(stateAfterSecondCapture?.currentAgent).toBe("reviewer");
      expect(harness.shouldCaptureCalls).toHaveLength(2);
      expect(harness.shouldCaptureCalls[0]).toMatchObject({
        sessionChanged: true,
        liveMetaChanged: false,
        currentIntervalMs: 250,
      });
      expect(harness.shouldCaptureCalls[1]).toMatchObject({
        sessionChanged: false,
        liveMetaChanged: true,
      });
      expect(harness.computeNextIntervalCalls[1]).toMatchObject({
        sessionChanged: false,
        liveMetaChanged: true,
        outputChanged: false,
      });
    } finally {
      await harness.destroy();
    }
  });

  test("clears live output when session is no longer present", async () => {
    const running = createLockData();
    const lockResponses: Array<LockData | null> = [running, running, null];
    let lockReadIndex = 0;

    const harness = await mountDashboardHarness({
      readLockfile: async () => {
        const value = lockResponses[lockReadIndex] ?? null;
        lockReadIndex += 1;
        return value;
      },
      shouldCaptureTmux: () => true,
      getSessionOutput: async () => "captured output",
    });

    try {
      expect(harness.getState()?.tmuxOutput).toBe("captured output");
      await harness.runInterval(1);
      const state = harness.getState();
      expect(state?.currentSession).toBeNull();
      expect(state?.currentAgent).toBeNull();
      expect(state?.tmuxOutput).toBe("");
      expect(state?.elapsed).toBe(0);
    } finally {
      await harness.destroy();
    }
  });

  test("swallows transient live capture errors and recovers on next refresh", async () => {
    const lock = createLockData();
    let captureCall = 0;

    const harness = await mountDashboardHarness({
      readLockfile: async () => lock,
      shouldCaptureTmux: () => true,
      getSessionOutput: async () => {
        captureCall += 1;
        if (captureCall === 1) {
          return "first output";
        }
        if (captureCall === 2) {
          throw new Error("tmux unavailable");
        }
        return "recovered output";
      },
    });

    try {
      expect(harness.getState()?.tmuxOutput).toBe("first output");
      await harness.runInterval(1);
      expect(harness.getState()?.tmuxOutput).toBe("first output");
      await harness.runInterval(1);
      expect(harness.getState()?.tmuxOutput).toBe("recovered output");
      expect(harness.getSessionOutputCalls).toHaveLength(3);
    } finally {
      await harness.destroy();
    }
  });

  test("skips re-entrant live refresh calls while one is already running", async () => {
    const liveGate = createDeferred<LockData | null>();
    let lockCalls = 0;

    const harness = await mountDashboardHarness({
      readLockfile: async () => {
        lockCalls += 1;
        if (lockCalls === 2) {
          return liveGate.promise;
        }
        return null;
      },
      shouldCaptureTmux: () => false,
    });

    try {
      await harness.runInterval(1);
      expect(harness.readLockfileCallCount()).toBe(2);
      liveGate.resolve(null);
      await harness.flush();
    } finally {
      await harness.destroy();
    }
  });

  test("registers heavy/live intervals and clears both on unmount", async () => {
    const harness = await mountDashboardHarness({
      shouldCaptureTmux: () => false,
    });

    expect(harness.intervalCallbacks).toHaveLength(2);
    expect(harness.clearIntervalCalls).toEqual([]);

    await harness.destroy();

    const expectedIds = [1, 2].map((id) => id as unknown as ReturnType<typeof setInterval>);
    expect(harness.clearIntervalCalls).toEqual(expectedIds);
  });
});
