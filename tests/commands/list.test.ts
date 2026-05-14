import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import * as p from "@clack/prompts";
import { getCommandDef } from "@/cli";
import type { ActiveSession } from "@/lib/session-state";

const actualSessionState = await import("@/lib/session-state");
const actualTmux = await import("@/lib/tmux");

describe("list command", () => {
  test("command definition exists", () => {
    const def = getCommandDef("list");
    expect(def).toBeDefined();
    expect(def?.name).toBe("list");
  });

  test("has ls alias", () => {
    const def = getCommandDef("list");
    expect(def?.aliases).toContain("ls");
  });

  test("has no options", () => {
    const def = getCommandDef("list");
    expect(def?.options).toBeUndefined();
  });

  test("has examples", () => {
    const def = getCommandDef("list");
    expect(def?.examples).toContain("rr list");
    expect(def?.examples).toContain("rr ls");
  });
});

type RunListResult = {
  infoMessages: string[];
  outputLines: string[];
};

function createActiveSession(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    schemaVersion: 2,
    sessionId: "session-alpha",
    sessionName: "rr-alpha",
    startTime: Date.now(),
    lastHeartbeat: Date.now(),
    pid: 123,
    projectPath: "/repo/project",
    branch: "main",
    state: "running",
    mode: "background",
    sessionStatePath: "/tmp/session-alpha.json",
    ...overrides,
  };
}

async function runListWithSessions(options: {
  activeSessions?: ActiveSession[];
  tmuxSessions?: string[];
}): Promise<RunListResult> {
  mock.module("@/lib/session-state", () => ({
    listAllActiveSessions: async () => options.activeSessions ?? [],
  }));

  mock.module("@/lib/tmux", () => ({
    listRalphSessions: async () => options.tmuxSessions ?? [],
  }));

  const { runList } = await import("@/commands/list");
  const infoMessages: string[] = [];
  const outputLines: string[] = [];

  const originalInfo = p.log.info;
  const originalConsoleLog = console.log;

  p.log.info = ((message: string) => {
    infoMessages.push(message);
  }) as typeof p.log.info;

  console.log = ((...args: unknown[]) => {
    outputLines.push(args.map((arg) => String(arg)).join(" "));
  }) as typeof console.log;

  try {
    await runList();
  } finally {
    p.log.info = originalInfo;
    console.log = originalConsoleLog;
  }

  return { infoMessages, outputLines };
}

describe("runList", () => {
  afterEach(() => {
    mock.restore();
  });

  afterAll(() => {
    mock.restore();
    mock.module("@/lib/session-state", () => actualSessionState);
    mock.module("@/lib/tmux", () => actualTmux);
  });

  test("prints empty-state message when there are no active sessions", async () => {
    const result = await runListWithSessions({
      activeSessions: [],
      tmuxSessions: [],
    });

    expect(result.infoMessages).toEqual(["No active review sessions."]);
    expect(result.outputLines).toEqual([]);
  });

  test("prints tracked active sessions and omits tmux duplicates", async () => {
    const result = await runListWithSessions({
      activeSessions: [
        createActiveSession({
          sessionId: "session-alpha",
          sessionName: "rr-alpha",
          projectPath: "/repo/alpha",
          startTime: Date.now(),
        }),
        createActiveSession({
          sessionId: "session-beta",
          sessionName: "rr-beta",
          projectPath: "/repo/beta",
          worktreeBranch: "rr-worktree-session-beta",
          startTime: Date.now(),
        }),
      ],
      tmuxSessions: ["rr-alpha", "rr-beta"],
    });

    expect(result.infoMessages).toEqual(["Active review sessions:"]);
    expect(result.outputLines).toHaveLength(2);
    expect(result.outputLines[0]).toContain("session-");
    expect(result.outputLines[0]).toContain("rr-alpha");
    expect(result.outputLines[0]).toContain("/repo/alpha");
    expect(result.outputLines[1]).toContain("session-");
    expect(result.outputLines[1]).toContain("rr-beta");
    expect(result.outputLines[1]).toContain("/repo/beta");
    expect(result.outputLines[1]).toContain("rr-worktree-session-beta");
  });

  test("formats minute-level session ages", async () => {
    const result = await runListWithSessions({
      activeSessions: [
        createActiveSession({
          sessionId: "session-minutes",
          sessionName: "rr-minutes",
          startTime: Date.now() - 2 * 60 * 1_000,
        }),
      ],
    });

    expect(result.outputLines).toHaveLength(1);
    expect(result.outputLines[0]).toContain("2m ago");
  });

  test("formats hour-level session ages", async () => {
    const result = await runListWithSessions({
      activeSessions: [
        createActiveSession({
          sessionId: "session-hours",
          sessionName: "rr-hours",
          startTime: Date.now() - 3 * 60 * 60 * 1_000,
        }),
      ],
    });

    expect(result.outputLines).toHaveLength(1);
    expect(result.outputLines[0]).toContain("3h ago");
  });

  test("prints untracked tmux sessions as fallback entries", async () => {
    const result = await runListWithSessions({
      activeSessions: [createActiveSession({ sessionName: "rr-alpha" })],
      tmuxSessions: ["rr-alpha", "rr-orphaned"],
    });

    expect(result.infoMessages).toEqual(["Active review sessions:"]);
    expect(result.outputLines.some((line) => line.includes("rr-alpha"))).toBe(true);
    expect(result.outputLines).toContain("rr-orphaned (tmux only)");
  });
});
