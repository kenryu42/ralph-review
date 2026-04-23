import { basename } from "node:path";
import { useKeyboard, useRenderer } from "@opentui/react";
import { useCallback, useRef, useState } from "react";
import { resolveDashboardKeyAction } from "@/lib/tui/dashboard/dashboard-keyboard";
import { TUI_COLORS } from "@/lib/tui/shared/colors";
import { SelectionCopyToastBoundary } from "@/lib/tui/shared/SelectionCopyToastBoundary";
import type { DashboardProps } from "@/lib/tui/shared/types";
import { useWorkspaceState } from "@/lib/tui/workspace/use-workspace-state";
import { Workspace } from "@/lib/tui/workspace/Workspace";
import type { FocusedPane } from "@/lib/tui/workspace/workspace-types";
import { DashboardOverlays } from "./DashboardOverlays";
import { getPendingFixTarget } from "./dashboard-fix-state";
import { cycleDashboardFocus, cycleDashboardFocusReverse } from "./dashboard-focus";
import { isDashboardOverlayBlockingFocus } from "./dashboard-overlay-state";
import { Header } from "./Header";
import { StatusBar } from "./StatusBar";
import { useDashboardRunControl } from "./use-dashboard-run-control";
import { useDashboardStopControl } from "./use-dashboard-stop-control";

