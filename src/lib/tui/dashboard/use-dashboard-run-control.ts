import { useCallback, useRef, useState } from "react";
import { CLI_PATH } from "@/lib/paths";
import { getErrorMessage } from "@/lib/tui/shared/error-message";

export interface DashboardRunControl {
  runError: string | null;
  isStartingRun: boolean;
  clearRunError: () => void;
  clearRunStartState: () => void;
  setRunError: (message: string | null) => void;
  spawnRunProcess: (runArgs: string[]) => void;
  isRunSpawning: () => boolean;
}

export function useDashboardRunControl(projectPath: string): DashboardRunControl {
  const [runError, setRunError] = useState<string | null>(null);
  const [isStartingRun, setIsStartingRun] = useState(false);
  const isRunSpawningRef = useRef(false);

  const clearRunError = useCallback(() => {
    setRunError(null);
  }, []);

  const clearRunStartState = useCallback(() => {
    setRunError(null);
    setIsStartingRun(false);
  }, []);

  const spawnRunProcess = useCallback(
    (runArgs: string[]) => {
      isRunSpawningRef.current = true;
      setRunError(null);
      setIsStartingRun(true);

      try {
        const subprocess = Bun.spawn([process.execPath, CLI_PATH, "run", ...runArgs], {
          cwd: projectPath,
          stdin: "ignore",
          stdout: "ignore",
          stderr: "pipe",
        });

        void subprocess.exited
          .then(async (exitCode) => {
            isRunSpawningRef.current = false;

            if (exitCode !== 0) {
              const stderr = await new Response(subprocess.stderr).text();
              setIsStartingRun(false);
              setRunError(stderr.trim() || `Command failed with exit code ${exitCode}`);
            }
          })
          .catch((error) => {
            isRunSpawningRef.current = false;
            setIsStartingRun(false);
            setRunError(getErrorMessage(error));
          });
      } catch (error) {
        isRunSpawningRef.current = false;
        setIsStartingRun(false);
        setRunError(getErrorMessage(error));
      }
    },
    [projectPath]
  );

  const isRunSpawning = useCallback(() => isRunSpawningRef.current, []);

  return {
    runError,
    isStartingRun,
    clearRunError,
    clearRunStartState,
    setRunError,
    spawnRunProcess,
    isRunSpawning,
  };
}
