/**
 * Tmux session management for ralph-review
 * Handles background execution of review cycles
 */

import { $ } from "bun";

/**
 * Check if tmux is installed on the system
 */
export function isTmuxInstalled(): boolean {
  return Bun.which("tmux") !== null;
}

/**
 * Generate a unique session name
 * Format: rr-{timestamp}
 */
export function generateSessionName(): string {
  return `rr-${Date.now()}`;
}

/**
 * Check if a tmux session exists
 */
export async function sessionExists(name: string): Promise<boolean> {
  try {
    const result = await $`tmux has-session -t ${name} 2>/dev/null`.quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Create a new detached tmux session
 */
export async function createSession(name: string, command: string): Promise<void> {
  await $`tmux new-session -d -s ${name} ${command}`;
}

/**
 * Attach to an existing tmux session
 * This will take over the terminal
 */
export async function attachSession(name: string): Promise<void> {
  // Use exec to replace the current process
  const proc = Bun.spawn(["tmux", "attach-session", "-t", name], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  await proc.exited;
}

/**
 * Kill a tmux session
 */
export async function killSession(name: string): Promise<void> {
  try {
    await $`tmux kill-session -t ${name}`.quiet();
  } catch {
    // Session might not exist, ignore error
  }
}

/**
 * List all tmux sessions
 * Returns array of session names
 */
export async function listSessions(): Promise<string[]> {
  try {
    const result = await $`tmux list-sessions -F '#{session_name}'`.quiet();
    if (result.exitCode !== 0) {
      return [];
    }
    return result.text().trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * List ralph-review sessions only
 */
export async function listRalphSessions(): Promise<string[]> {
  const sessions = await listSessions();
  return sessions.filter((name) => name.startsWith("rr-"));
}

/**
 * Get the most recent output from a tmux session's pane
 */
export async function getSessionOutput(name: string, lines: number = 50): Promise<string> {
  try {
    const result = await $`tmux capture-pane -t ${name} -p -S -${lines}`.quiet();
    if (result.exitCode !== 0) {
      return "";
    }
    return result.text().trim();
  } catch {
    return "";
  }
}

/**
 * Send keys to a tmux session
 */
export async function sendKeys(name: string, keys: string): Promise<void> {
  await $`tmux send-keys -t ${name} ${keys}`;
}

/**
 * Send Ctrl+C to a tmux session
 */
export async function sendInterrupt(name: string): Promise<void> {
  await $`tmux send-keys -t ${name} C-c`;
}
