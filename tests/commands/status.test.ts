import { describe, expect, test } from "bun:test";
import { runStatus, type StatusDeps } from "@/commands/status";

type RunStatusResult = {
  getGitBranchCalls: string[];
  renderDashboardCalls: Array<{ projectPath: string; branch: string | undefined }>;
};

async function runStatusWithBranch(branch: string | undefined): Promise<RunStatusResult> {
  const getGitBranchCalls: string[] = [];
  const renderDashboardCalls: Array<{ projectPath: string; branch: string | undefined }> = [];
  const deps: Partial<StatusDeps> = {
    cwd: () => process.cwd(),
    getGitBranch: async (projectPath?: string) => {
      if (!projectPath) {
        throw new Error("Expected projectPath");
      }
      getGitBranchCalls.push(projectPath);
      return branch;
    },
    renderDashboard: async (payload: { projectPath: string; branch: string | undefined }) => {
      renderDashboardCalls.push(payload);
    },
  };

  await runStatus(deps);

  return {
    getGitBranchCalls,
    renderDashboardCalls,
  };
}

describe("runStatus", () => {
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
