import type { ActiveSession } from "@/lib/session-state";
import type { DefaultReview } from "@/lib/types";
import { HelpOverlay } from "./HelpOverlay";
import { ReviewModeOverlay } from "./ReviewModeOverlay";
import { SessionOverlay } from "./SessionListOverlay";
import { StopSessionPickerOverlay } from "./StopSessionPickerOverlay";

interface DashboardOverlaysProps {
  showHelp: boolean;
  showRunOverlay: boolean;
  showSession: boolean;
  showStopPicker: boolean;
  canShowSession: boolean;
  defaultReview?: DefaultReview;
  sessions: ActiveSession[];
  onCloseHelp: () => void;
  onCloseRunOverlay: () => void;
  onSubmitRunOverlay: (args: string[]) => void;
  onCloseSession: () => void;
  onSelectStopSession: (session: ActiveSession) => void;
  onCloseStopPicker: () => void;
}

export function DashboardOverlays({
  showHelp,
  showRunOverlay,
  showSession,
  showStopPicker,
  canShowSession,
  defaultReview,
  sessions,
  onCloseHelp,
  onCloseRunOverlay,
  onSubmitRunOverlay,
  onCloseSession,
  onSelectStopSession,
  onCloseStopPicker,
}: DashboardOverlaysProps) {
  return (
    <>
      {showHelp && <HelpOverlay onClose={onCloseHelp} />}
      {showRunOverlay && (
        <ReviewModeOverlay
          defaultReview={defaultReview}
          onClose={onCloseRunOverlay}
          onSubmit={onSubmitRunOverlay}
        />
      )}
      {showSession && canShowSession && <SessionOverlay onClose={onCloseSession} />}
      {showStopPicker && (
        <StopSessionPickerOverlay
          sessions={sessions}
          onSelectSession={onSelectStopSession}
          onClose={onCloseStopPicker}
        />
      )}
    </>
  );
}
