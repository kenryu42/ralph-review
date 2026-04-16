import { useCallback, useRef, useState } from "react";
import { CLI_PATH } from "@/lib/paths";
import { getErrorMessage } from "@/lib/tui/shared/error-message";

export type DashboardStartupMode = "review" | "fix" | null;

export interface DashboardRunControl {
  runError: string | null;
  startupMode: DashboardStartupMode;
  clearRunError: () => void;
  clearRunStartState: () => void;
  setRunError: (message: string | null) => void;
  spawnRunProcess: (runArgs: string[]) => void;
  spawnFixProcess: (fixArgs: string[]) => void;
  isStartupSpawning: () => boolean;
}

export function useDashboardRunControl(projectPath: string): DashboardRunControl {
  const [runError, setRunError] = useState<string | null>(null);
  const [startupMode, setStartupMode] = useState<DashboardStartupMode>(null);
  const isStartupSpawningRef = useRef(false);

  const clearRunError = useCallback(() => {
    setRunError(null);
  }, []);

  const clearRunStartState = useCallback(() => {
    setRunError(null);
    setStartupMode(null);
  }, []);

  const spawnCommand = useCallback(
    (
      command: "run" | "fix",
      argv: string[],
      nextStartupMode: Exclude<DashboardStartupMode, null>
    ) => {
      isStartupSpawningRef.current = true;
      setRunError(null);
      setStartupMode(nextStartupMode);

      try {
        const subprocess = Bun.spawn([process.execPath, CLI_PATH, command, ...argv], {
          cwd: projectPath,
          stdin: "ignore",
          stdout: "ignore",
          stderr: "pipe",
        });

        void subprocess.exited
          .then(async (exitCode) => {
            isStartupSpawningRef.current = false;

            if (exitCode !== 0) {
              const stderr = await new Response(subprocess.stderr).text();
              setStartupMode(null);
              setRunError(stderr.trim() || `Command failed with exit code ${exitCode}`);
            }
          })
          .catch((error) => {
            isStartupSpawningRef.current = false;
            setStartupMode(null);
            setRunError(getErrorMessage(error));
          });
      } catch (error) {
        isStartupSpawningRef.current = false;
        setStartupMode(null);
        setRunError(getErrorMessage(error));
      }
    },
    [projectPath]
  );

  const spawnRunProcess = useCallback(
    (runArgs: string[]) => {
      spawnCommand("run", runArgs, "review");
    },
    [spawnCommand]
  );

  const spawnFixProcess = useCallback(
    (fixArgs: string[]) => {
      const commandArgs = fixArgs[0] === "fix" ? fixArgs.slice(1) : fixArgs;
      spawnCommand("fix", commandArgs, "fix");
    },
    [spawnCommand]
  );

  const isStartupSpawning = useCallback(() => isStartupSpawningRef.current, []);

  return {
    runError,
    startupMode,
    clearRunError,
    clearRunStartState,
    setRunError,
    spawnRunProcess,
    spawnFixProcess,
    isStartupSpawning,
  };
}
