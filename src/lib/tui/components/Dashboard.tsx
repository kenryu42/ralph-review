/**
 * Dashboard component - main TUI container
 */

import { basename } from "node:path";
import { useKeyboard, useRenderer } from "@opentui/react";
import { useCallback, useEffect, useRef } from "react";
import { removeLockfile } from "@/lib/lockfile";
import { killSession, sendInterrupt } from "@/lib/tmux";
import type { DashboardProps } from "../types";
import { useDashboardState } from "../use-dashboard-state";
import { Header } from "./Header";
import { OutputPanel } from "./OutputPanel";
import { SessionPanel } from "./SessionPanel";
import { StatusBar } from "./StatusBar";

export function Dashboard({ projectPath, branch, refreshInterval = 1000 }: DashboardProps) {
  const renderer = useRenderer();
  const state = useDashboardState(projectPath, branch, refreshInterval);

  const projectName = basename(projectPath);

  // Use ref to avoid stale closure in keyboard handler
  const currentSessionRef = useRef(state.currentSession);
  const isExitingRef = useRef(false);
  useEffect(() => {
    currentSessionRef.current = state.currentSession;
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

  // Handle keyboard input
  useKeyboard((key) => {
    // Quit on 'q' or Escape
    if (key.name === "q" || key.name === "escape") {
      void shutdown();
    }

    // Stop the review on 's'
    if (key.name === "s" && currentSessionRef.current) {
      const sessionName = currentSessionRef.current.sessionName;
      sendInterrupt(sessionName)
        .then(() => new Promise((resolve) => setTimeout(resolve, 1000)))
        .then(() => killSession(sessionName))
        .then(() => removeLockfile(undefined, projectPath))
        .catch(() => {
          // Ignore errors - session may already be stopped
        });
    }
  });

  // Show error if any
  if (state.error) {
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
          <text fg="#ef4444">Error: {state.error}</text>
        </box>
        <StatusBar hasSession={false} />
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
      <box flexDirection="row" flexGrow={1} gap={1} padding={1}>
        <SessionPanel
          session={state.currentSession}
          fixes={state.fixes}
          skipped={state.skipped}
          maxIterations={state.maxIterations}
          isLoading={state.isLoading}
          lastSessionStats={state.lastSessionStats}
          projectStats={state.projectStats}
          isGitRepo={state.isGitRepo}
        />
        <OutputPanel
          output={state.tmuxOutput}
          sessionName={state.currentSession?.sessionName ?? null}
        />
      </box>
      <StatusBar hasSession={Boolean(state.currentSession)} />
    </box>
  );
}
