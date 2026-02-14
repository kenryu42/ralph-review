import { basename } from "node:path";
import { useKeyboard, useRenderer } from "@opentui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { removeLockfile } from "@/lib/lockfile";
import { CLI_PATH } from "@/lib/paths";
import { killSession, sendInterrupt } from "@/lib/tmux";
import { TUI_COLORS } from "@/lib/tui/colors";
import type { DashboardProps } from "../types";
import { useDashboardState } from "../use-dashboard-state";
import { Header } from "./Header";
import { HelpOverlay } from "./HelpOverlay";
import { OutputPanel } from "./OutputPanel";
import { SessionPanel } from "./SessionPanel";
import { type FocusedPanel, StatusBar } from "./StatusBar";

export function Dashboard({ projectPath, branch, refreshInterval = 1000 }: DashboardProps) {
  const renderer = useRenderer();
  const state = useDashboardState(projectPath, branch, refreshInterval);
  const [runError, setRunError] = useState<string | null>(null);
  const [isStartingRun, setIsStartingRun] = useState(false);
  const [isStoppingRun, setIsStoppingRun] = useState(false);
  const [focusedPanel, setFocusedPanel] = useState<FocusedPanel>("output");
  const [showHelp, setShowHelp] = useState(false);

  const projectName = basename(projectPath);

  const currentSessionRef = useRef(state.currentSession);
  const isExitingRef = useRef(false);
  const isSpawningRunRef = useRef(false);
  useEffect(() => {
    currentSessionRef.current = state.currentSession;
    if (state.currentSession) {
      setRunError(null);
      setIsStartingRun(false);
    } else {
      setIsStoppingRun(false);
    }
  }, [state.currentSession]);

  const shutdown = useCallback(
    async (after?: () => Promise<void>, exitCode: number = 0) => {
      if (isExitingRef.current) return;
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

  useKeyboard((key) => {
    // Handle exit/close keys globally (works even in error state)
    if (key.name === "q" || key.name === "escape") {
      if (showHelp) {
        setShowHelp(false);
      } else {
        void shutdown();
      }
      return;
    }

    // Don't handle other keys when help overlay is open
    if (showHelp) {
      return;
    }

    if (key.name === "tab") {
      setFocusedPanel((p) => (p === "session" ? "output" : "session"));
    }

    if (key.name === "?" || key.name === "h") {
      setShowHelp(true);
    }

    if (key.name === "s" && currentSessionRef.current) {
      const sessionName = currentSessionRef.current.sessionName;
      setIsStoppingRun(true);
      sendInterrupt(sessionName)
        .then(() => new Promise((resolve) => setTimeout(resolve, 1000)))
        .then(() => killSession(sessionName))
        .then(() => removeLockfile(undefined, projectPath))
        .catch(() => {
          setIsStoppingRun(false);
          // Ignore errors - session may already be stopped
        });
    }

    if (key.name === "r" && !currentSessionRef.current && !isSpawningRunRef.current) {
      isSpawningRunRef.current = true;
      setRunError(null);
      setIsStartingRun(true);
      try {
        const subprocess = Bun.spawn([process.execPath, CLI_PATH, "run"], {
          cwd: projectPath,
          stdin: "ignore",
          stdout: "ignore",
          stderr: "pipe",
        });
        void subprocess.exited
          .then(async (exitCode) => {
            isSpawningRunRef.current = false;
            if (exitCode !== 0) {
              const stderr = await new Response(subprocess.stderr).text();
              setIsStartingRun(false);
              setRunError(stderr.trim() || `Command failed with exit code ${exitCode}`);
            }
          })
          .catch((e) => {
            isSpawningRunRef.current = false;
            setIsStartingRun(false);
            setRunError(e instanceof Error ? e.message : String(e));
          });
      } catch (e) {
        isSpawningRunRef.current = false;
        setIsStartingRun(false);
        setRunError(e instanceof Error ? e.message : String(e));
      }
    }
  });

  const displayError = state.error || runError;

  if (displayError) {
    return (
      <box flexDirection="column" width="100%" height="100%">
        <Header
          projectName={projectName}
          branch={branch}
          elapsed={state.elapsed}
          session={state.currentSession}
          projectPath={projectPath}
          config={state.config}
        />
        <box flexGrow={1} padding={2}>
          <text fg={TUI_COLORS.status.error}>Error: {displayError}</text>
        </box>
        <StatusBar hasSession={false} focusedPanel={focusedPanel} />
        {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
      </box>
    );
  }

  return (
    <box flexDirection="column" width="100%" height="100%">
      <Header
        projectName={projectName}
        branch={branch}
        elapsed={state.elapsed}
        session={state.currentSession}
        projectPath={projectPath}
        config={state.config}
      />
      <box flexDirection="row" flexGrow={1} minHeight={0} gap={1} paddingLeft={1} paddingRight={1}>
        <SessionPanel
          session={state.currentSession}
          fixes={state.fixes}
          skipped={state.skipped}
          findings={state.iterationFindings}
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
          isStarting={isStartingRun}
          isStopping={isStoppingRun}
          focused={focusedPanel === "session" && !showHelp}
        />
        <OutputPanel
          output={state.tmuxOutput}
          sessionName={state.currentSession?.sessionName ?? null}
          focused={focusedPanel === "output" && !showHelp}
        />
      </box>
      <StatusBar hasSession={Boolean(state.currentSession)} focusedPanel={focusedPanel} />
      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
    </box>
  );
}
