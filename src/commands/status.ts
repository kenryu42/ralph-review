/**
 * Status command - show real-time review dashboard
 */

import { getGitBranch } from "@/lib/logger";

/**
 * Main status command handler
 * Launches the real-time TUI dashboard
 */
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
