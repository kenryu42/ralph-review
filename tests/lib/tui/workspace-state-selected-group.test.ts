import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, createElement, useEffect, useState } from "react";
import type { LogIncrementalState, LogSession } from "@/lib/logger";
import type { ActiveSession, SessionState } from "@/lib/session-state";
import { useWorkspaceState } from "@/lib/tui/workspace/use-workspace-state";
import type { WorkspaceState } from "@/lib/tui/workspace/workspace-types";
import { createConfig } from "../../helpers/diagnostics";
import { createActiveSession, createSessionState } from "../../helpers/tui";

interface HarnessRecording {
  getLatestProjectActiveSession: string[];
  getLatestProjectLogSession: string[];
  listProjectLogSessions: string[];
  readLogIncremental: string[];
}

interface HarnessOptions {
  projectPath?: string;
  initialSelectedGroupPath?: string;
  allSessions?: ActiveSession[];
  sessionsByPath?: Record<string, SessionState | null>;
  logsByPath?: Record<string, LogSession | null>;
}

async function mount(options: HarnessOptions = {}) {
  const projectPath = options.projectPath ?? "/repo/project";
  const allSessions = options.allSessions ?? [];
  const sessionsByPath = options.sessionsByPath ?? {};
  const logsByPath = options.logsByPath ?? {};

  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (() =>
    0 as unknown as ReturnType<typeof setInterval>) as typeof setInterval;
  globalThis.clearInterval = (() => {}) as typeof clearInterval;

  const recording: HarnessRecording = {
    getLatestProjectActiveSession: [],
    getLatestProjectLogSession: [],
    listProjectLogSessions: [],
    readLogIncremental: [],
  };

  // Yielding to the event loop on every dep call keeps refreshHeavy's promise
  // chain long enough for its terminal setState to fall inside the test's
  // act() drain blocks (matches the dashboard-state-hook harness pattern).
  const yieldTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  const deps = {
    loadEffectiveConfig: async () => {
      await yieldTick();
      return createConfig();
    },
    ensureGitRepositoryAsync: async () => {
      await yieldTick();
      return true;
    },
    listAllActiveSessions: async () => {
      await yieldTick();
      return allSessions;
    },
    listProjectActiveSessions: async (_logsDir: string | undefined, path: string) => {
      await yieldTick();
      return allSessions.filter((session) => session.projectPath === path);
    },
    getLatestProjectActiveSession: async (_logsDir: string | undefined, path: string) => {
      recording.getLatestProjectActiveSession.push(path);
      await yieldTick();
      return sessionsByPath[path] ?? null;
    },
    getLatestProjectLogSession: async (_logsDir: string | undefined, path: string) => {
      recording.getLatestProjectLogSession.push(path);
      await yieldTick();
      return logsByPath[path] ?? null;
    },
    readLogIncremental: async (logPath: string, state?: LogIncrementalState) => {
      recording.readLogIncremental.push(logPath);
      await yieldTick();
      return {
        mode: "reset" as const,
        entries: [],
        state:
          state ??
          ({
            logPath,
            offsetBytes: 0,
            lastModified: 1,
            trailingPartialLine: "",
          } satisfies LogIncrementalState),
      };
    },
    listProjectLogSessions: async (_logsDir: string | undefined, path: string) => {
      recording.listProjectLogSessions.push(path);
      await yieldTick();
      return [];
    },
    computeSessionStats: async () => {
      throw new Error("not expected");
    },
    computeProjectStats: async () => {
      throw new Error("not expected");
    },
    getProjectName: (path: string) => path.split("/").at(-1) || "repo",
    shouldCaptureTmux: () => false,
    getSessionOutput: async () => {
      await yieldTick();
      return "";
    },
    computeNextTmuxCaptureInterval: ({ previousIntervalMs }: { previousIntervalMs: number }) =>
      previousIntervalMs,
    tmuxCaptureMinIntervalMs: 250,
  };

  let latestState: WorkspaceState | null = null;
  let setExternalGroupPath: ((next: string) => void) | null = null;

  function Probe() {
    const [groupPath, setGroupPath] = useState(options.initialSelectedGroupPath ?? projectPath);
    setExternalGroupPath = setGroupPath;
    const state = useWorkspaceState(projectPath, undefined, 10_000, deps, groupPath);
    useEffect(() => {
      latestState = state;
    }, [state]);
    return createElement("text", null, "probe");
  }

  const setup = await testRender(createElement(Probe), { width: 80, height: 10 });

  async function drainPendingUpdates(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 8; i += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      await setup.renderOnce();
    });
  }

  async function waitFor(
    predicate: (state: WorkspaceState | null) => boolean,
    label: string
  ): Promise<void> {
    for (let i = 0; i < 25; i += 1) {
      if (predicate(latestState)) return;
      await drainPendingUpdates();
    }
    throw new Error(`Timed out waiting for: ${label}`);
  }

  async function setGroupPath(next: string): Promise<void> {
    await act(async () => {
      setExternalGroupPath?.(next);
      await setup.renderOnce();
    });
    await drainPendingUpdates();
  }

  await drainPendingUpdates();

  return {
    getState: () => latestState,
    recording,
    setGroupPath,
    waitFor,
    drainPendingUpdates,
    destroy: async () => {
      await drainPendingUpdates();
      await act(async () => {
        setup.renderer.destroy();
      });
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    },
  };
}

