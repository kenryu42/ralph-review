import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, createElement } from "react";
import type { LogSession } from "@/lib/logger";
import * as logger from "@/lib/logger";
import { useSessionOverlayState } from "@/lib/tui/components/use-session-overlay-state";
import type { SessionStats } from "@/lib/types";

function buildLogSession(overrides: Partial<LogSession> = {}): LogSession {
  return {
    path: "/tmp/logs/session-a.jsonl",
    name: "session-a.jsonl",
    projectName: "project-12345678",
    timestamp: Date.now(),
    ...overrides,
  };
}

function buildSessionStats(overrides: Partial<SessionStats> = {}): SessionStats {
  return {
    sessionPath: "/tmp/logs/session-a.jsonl",
    sessionName: "session-a.jsonl",
    timestamp: Date.now(),
    status: "completed",
    totalFixes: 0,
    totalSkipped: 0,
    priorityCounts: { P0: 0, P1: 0, P2: 0, P3: 0 },
    iterations: 1,
    entries: [],
    reviewer: "claude",
    reviewerModel: "sonnet-4",
    reviewerDisplayName: "claude",
    reviewerModelDisplayName: "sonnet-4",
    fixer: "claude",
    fixerModel: "sonnet-4",
    fixerDisplayName: "claude",
    fixerModelDisplayName: "sonnet-4",
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

describe("useSessionOverlayState", () => {
  let setup: Awaited<ReturnType<typeof testRender>> | null = null;
  let latestState: ReturnType<typeof useSessionOverlayState> | null = null;

  afterEach(async () => {
    if (setup) {
      await act(async () => {
        setup?.renderer.destroy();
      });
      setup = null;
    }
    latestState = null;
    mock.restore();
  });

  async function mountHook() {
    function Probe() {
      latestState = useSessionOverlayState();
      return createElement("text", null, "probe");
    }

    setup = await testRender(createElement(Probe), { width: 20, height: 4 });
    await flush();
  }

  async function flush(cycles: number = 4) {
    for (let i = 0; i < cycles; i += 1) {
      await act(async () => {
        await Promise.resolve();
        await setup?.renderOnce();
      });
    }
  }

  test("ignores stale stats responses when selected session changes", async () => {
    const first = buildLogSession({
      path: "/tmp/logs/session-a.jsonl",
      name: "session-a.jsonl",
      timestamp: 200,
    });
    const second = buildLogSession({
      path: "/tmp/logs/session-b.jsonl",
      name: "session-b.jsonl",
      timestamp: 100,
    });

    const firstStats = createDeferred<SessionStats>();
    const secondStats = createDeferred<SessionStats>();
    const sessions = createDeferred<LogSession[]>();

    spyOn(logger, "listLogSessions").mockImplementation(async () => sessions.promise);
    spyOn(logger, "computeSessionStats").mockImplementation(async (session) => {
      if (session.path === first.path) {
        return firstStats.promise;
      }
      return secondStats.promise;
    });

    await mountHook();
    await act(async () => {
      sessions.resolve([first, second]);
      await Promise.resolve();
      await setup?.renderOnce();
    });
    await flush();

    await act(async () => {
      latestState?.setSelectedPath(second.path);
      await Promise.resolve();
      await setup?.renderOnce();
    });

    await act(async () => {
      secondStats.resolve(buildSessionStats({ sessionPath: second.path }));
      await Promise.resolve();
      await setup?.renderOnce();
    });
    await flush();
    expect(latestState?.selectedStats?.sessionPath).toBe(second.path);

    await act(async () => {
      firstStats.resolve(buildSessionStats({ sessionPath: first.path }));
      await Promise.resolve();
      await setup?.renderOnce();
    });
    await flush();
    expect(latestState?.selectedStats?.sessionPath).toBe(second.path);
  });

  test("surfaces load errors for session list retrieval", async () => {
    const sessions = createDeferred<LogSession[]>();
    spyOn(logger, "listLogSessions").mockImplementation(async () => sessions.promise);
    spyOn(logger, "computeSessionStats").mockResolvedValue(buildSessionStats());

    await mountHook();
    await act(async () => {
      sessions.reject(new Error("unable to load logs"));
      await Promise.resolve();
      await setup?.renderOnce();
    });
    await flush();

    expect(latestState?.sessionsError).toBe("unable to load logs");
    expect(latestState?.isLoading).toBe(false);
    expect(latestState?.sessions).toEqual([]);
  });

  test("surfaces stats errors for the selected session", async () => {
    const session = buildLogSession();
    const sessions = createDeferred<LogSession[]>();
    const stats = createDeferred<SessionStats>();
    spyOn(logger, "listLogSessions").mockImplementation(async () => sessions.promise);
    spyOn(logger, "computeSessionStats").mockImplementation(async () => stats.promise);

    await mountHook();
    await act(async () => {
      sessions.resolve([session]);
      await Promise.resolve();
      await setup?.renderOnce();
    });
    await act(async () => {
      stats.reject(new Error("stats unavailable"));
      await Promise.resolve();
      await setup?.renderOnce();
    });
    await flush();

    expect(latestState?.statsError).toBe("stats unavailable");
    expect(latestState?.statsLoading).toBe(false);
    expect(latestState?.selectedStats).toBeNull();
  });
});
