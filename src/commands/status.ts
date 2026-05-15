import { getGitBranch } from "@/lib/logger";

interface StatusDeps {
  cwd: () => string;
  getGitBranch: typeof getGitBranch;
  renderDashboard: (payload: { projectPath: string; branch: string | undefined }) => Promise<void>;
}

async function renderDashboardWithDynamicImport(payload: {
  projectPath: string;
  branch: string | undefined;
}): Promise<void> {
  const { renderDashboard } = await import("@/lib/tui/index");
  await renderDashboard(payload);
}

const DEFAULT_STATUS_DEPS: StatusDeps = {
  cwd: () => process.cwd(),
  getGitBranch,
  renderDashboard: renderDashboardWithDynamicImport,
};

export async function runStatus(deps: Partial<StatusDeps> = {}): Promise<void> {
  const statusDeps = { ...DEFAULT_STATUS_DEPS, ...deps };
  const projectPath = statusDeps.cwd();
  const branch = await statusDeps.getGitBranch(projectPath);

  await statusDeps.renderDashboard({
    projectPath,
    branch,
  });
}

export type { StatusDeps };
