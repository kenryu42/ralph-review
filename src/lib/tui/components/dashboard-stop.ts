import type { ActiveSession } from "@/lib/session-state";
import type { stopActiveSession } from "@/lib/stop-session";

interface StopSelectedSessionActions {
  setIsStoppingRun: (value: boolean) => void;
  setShowStopPicker: (value: boolean) => void;
  stopActiveSession: typeof stopActiveSession;
}

export async function stopSelectedDashboardSession(
  session: ActiveSession,
  actions: StopSelectedSessionActions
): Promise<void> {
  actions.setIsStoppingRun(true);
  actions.setShowStopPicker(false);

  try {
    await actions.stopActiveSession(session);
  } finally {
    actions.setIsStoppingRun(false);
  }
}
