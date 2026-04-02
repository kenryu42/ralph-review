import { discardSessionWorktree, type GitSessionWorktree } from "@/lib/git";
import { deleteSessionFiles, readLog } from "@/lib/logger";
import {
  type ActiveSession,
  readSessionState,
  removeSessionState,
  updateSessionState,
} from "@/lib/session-state";
import { killSession, sendInterrupt, sessionExists } from "@/lib/tmux";
import type { LogEntry } from "@/lib/types";

export const STOP_SESSION_GRACE_PERIOD_MS = 30_000;
export const STOP_SESSION_NO_SUCCESSFUL_ITERATION_GRACE_PERIOD_MS = 1_000;
export const STOP_SESSION_POLL_INTERVAL_MS = 1_000;

interface SessionStopTarget {
  sessionName: string;
  projectPath?: string;
  sessionId?: string;
}

interface WaitForGracefulStopDeps {
  readSessionState: typeof readSessionState;
  sessionExists: typeof sessionExists;
  sleep: (ms: number) => Promise<void>;
}

interface StopActiveSessionDeps {
  readLog: typeof readLog;
  deleteSessionFiles: typeof deleteSessionFiles;
  updateSessionState: typeof updateSessionState;
  sendInterrupt: typeof sendInterrupt;
  readSessionState: typeof readSessionState;
  sessionExists: typeof sessionExists;
  sleep: (ms: number) => Promise<void>;
  killSession: typeof killSession;
  discardSessionWorktree: typeof discardSessionWorktree;
  resolveSourceRepoPath: (projectPath: string) => string | null;
  removeSessionState: typeof removeSessionState;
}

const DEFAULT_STOP_ACTIVE_SESSION_DEPS: StopActiveSessionDeps = {
  readLog,
  deleteSessionFiles,
  updateSessionState,
  sendInterrupt,
  readSessionState,
  sessionExists,
  sleep: (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    }),
  killSession,
  discardSessionWorktree,
  resolveSourceRepoPath: (projectPath: string) => {
    const result = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
      cwd: projectPath,
      stdout: "pipe",
      stderr: "ignore",
    });

    if (result.exitCode !== 0) {
      return null;
    }

    const repoPath = result.stdout.toString().trim();
    return repoPath.length > 0 ? repoPath : null;
  },
  removeSessionState,
};

function isTerminalSessionState(state: ActiveSession["state"]): boolean {
  return (
    state === "completed" || state === "failed" || state === "interrupted" || state === "stopped"
  );
}

async function hasStoppedGracefully(
  target: SessionStopTarget,
  deps: WaitForGracefulStopDeps
): Promise<boolean> {
  if (target.projectPath && target.sessionId) {
    const sessionState = await deps.readSessionState(
      undefined,
      target.projectPath,
      target.sessionId
    );
    if (sessionState && isTerminalSessionState(sessionState.state)) {
      return true;
    }
    if (!sessionState) {
      return !(await deps.sessionExists(target.sessionName));
    }
  }

  return !(await deps.sessionExists(target.sessionName));
}

async function waitForGracefulStop(
  target: SessionStopTarget,
  gracePeriodMs: number,
  deps: Partial<WaitForGracefulStopDeps> = {}
): Promise<boolean> {
  const waitDeps = { ...DEFAULT_STOP_ACTIVE_SESSION_DEPS, ...deps };

  if (await hasStoppedGracefully(target, waitDeps)) {
    return true;
  }

  let remainingMs = gracePeriodMs;
  while (remainingMs > 0) {
    const sleepMs = Math.min(STOP_SESSION_POLL_INTERVAL_MS, remainingMs);
    await waitDeps.sleep(sleepMs);
    remainingMs -= sleepMs;

    if (await hasStoppedGracefully(target, waitDeps)) {
      return true;
    }
  }

  return false;
}

