/**
 * TUI Dashboard entry point
 */

import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { Dashboard } from "./components/Dashboard";

/**
 * Render the dashboard TUI
 * This takes over the terminal until the user quits
 */
export async function renderDashboard(props: {
  projectPath: string;
  branch?: string;
  refreshInterval?: number;
}): Promise<void> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  });

  createRoot(renderer).render(<Dashboard {...props} />);

  // The dashboard runs until the user quits
  // The renderer handles the event loop
}
