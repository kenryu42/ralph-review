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

interface DashboardRunControlDeps {
  spawn?: typeof Bun.spawn;
}

export function useDashboardRunControl(
  projectPath: string,
  deps?: DashboardRunControlDeps
): DashboardRunControl {
  const [runError, setRunError] = useState<string | null>(null);
  const [startupMode, setStartupMode] = useState<DashboardStartupMode>(null);
  const isStartupSpawningRef = useRef(false);
  const spawn = deps?.spawn ?? Bun.spawn;

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
        const subprocess = spawn([process.execPath, CLI_PATH, command, ...argv], {
          cwd: projectPath,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        });

        void subprocess.exited
          .then(async (exitCode) => {
            isStartupSpawningRef.current = false;

            if (exitCode !== 0) {
              const [stderr, stdout] = await Promise.all([
                subprocess.stderr ? new Response(subprocess.stderr).text() : Promise.resolve(""),
                subprocess.stdout ? new Response(subprocess.stdout).text() : Promise.resolve(""),
              ]);
              setStartupMode(null);
              setRunError(
                stderr.trim() || stdout.trim() || `Command failed with exit code ${exitCode}`
              );
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
    [projectPath, spawn]
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
