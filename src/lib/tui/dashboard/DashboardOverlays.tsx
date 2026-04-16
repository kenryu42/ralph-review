import type { ActiveSession } from "@/lib/session-state";
import type { PendingFixTarget } from "@/lib/tui/dashboard/dashboard-fix-state";
import { FixIssuesOverlay } from "@/lib/tui/sessions/fix/FixIssuesOverlay";
import { SessionOverlay } from "@/lib/tui/sessions/history/SessionListOverlay";
import type { DefaultReview } from "@/lib/types";
import { HelpOverlay } from "./HelpOverlay";
import { ReviewModeOverlay } from "./ReviewModeOverlay";
import { StopSessionPickerOverlay } from "./StopSessionPickerOverlay";

interface DashboardOverlaysProps {
  showHelp: boolean;
  showRunOverlay: boolean;
  showFixFindings: boolean;
  showSession: boolean;
  showStopPicker: boolean;
  pendingFixTarget: PendingFixTarget | null;
  canShowSession: boolean;
  defaultReview?: DefaultReview;
  projectPath: string;
  sessions: ActiveSession[];
  onCloseHelp: () => void;
  onCloseRunOverlay: () => void;
  onSubmitRunOverlay: (args: string[]) => void;
  onCloseFixFindings: () => void;
  onCloseSession: () => void;
  onSelectStopSession: (session: ActiveSession) => void;
  onCloseStopPicker: () => void;
}

export function DashboardOverlays({
  showHelp,
  showRunOverlay,
  showFixFindings,
  showSession,
  showStopPicker,
  pendingFixTarget,
  canShowSession,
  defaultReview,
  projectPath,
  sessions,
  onCloseHelp,
  onCloseRunOverlay,
  onSubmitRunOverlay,
  onCloseFixFindings,
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
          projectPath={projectPath}
          onClose={onCloseRunOverlay}
          onSubmit={onSubmitRunOverlay}
        />
      )}
      {showFixFindings && pendingFixTarget && (
        <FixIssuesOverlay
          sessionId={pendingFixTarget.sessionId}
          projectPath={pendingFixTarget.projectPath}
          findings={pendingFixTarget.findings}
          onClose={onCloseFixFindings}
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
