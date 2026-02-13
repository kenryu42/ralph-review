import * as p from "@clack/prompts";
import { getCommandDef } from "@/cli";
import { parseCommand } from "@/lib/cli-parser";
import {
  listAllActiveSessions,
  readLockfile,
  removeAllLockfiles,
  removeLockfile,
  updateLockfile,
} from "@/lib/lockfile";
import { killSession, listRalphSessions, sendInterrupt } from "@/lib/tmux";

interface StopOptions {
  all: boolean;
}

export async function runStop(args: string[]): Promise<void> {
  // Parse options
  const stopDef = getCommandDef("stop");
  if (!stopDef) {
    p.log.error("Internal error: stop command definition not found");
    process.exit(1);
  }

  let options: StopOptions;
  try {
    const { values } = parseCommand<StopOptions>(stopDef, args);
    options = values;
  } catch (error) {
    p.log.error(`${error}`);
    process.exit(1);
  }

  if (options.all) {
    await stopAllSessions();
  } else {
    await stopCurrentSession();
  }
}

async function stopAllSessions(): Promise<void> {
  const activeSessions = await listAllActiveSessions();
  const tmuxSessions = await listRalphSessions();
  const sessionNames = [
    ...new Set([...tmuxSessions, ...activeSessions.map((session) => session.sessionName)]),
  ];

  if (sessionNames.length === 0) {
    p.log.info("No active review sessions.");
    await removeAllLockfiles();
    return;
  }

  p.log.step(`Stopping ${sessionNames.length} session(s)...`);

  for (const session of activeSessions) {
    await updateLockfile(
      undefined,
      session.projectPath,
      {
        state: "stopping",
        status: "stopping",
        lastHeartbeat: Date.now(),
      },
      {
        expectedSessionId: session.sessionId,
      }
    );
  }

  for (const sessionName of sessionNames) {
    await sendInterrupt(sessionName);
  }

  await new Promise((resolve) => setTimeout(resolve, 1000));

  for (const sessionName of sessionNames) {
    await killSession(sessionName);
    p.log.message(`  Stopped: ${sessionName}`);
  }

  for (const session of activeSessions) {
    await removeLockfile(undefined, session.projectPath, { expectedSessionId: session.sessionId });
  }

  // Fallback cleanup for stale/legacy lockfiles that were not tied to active sessions.
  await removeAllLockfiles();

  p.log.success(`Stopped ${sessionNames.length} session(s).`);
}

async function stopCurrentSession(): Promise<void> {
  const projectPath = process.cwd();

  // Read lockfile to get session name
  const lockData = await readLockfile(undefined, projectPath);

  if (!lockData) {
    p.log.info(`No active review session for current working directory.`);

    // Show hint if there are other sessions running
    const allSessions = await listAllActiveSessions();
    if (allSessions.length > 0) {
      p.log.message(`\nThere are ${allSessions.length} other session(s) running.`);
      p.log.message(
        'Use "rr stop --all" to stop all running review sessions, or "rr status" to see details.'
      );
    }
    return;
  }

  p.log.step(`Stopping session: ${lockData.sessionName}`);

  await updateLockfile(
    undefined,
    projectPath,
    {
      state: "stopping",
      status: "stopping",
      lastHeartbeat: Date.now(),
    },
    {
      expectedSessionId: lockData.sessionId,
    }
  );

  await sendInterrupt(lockData.sessionName);

  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Kill the tmux session
  await killSession(lockData.sessionName);

  // Remove the lockfile
  await removeLockfile(undefined, projectPath, { expectedSessionId: lockData.sessionId });

  p.log.success("Review stopped.");
}