function hasSuccessfulReviewIteration(entries: LogEntry[]): boolean {
  return entries.some((entry) => entry.type === "iteration" && entry.fixes !== undefined);
}

function hasRecordedIteration(entries: LogEntry[]): boolean {
  return entries.some((entry) => entry.type === "iteration");
}

interface SessionIterationState {
  hasRecordedIteration: boolean;
  hasSuccessfulReviewIteration: boolean;
}

async function resolveSessionIterationState(
  session: ActiveSession,
  deps: StopActiveSessionDeps
): Promise<SessionIterationState | null> {
  if (!session.sessionPath) {
    return null;
  }

  try {
    const entries = await deps.readLog(session.sessionPath);
    return {
      hasRecordedIteration: hasRecordedIteration(entries),
      hasSuccessfulReviewIteration: hasSuccessfulReviewIteration(entries),
    };
  } catch {
    return null;
  }
}

function createCleanupWorktree(
  session: ActiveSession,
  sourceRepoPath: string
): GitSessionWorktree | null {
  if (!session.worktreeProjectPath || !session.worktreeBranch) {
    return null;
  }

  return {
    sourceProjectPath: session.projectPath,
    sourceRepoPath,
    worktreeProjectPath: session.worktreeProjectPath,
    agentProjectPath: session.worktreeProjectPath,
    retainedBranch: session.worktreeBranch,
    headKind: "detached",
    preserveBranchOnDiscard: false,
  };
}

function cleanupUnpromotedSessionWorktree(
  session: ActiveSession,
  deps: StopActiveSessionDeps
): void {
  const sourceRepoPath = deps.resolveSourceRepoPath(session.projectPath);
  if (!sourceRepoPath) {
    return;
  }

  const worktree = createCleanupWorktree(session, sourceRepoPath);
  if (!worktree) {
    return;
  }

  try {
    deps.discardSessionWorktree(worktree);
  } catch (error) {
    console.warn(`Failed to discard unpromoted session worktree: ${error}`);
  }
}

export async function stopActiveSession(
  session: ActiveSession,
  deps: Partial<StopActiveSessionDeps> = {}
): Promise<void> {
  const stopDeps = { ...DEFAULT_STOP_ACTIVE_SESSION_DEPS, ...deps };
  const initialIterationState = await resolveSessionIterationState(session, stopDeps);
  const gracePeriodMs =
    initialIterationState?.hasSuccessfulReviewIteration === false
      ? STOP_SESSION_NO_SUCCESSFUL_ITERATION_GRACE_PERIOD_MS
      : STOP_SESSION_GRACE_PERIOD_MS;

  await stopDeps.updateSessionState(
    undefined,
    session.projectPath,
    session.sessionId,
    {
      state: "stopping",
      lastHeartbeat: Date.now(),
    },
    {
      expectedSessionId: session.sessionId,
    }
  );

  await stopDeps.sendInterrupt(session.sessionName);
  const stoppedGracefully = await waitForGracefulStop(
    {
      sessionName: session.sessionName,
      projectPath: session.projectPath,
      sessionId: session.sessionId,
    },
    gracePeriodMs,
    stopDeps
  );
  if (!stoppedGracefully) {
    await stopDeps.killSession(session.sessionName);
  }

  const finalIterationState = await resolveSessionIterationState(session, stopDeps);
  if (finalIterationState?.hasSuccessfulReviewIteration === false) {
    cleanupUnpromotedSessionWorktree(session, stopDeps);
  }

  let deleteSessionFilesError: unknown;
  if (finalIterationState?.hasRecordedIteration === false && session.sessionPath) {
    try {
      await stopDeps.deleteSessionFiles(session.sessionPath);
    } catch (error) {
      deleteSessionFilesError = error;
    }
  }

  await stopDeps.removeSessionState(undefined, session.projectPath, session.sessionId, {
    expectedSessionId: session.sessionId,
  });

  if (deleteSessionFilesError) {
    throw deleteSessionFilesError;
  }
}
