import type { ActiveSession } from "@/lib/session-state";
import type { stopActiveSession } from "@/lib/stop-session";

interface StopSelectedSessionActions {
  setShowStopPicker: (value: boolean) => void;
  stopActiveSession: typeof stopActiveSession;
}

export async function stopSelectedDashboardSession(
  session: ActiveSession,
  actions: StopSelectedSessionActions
): Promise<void> {
  actions.setShowStopPicker(false);
  await actions.stopActiveSession(session);
}
