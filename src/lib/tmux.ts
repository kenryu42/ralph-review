import { basename } from "node:path";
import { $ } from "bun";

export const TMUX_CAPTURE_MIN_INTERVAL_MS = 250;
export const TMUX_CAPTURE_MAX_INTERVAL_MS = 2000;

interface ShouldCaptureTmuxOptions {
  sessionChanged: boolean;
  liveMetaChanged: boolean;
  now: number;
  lastCaptureAt: number;
  currentIntervalMs: number;
}

interface ComputeNextTmuxCaptureIntervalOptions {
  sessionChanged: boolean;
  liveMetaChanged: boolean;
  outputChanged: boolean;
  previousIntervalMs: number;
}

function normalizeCaptureInterval(intervalMs: number): number {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return TMUX_CAPTURE_MIN_INTERVAL_MS;
  }

  return Math.min(
    TMUX_CAPTURE_MAX_INTERVAL_MS,
    Math.max(TMUX_CAPTURE_MIN_INTERVAL_MS, Math.floor(intervalMs))
  );
}

export function shouldCaptureTmux(options: ShouldCaptureTmuxOptions): boolean {
  if (options.sessionChanged || options.liveMetaChanged) {
    return true;
  }

  if (options.lastCaptureAt <= 0) {
    return true;
  }

  const intervalMs = normalizeCaptureInterval(options.currentIntervalMs);
  return options.now - options.lastCaptureAt >= intervalMs;
}

export function computeNextTmuxCaptureInterval(
  options: ComputeNextTmuxCaptureIntervalOptions
): number {
  if (options.sessionChanged || options.liveMetaChanged || options.outputChanged) {
    return TMUX_CAPTURE_MIN_INTERVAL_MS;
  }

  const baseInterval = normalizeCaptureInterval(options.previousIntervalMs);
  return Math.min(TMUX_CAPTURE_MAX_INTERVAL_MS, baseInterval * 2);
}

export function sanitizeBasename(basename: string): string {
  let sanitized = basename.replace(/[^a-zA-Z0-9_-]+/g, "-");
  sanitized = sanitized.replace(/-+/g, "-");
  sanitized = sanitized.replace(/^-+|-+$/g, "");
  sanitized = sanitized.slice(0, 20);
  sanitized = sanitized.replace(/-+$/, "");
  return sanitized || "project";
}

export function isTmuxInstalled(): boolean {
  return Bun.which("tmux") !== null;
}

export function isInsideTmux(): boolean {
  return Boolean(process.env.TMUX);
}

export function generateSessionName(projectName?: string): string {
  const name = projectName ?? basename(process.cwd());
  return `rr-${sanitizeBasename(name)}-${Date.now()}`;
}

export async function sessionExists(name: string): Promise<boolean> {
  try {
    const result = await $`tmux has-session -t ${name} 2>/dev/null`.quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function createSession(name: string, command: string): Promise<void> {
  await $`tmux new-session -d -s ${name} ${command}`;
}

export async function sendInterrupt(name: string): Promise<void> {
  try {
    await $`tmux send-keys -t ${name} C-c`.quiet();
  } catch {
    // Session might not exist
  }
}

export async function killSession(name: string): Promise<void> {
  try {
    await $`tmux kill-session -t ${name}`.quiet();
  } catch {
    // Session might not exist
  }
}

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

export async function listRalphSessions(): Promise<string[]> {
  const sessions = await listSessions();
  return sessions.filter((name) => name.startsWith("rr-"));
}

export function normalizeSessionOutput(output: string): string {
  // Keep leading indentation (used by box-drawing output) but drop trailing capture padding.
  return output.trimEnd();
}

export async function getSessionOutput(name: string, lines: number = 50): Promise<string> {
  const safeLines = Number.isFinite(lines) && lines > 0 ? Math.floor(lines) : 50;
  const timeoutMs = 750;

  try {
    const proc = Bun.spawn(["tmux", "capture-pane", "-t", name, "-p", "-S", `-${safeLines}`], {
      stdout: "pipe",
      stderr: "ignore",
    });

    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);

    await proc.exited.catch(() => {});
    clearTimeout(timeoutId);

    if (timedOut || proc.exitCode !== 0 || !proc.stdout) {
      return "";
    }

    const output = await new Response(proc.stdout).text();
    return normalizeSessionOutput(output);
  } catch {
    return "";
  }
}
