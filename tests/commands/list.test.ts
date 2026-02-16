import { afterEach, describe, expect, mock, test } from "bun:test";
import * as p from "@clack/prompts";
import { getCommandDef } from "@/cli";

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

async function runListWithSessions(sessions: string[]): Promise<RunListResult> {
  mock.module("@/lib/tmux", () => ({
    listRalphSessions: async () => sessions,
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

  test("prints empty-state message when there are no active sessions", async () => {
    const result = await runListWithSessions([]);

    expect(result.infoMessages).toEqual(["No active review sessions."]);
    expect(result.outputLines).toEqual([]);
  });

  test("prints active sessions header and each session when sessions exist", async () => {
    const result = await runListWithSessions(["rr-project-1", "rr-project-2"]);

    expect(result.infoMessages).toEqual(["Active review sessions:"]);
    expect(result.outputLines).toEqual(["rr-project-1", "rr-project-2"]);
  });
});
