import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, createElement } from "react";
import type { LogSession } from "@/lib/logger";
import * as logger from "@/lib/logger";
import * as sessionState from "@/lib/session-state";
import { useSessionOverlayState } from "@/lib/tui/sessions/history/use-session-overlay-state";
import type { SessionStats } from "@/lib/types";
import { createDeferred } from "../../helpers/async";
import { actAndRender } from "../../helpers/tui";

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

function buildOrderedLogSessions() {
  return {
    first: buildLogSession({
      path: "/tmp/logs/session-a.jsonl",
      name: "session-a.jsonl",
      timestamp: 200,
    }),
    second: buildLogSession({
      path: "/tmp/logs/session-b.jsonl",
      name: "session-b.jsonl",
      timestamp: 100,
    }),
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

    await act(async () => {
      setup = await testRender(createElement(Probe), { width: 20, height: 4 });
      await setup?.renderOnce();
    });
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

  async function updateAndRender(update: () => void | Promise<void>) {
    await actAndRender(setup, update);
  }

  async function deleteSelectedSessionAndRender() {
    let deleteResult:
      | Awaited<ReturnType<ReturnType<typeof useSessionOverlayState>["deleteSelectedSession"]>>
      | undefined;
    await updateAndRender(async () => {
      deleteResult = await latestState?.deleteSelectedSession();
    });
    if (!deleteResult) {
      throw new Error("expected delete result");
    }
    return deleteResult;
  }

  test("loads sessions on mount, selects the first entry, and requests its stats", async () => {
    const { first, second } = buildOrderedLogSessions();
    const firstStats = buildSessionStats({ sessionPath: first.path });

    const listSpy = spyOn(logger, "listLogSessions").mockResolvedValue([first, second]);
    const statsSpy = spyOn(logger, "computeSessionStats").mockResolvedValue(firstStats);

    await mountHook();
    await flush();

    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(statsSpy).toHaveBeenCalledTimes(1);
    expect(statsSpy).toHaveBeenCalledWith(first);
    expect(latestState?.selectedPath).toBe(first.path);
    expect(latestState?.selectedStats?.sessionPath).toBe(first.path);
    expect(latestState?.statsLoading).toBe(false);
  });

  test("ignores stale stats responses when selected session changes", async () => {
    const { first, second } = buildOrderedLogSessions();

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
    await updateAndRender(() => {
      sessions.resolve([first, second]);
    });
    await flush();

    await updateAndRender(() => {
      latestState?.setSelectedPath(second.path);
    });

    await updateAndRender(() => {
      secondStats.resolve(buildSessionStats({ sessionPath: second.path }));
    });
    await flush();
    expect(latestState?.selectedStats?.sessionPath).toBe(second.path);

    await updateAndRender(() => {
      firstStats.resolve(buildSessionStats({ sessionPath: first.path }));
    });
    await flush();
    expect(latestState?.selectedStats?.sessionPath).toBe(second.path);
  });

  test("surfaces load errors for session list retrieval", async () => {
    const sessions = createDeferred<LogSession[]>();
    spyOn(logger, "listLogSessions").mockImplementation(async () => sessions.promise);
    spyOn(logger, "computeSessionStats").mockResolvedValue(buildSessionStats());

    await mountHook();
    await updateAndRender(() => {
      sessions.reject(new Error("unable to load logs"));
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
    await updateAndRender(() => {
      sessions.resolve([session]);
    });
    await updateAndRender(() => {
      stats.reject(new Error("stats unavailable"));
    });
    await flush();

    expect(latestState?.statsError).toBe("stats unavailable");
    expect(latestState?.statsLoading).toBe(false);
    expect(latestState?.selectedStats).toBeNull();
  });

  test("loads stats for the next remaining session after deleting the selected session", async () => {
    const { first, second } = buildOrderedLogSessions();
    const secondStats = createDeferred<SessionStats>();

    spyOn(logger, "listLogSessions").mockResolvedValue([first, second]);
    spyOn(logger, "computeSessionStats").mockImplementation(async (session) => {
      if (session.path === first.path) {
        return buildSessionStats({ sessionPath: first.path });
      }

      return secondStats.promise;
    });
    const deleteSpy = spyOn(logger, "deleteSessionFiles").mockResolvedValue(undefined);
    spyOn(sessionState, "listAllActiveSessions").mockResolvedValue([]);

    await mountHook();
    await flush();

    const deleteResult = await deleteSelectedSessionAndRender();

    expect(deleteResult).toEqual({ deleted: true });
    expect(deleteSpy).toHaveBeenCalledWith(first.path);
    expect(latestState?.selectedPath).toBe(second.path);
    expect(latestState?.selectedStats).toBeNull();
    expect(latestState?.statsLoading).toBe(true);

    await updateAndRender(() => {
      secondStats.resolve(buildSessionStats({ sessionPath: second.path }));
    });
    await flush();

    expect(latestState?.sessions).toEqual([second]);
    expect(latestState?.selectedStats?.sessionPath).toBe(second.path);
    expect(latestState?.statsLoading).toBe(false);
  });

  test("clears selection and stats when deleting the last remaining session", async () => {
    const session = buildLogSession();

    spyOn(logger, "listLogSessions").mockResolvedValue([session]);
    spyOn(logger, "computeSessionStats").mockResolvedValue(
      buildSessionStats({ sessionPath: session.path })
    );
    spyOn(logger, "deleteSessionFiles").mockResolvedValue(undefined);
    spyOn(sessionState, "listAllActiveSessions").mockResolvedValue([]);

    await mountHook();
    await flush();

    const deleteResult = await deleteSelectedSessionAndRender();
    await flush();

    expect(deleteResult).toEqual({ deleted: true });
    expect(latestState?.sessions).toEqual([]);
    expect(latestState?.selectedPath).toBeNull();
    expect(latestState?.selectedStats).toBeNull();
    expect(latestState?.statsLoading).toBe(false);
    expect(latestState?.statsError).toBeNull();
  });
});
