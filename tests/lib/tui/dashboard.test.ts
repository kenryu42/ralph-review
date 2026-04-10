import { describe, expect, test } from "bun:test";
import type { ActiveSession } from "@/lib/session-state";
import { stopSelectedDashboardSession } from "@/lib/tui/components/dashboard-stop";
import { resolveDashboardCloseAction } from "@/lib/tui/dashboard-keyboard";

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
  test("closes the stop picker and waits for the stop request to resolve", async () => {
    const stopDeferred = createDeferred<void>();
    const pickerStates: boolean[] = [];

    const stopPromise = stopSelectedDashboardSession(createActiveSession(), {
      setShowStopPicker: (value) => {
        pickerStates.push(value);
      },
      stopActiveSession: async () => {
        await stopDeferred.promise;
      },
    });

    await Promise.resolve();

    expect(pickerStates).toEqual([false]);

    stopDeferred.resolve();
    await stopPromise;
  });
});

describe("resolveDashboardCloseAction", () => {
  test("prioritizes closing stop picker when visible", () => {
    const result = resolveDashboardCloseAction({
      showStopPicker: true,
      showHelp: true,
      showSession: true,
    });

    expect(result).toBe("close-stop-picker");
  });

  test("closes help when stop picker is not visible", () => {
    const result = resolveDashboardCloseAction({
      showStopPicker: false,
      showHelp: true,
      showSession: true,
    });

    expect(result).toBe("close-help");
  });

  test("delegates close key to session overlay when it is visible", () => {
    const result = resolveDashboardCloseAction({
      showStopPicker: false,
      showHelp: false,
      showSession: true,
    });

    expect(result).toBe("delegate-session-overlay");
  });

  test("shuts down when no overlays are visible", () => {
    const result = resolveDashboardCloseAction({
      showStopPicker: false,
      showHelp: false,
      showSession: false,
    });

    expect(result).toBe("shutdown");
  });
});
