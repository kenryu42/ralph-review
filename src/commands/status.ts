import { getGitBranch } from "@/lib/logger";

export async function runStatus(): Promise<void> {
  const projectPath = process.cwd();
  const branch = await getGitBranch(projectPath);

  const { renderDashboard } = await import("@/lib/tui/index");

  await renderDashboard({
    projectPath,
    branch,
  });
}
