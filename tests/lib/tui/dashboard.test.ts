import { describe, expect, test } from "bun:test";
import type { ActiveSession } from "@/lib/session-state";
import { stopSelectedDashboardSession } from "@/lib/tui/components/dashboard-stop";

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

function createActiveSession(overrides: Partial<ActiveSession> = {}): ActiveSession {
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
    currentAgent: "reviewer",
    sessionStatePath: "/tmp/rr-project-main.lock",
    ...overrides,
  };
}

describe("stopSelectedDashboardSession", () => {
  test("clears the stopping indicator when the stop request resolves", async () => {
    const stopDeferred = createDeferred<void>();
    const stoppingStates: boolean[] = [];
    const pickerStates: boolean[] = [];

    const stopPromise = stopSelectedDashboardSession(createActiveSession(), {
      setIsStoppingRun: (value) => {
        stoppingStates.push(value);
      },
      setShowStopPicker: (value) => {
        pickerStates.push(value);
      },
      stopActiveSession: async () => {
        await stopDeferred.promise;
      },
    });

    await Promise.resolve();

    expect(stoppingStates).toEqual([true]);
    expect(pickerStates).toEqual([false]);

    stopDeferred.resolve();
    await stopPromise;

    expect(stoppingStates).toEqual([true, false]);
  });
});
