import { testRender } from "@opentui/react/test-utils";
import type { ReactElement } from "react";
import { act } from "react";
import type { ActiveSession, SessionState } from "@/lib/session-state";
import type { SessionStats } from "@/lib/types";

export type TestRenderSetup = Awaited<ReturnType<typeof testRender>>;

export async function destroyTestRender(setup: TestRenderSetup | null): Promise<void> {
  if (!setup) {
    return;
  }

  await act(async () => {
    setup.renderer.destroy();
  });
}

export async function renderOnce(
  node: ReactElement,
  size: { width: number; height: number }
): Promise<TestRenderSetup> {
  const setup = await testRender(node, size);

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

export async function actAndRender(
  setup: TestRenderSetup | null,
  update: () => void | Promise<void> = async () => {}
): Promise<void> {
  await act(async () => {
    await update();
    await Promise.resolve();
    await setup?.renderOnce();
  });
}

export async function settleRender(setup: TestRenderSetup | null, cycles = 2): Promise<void> {
  for (let index = 0; index < cycles; index += 1) {
    await actAndRender(setup);
  }
}

export function createActiveSession(overrides: Partial<ActiveSession> = {}): ActiveSession {
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
    sessionPath: "/tmp/logs/rr-project-main.jsonl",
    ...overrides,
  };
}

export function createSessionState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    schemaVersion: 2,
    sessionId: "session-1",
    sessionName: "rr-test-123",
    startTime: Date.now(),
    lastHeartbeat: Date.now(),
    pid: process.pid,
    projectPath: "/test/project",
    branch: "main",
    state: "running",
    mode: "background",
    ...overrides,
  };
}

export function createSessionStats(overrides: Partial<SessionStats> = {}): SessionStats {
  return {
    sessionPath: "/tmp/logs/test-session.jsonl",
    sessionName: "rr-test-abc",
    timestamp: Date.now(),
    status: "completed",
    totalFixes: 2,
    totalSkipped: 1,
    priorityCounts: { P0: 0, P1: 1, P2: 1, P3: 0 },
    iterations: 2,
    totalDuration: 154000,
    entries: [],
    reviewer: "claude",
    reviewerModel: "sonnet-4",
    reviewerReasoning: "high",
    reviewerDisplayName: "claude",
    reviewerModelDisplayName: "sonnet-4",
    fixer: "claude",
    fixerModel: "sonnet-4",
    fixerReasoning: "medium",
    fixerDisplayName: "claude",
    fixerModelDisplayName: "sonnet-4",
    ...overrides,
  };
}

export function findTextLocation(frame: string, text: string): { x: number; y: number } {
  const lines = frame.split("\n");
  for (const [y, line] of lines.entries()) {
    const x = line.indexOf(text);
    if (x >= 0) {
      return { x, y };
    }
  }

  throw new Error(`Could not find "${text}" in frame:\n${frame}`);
}
