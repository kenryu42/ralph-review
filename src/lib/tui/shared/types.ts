import type { stopActiveSession } from "@/lib/stop-session";
import type { DashboardOverlays } from "@/lib/tui/dashboard/DashboardOverlays";
import type { useWorkspaceState } from "@/lib/tui/workspace/use-workspace-state";

export interface DashboardProps {
  projectPath: string;
  branch?: string;
  refreshInterval?: number;
  deps?: {
    useWorkspaceState?: typeof useWorkspaceState;
    DashboardOverlays?: typeof DashboardOverlays;
    spawn?: typeof Bun.spawn;
    stopActiveSession?: typeof stopActiveSession;
  };
}