describe("useWorkspaceState with selectedGroupPath", () => {
  test("routes detail-side fetches through the selected group path", async () => {
    const otherProject = "/repo/other";
    const otherSession = createSessionState({
      sessionId: "session-other",
      projectPath: otherProject,
    });
    const otherActive = createActiveSession({
      sessionId: "session-other",
      projectPath: otherProject,
      sessionPath: "/tmp/logs/other.jsonl",
    });

    const harness = await mount({
      allSessions: [otherActive],
      initialSelectedGroupPath: otherProject,
      sessionsByPath: {
        "/repo/project": null,
        [otherProject]: otherSession,
      },
    });

    try {
      await harness.waitFor(
        (state) => state?.currentSession?.sessionId === "session-other",
        "selected group session loaded"
      );

      expect(harness.recording.getLatestProjectActiveSession).toContain(otherProject);
      expect(harness.recording.getLatestProjectActiveSession).not.toContain("/repo/project");
      const state = harness.getState();
      expect(state?.selectedGroupPath).toBe(otherProject);
      expect(state?.currentSession?.sessionId).toBe("session-other");
    } finally {
      await harness.destroy();
    }
  });

  test("resets detail state when the selected group path changes", async () => {
    const otherProject = "/repo/other";
    const otherActive = createActiveSession({
      sessionId: "session-other",
      projectPath: otherProject,
      sessionPath: "/tmp/logs/other.jsonl",
    });
    const harness = await mount({
      allSessions: [otherActive],
      sessionsByPath: {
        "/repo/project": createSessionState({ sessionId: "session-main" }),
        [otherProject]: createSessionState({
          sessionId: "session-other",
          projectPath: otherProject,
        }),
      },
    });

    try {
      await harness.waitFor(
        (state) => state?.currentSession?.sessionId === "session-main",
        "initial session-main loaded"
      );

      await harness.setGroupPath(otherProject);
      await harness.waitFor(
        (state) => state?.currentSession?.sessionId === "session-other",
        "switched to session-other"
      );

      const updated = harness.getState();
      expect(updated?.selectedGroupPath).toBe(otherProject);
      expect(updated?.currentSession?.sessionId).toBe("session-other");
      expect(harness.recording.getLatestProjectActiveSession).toContain(otherProject);
    } finally {
      await harness.destroy();
    }
  });

  test("falls back to current project group when selected path is no longer in groups", async () => {
    const missing = "/repo/missing";
    const harness = await mount({
      initialSelectedGroupPath: missing,
      sessionsByPath: {
        "/repo/project": createSessionState({ sessionId: "session-main" }),
      },
    });

    try {
      await harness.waitFor(
        (state) => state?.selectedGroupPath === "/repo/project",
        "selection fell back to current project"
      );

      const state = harness.getState();
      expect(state?.selectedGroupPath).toBe("/repo/project");
    } finally {
      await harness.destroy();
    }
  });
});
