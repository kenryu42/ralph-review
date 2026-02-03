import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { Dashboard } from "./components/Dashboard";

export async function renderDashboard(props: {
  projectPath: string;
  branch?: string;
  refreshInterval?: number;
}): Promise<void> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  });

  createRoot(renderer).render(<Dashboard {...props} />);

  // Wait for renderer to be destroyed before returning
  if (!renderer.isDestroyed) {
    await new Promise<void>((resolve) => {
      renderer.once("destroy", () => resolve());
    });
  }
}