export function Dashboard({ projectPath, branch, refreshInterval = 1000 }: DashboardProps) {
  const renderer = useRenderer();
  const state = useWorkspaceState(projectPath, branch, refreshInterval);
  const {
    runError,
    startupMode,
    clearRunError,
    clearRunStartState,
    setRunError,
    spawnRunProcess,
    spawnFixProcess,
    isStartupSpawning,
  } = useDashboardRunControl(projectPath);
  const [focusedPane, setFocusedPane] = useState<FocusedPane>("detail");
  const [outputVisible, setOutputVisible] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showFixFindings, setShowFixFindings] = useState(false);
  const [showSession, setShowSession] = useState(false);
  const [showReviewModeOverlay, setShowReviewModeOverlay] = useState(false);
  const [showStopPicker, setShowStopPicker] = useState(false);
  const { isStoppingRun, stopSelectedSession } = useDashboardStopControl({
    currentSession: state.currentSession,
    setShowStopPicker,
    onError: setRunError,
  });

  const projectName = basename(projectPath);
  const isExitingRef = useRef(false);
  const pendingFixTarget = getPendingFixTarget(state.lastSessionStats, state.storedFindings);
  const canFixPendingSession = pendingFixTarget !== null;

  const [prevCurrentSessionId, setPrevCurrentSessionId] = useState<string | null>(
    state.currentSession?.sessionId ?? null
  );
  const currentSessionId = state.currentSession?.sessionId ?? null;
  if (currentSessionId !== prevCurrentSessionId) {
    setPrevCurrentSessionId(currentSessionId);
    if (currentSessionId !== null) {
      clearRunStartState();
      setShowReviewModeOverlay(false);
      setShowFixFindings(false);
    }
  }

  const [prevProjectSessionsCount, setPrevProjectSessionsCount] = useState(
    state.projectSessions.length
  );
  if (state.projectSessions.length !== prevProjectSessionsCount) {
    setPrevProjectSessionsCount(state.projectSessions.length);
    if (state.projectSessions.length <= 1) {
      setShowStopPicker(false);
    }
  }

  if (showFixFindings && !canFixPendingSession) {
    setShowFixFindings(false);
  }

  const shutdown = useCallback(
    async (after?: () => Promise<void>, exitCode: number = 0) => {
      if (isExitingRef.current) {
        return;
      }

      isExitingRef.current = true;
      renderer.stop();

      const waitForDestroy = renderer.isDestroyed
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            renderer.once("destroy", () => resolve());
          });

      renderer.destroy();
      await waitForDestroy;

      if (after) {
        try {
          await after();
        } catch {
          exitCode = 1;
        }
      }

      process.exitCode = exitCode;
    },
    [renderer]
  );

  const cycleFocus = useCallback(() => {
    setFocusedPane((current) => cycleDashboardFocus(current, outputVisible));
  }, [outputVisible]);

  const cycleFocusReverse = useCallback(() => {
    setFocusedPane((current) => cycleDashboardFocusReverse(current, outputVisible));
  }, [outputVisible]);

  const handleKeyboard = useCallback(
    (key: { name: string }) => {
      const action = resolveDashboardKeyAction({
        keyName: key.name,
        showStopPicker,
        showHelp,
        showRunOverlay: showReviewModeOverlay,
        showFixFindings,
        showSession,
        activeSessionCount: state.allSessions.length,
        hasCurrentSession: Boolean(state.currentSession),
        canFixPendingSession,
        isRunSpawning: isStartupSpawning(),
      });

      switch (action) {
        case "close-stop-picker":
          setShowStopPicker(false);
          return;
        case "close-help":
          setShowHelp(false);
          return;
        case "delegate-run-overlay":
        case "delegate-fix-overlay":
        case "delegate-session-overlay":
        case "none":
          return;
        case "shutdown":
          void shutdown();
          return;
        case "cycle-focus":
          cycleFocus();
          return;
        case "cycle-focus-reverse":
          cycleFocusReverse();
          return;
        case "toggle-output":
          setOutputVisible((current) => !current);
          return;
        case "open-help":
          setShowHelp(true);
          return;
        case "open-session":
          setShowSession(true);
          return;
        case "open-fix-findings":
          setShowSession(false);
          setShowFixFindings(true);
          return;
        case "stop-single-session": {
          const target = state.allSessions[0];
          if (target) {
            void stopSelectedSession(target);
          }
          return;
        }
        case "open-stop-picker":
          setShowStopPicker(true);
          return;
        case "open-review-mode":
          clearRunError();
          setShowReviewModeOverlay(true);
          return;
      }
    },
    [
      canFixPendingSession,
      clearRunError,
      cycleFocus,
      cycleFocusReverse,
      isStartupSpawning,
      showFixFindings,
      showHelp,
      showReviewModeOverlay,
      showSession,
      showStopPicker,
      shutdown,
      state.allSessions,
      state.currentSession,
      stopSelectedSession,
    ]
  );

  useKeyboard(handleKeyboard);

  const displayError = state.error || runError;
  const showRunOverlay = showReviewModeOverlay && !state.currentSession;
  const isOverlayBlocked = isDashboardOverlayBlockingFocus({
    showHelp,
    showRunOverlay,
    showFixFindings,
    showSession,
    showStopPicker,
  });
  const hasSession = !displayError && Boolean(state.currentSession);

  return (
    <SelectionCopyToastBoundary>
      <box flexDirection="column" width="100%" height="100%">
        <Header
          projectName={projectName}
          branch={branch}
          elapsed={state.elapsed}
          session={state.currentSession}
          projectPath={projectPath}
          config={state.config}
        />
        {displayError ? (
          <box flexGrow={1} padding={2}>
            <text fg={TUI_COLORS.status.error}>Error: {displayError}</text>
          </box>
        ) : (
          <Workspace
            sessionGroups={state.sessionGroups}
            selectedSessionId={state.selectedSessionId}
            session={state.currentSession}
            fixes={state.fixes}
            skipped={state.skipped}
            findings={state.findings}
            storedFindings={state.storedFindings}
            selectedFindingIds={state.selectedFindingIds}
            selectedFindings={state.selectedFindings}
            fixResults={state.fixResults}
            unresolvedSelectedFindings={state.unresolvedSelectedFindings}
            auditRegressionFindings={state.auditRegressionFindings}
            latestReviewIteration={state.latestReviewIteration}
            codexReviewText={state.codexReviewText}
            tmuxOutput={state.tmuxOutput}
            maxIterations={state.maxIterations}
            isLoading={state.isLoading}
            lastSessionStats={state.lastSessionStats}
            projectStats={state.projectStats}
            isGitRepo={state.isGitRepo}
            currentAgent={state.currentAgent}
            reviewOptions={state.reviewOptions}
            startupMode={startupMode}
            isStopping={isStoppingRun}
            activeSessionCount={state.projectSessions.length}
            canFixPendingSession={canFixPendingSession}
            outputVisible={outputVisible}
            focusedPane={focusedPane}
            overlayBlocked={isOverlayBlocked}
          />
        )}
        <StatusBar
          hasSession={hasSession}
          canFixPendingSession={canFixPendingSession}
          focusedPane={focusedPane}
          outputVisible={outputVisible}
          stopPickerOpen={showStopPicker}
          liveRefreshError={state.liveRefreshError}
          configWarning={state.configWarning}
        />
        <DashboardOverlays
          showHelp={showHelp}
          showRunOverlay={showRunOverlay}
          showFixFindings={showFixFindings}
          showSession={showSession}
          showStopPicker={showStopPicker}
          pendingFixTarget={pendingFixTarget}
          canShowSession={!displayError}
          defaultReview={state.config?.defaultReview}
          defaultMaxIterations={state.config?.maxIterations}
          projectPath={projectPath}
          sessions={state.allSessions}
          onCloseHelp={() => setShowHelp(false)}
          onCloseRunOverlay={() => setShowReviewModeOverlay(false)}
          onSubmitRunOverlay={(args) => {
            setShowReviewModeOverlay(false);
            spawnRunProcess(args);
          }}
          onCloseFixFindings={() => setShowFixFindings(false)}
          onSubmitFixOverlay={(args) => {
            setShowFixFindings(false);
            spawnFixProcess(args);
          }}
          onCloseSession={() => setShowSession(false)}
          onSelectStopSession={(session) => {
            void stopSelectedSession(session);
          }}
          onCloseStopPicker={() => setShowStopPicker(false)}
        />
      </box>
    </SelectionCopyToastBoundary>
  );
}
