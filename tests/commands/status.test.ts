import { afterEach, describe, expect, mock, test } from "bun:test";

type RunStatusResult = {
  getGitBranchCalls: string[];
  renderDashboardCalls: Array<{ projectPath: string; branch: string | undefined }>;
};

async function runStatusWithBranch(branch: string | undefined): Promise<RunStatusResult> {
  const getGitBranchCalls: string[] = [];
  const renderDashboardCalls: Array<{ projectPath: string; branch: string | undefined }> = [];

  mock.module("@/lib/logger", () => ({
    getGitBranch: async (projectPath: string) => {
      getGitBranchCalls.push(projectPath);
      return branch;
    },
  }));

  mock.module("@/lib/tui/index", () => ({
    renderDashboard: async (payload: { projectPath: string; branch: string | undefined }) => {
      renderDashboardCalls.push(payload);
    },
  }));

  const { runStatus } = await import("@/commands/status");
  await runStatus();

  return {
    getGitBranchCalls,
    renderDashboardCalls,
  };
}

describe("runStatus", () => {
  afterEach(() => {
    mock.restore();
  });

  test("passes cwd and resolved branch to dashboard", async () => {
    const cwd = process.cwd();
    const result = await runStatusWithBranch("feature/test");

    expect(result.getGitBranchCalls).toEqual([cwd]);
    expect(result.renderDashboardCalls).toEqual([
      {
        projectPath: cwd,
        branch: "feature/test",
      },
    ]);
  });

  test("passes undefined branch when git branch cannot be determined", async () => {
    const cwd = process.cwd();
    const result = await runStatusWithBranch(undefined);

    expect(result.getGitBranchCalls).toEqual([cwd]);
    expect(result.renderDashboardCalls).toEqual([
      {
        projectPath: cwd,
        branch: undefined,
      },
    ]);
  });
});
