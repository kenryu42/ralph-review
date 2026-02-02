import { describe, expect, test } from "bun:test";
import type { LockData } from "@/lib/lockfile";
import { getCurrentAgentFromLockData } from "@/lib/tui/use-dashboard-state";

describe("getCurrentAgentFromLockData", () => {
  const baseLockData: LockData = {
    sessionName: "rr-test-123",
    startTime: Date.now(),
    pid: process.pid,
    projectPath: "/test/project",
    branch: "main",
  };

  test("returns null when lockData is null", () => {
    expect(getCurrentAgentFromLockData(null)).toBeNull();
  });

  test("returns null when currentAgent is missing", () => {
    expect(getCurrentAgentFromLockData(baseLockData)).toBeNull();
  });

  test("returns reviewer when currentAgent is reviewer", () => {
    const data: LockData = { ...baseLockData, currentAgent: "reviewer" };
    expect(getCurrentAgentFromLockData(data)).toBe("reviewer");
  });

  test("returns fixer when currentAgent is fixer", () => {
    const data: LockData = { ...baseLockData, currentAgent: "fixer" };
    expect(getCurrentAgentFromLockData(data)).toBe("fixer");
  });
});
