/** Launch real-time TUI dashboard */

import { getGitBranch } from "@/lib/logger";

export async function runStatus(): Promise<void> {
  const projectPath = process.cwd();
  const branch = await getGitBranch(projectPath);

  // Dynamic import to avoid React initialization at module load time
  // This prevents issues in test environments
  const { renderDashboard } = await import("@/lib/tui/index");

  await renderDashboard({
    projectPath,
    branch,
  });
}
