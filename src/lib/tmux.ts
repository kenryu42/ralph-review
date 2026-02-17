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

interface ShellStatusResult {
  exitCode: number;
}

interface ShellTextResult extends ShellStatusResult {
  text(): string;
}

interface TmuxCaptureProcess {
  exited: Promise<number>;
  exitCode: number | null;
  stdout: ReadableStream<Uint8Array> | null;
  kill(): unknown;
}

interface TmuxDependencies {
  hasSession(name: string): Promise<ShellStatusResult>;
  createSession(name: string, command: string): Promise<unknown>;
  sendInterrupt(name: string): Promise<unknown>;
  killSession(name: string): Promise<unknown>;
  listSessions(): Promise<ShellTextResult>;
  spawnCapturePane(name: string, lines: number): TmuxCaptureProcess;
  readText(stdout: ReadableStream<Uint8Array>): Promise<string>;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
}

type SessionExistsDeps = Pick<TmuxDependencies, "hasSession">;
type CreateSessionDeps = Pick<TmuxDependencies, "createSession">;
type SendInterruptDeps = Pick<TmuxDependencies, "sendInterrupt">;
type KillSessionDeps = Pick<TmuxDependencies, "killSession">;
type ListSessionsDeps = Pick<TmuxDependencies, "listSessions">;
type SessionOutputDeps = Pick<
  TmuxDependencies,
  "spawnCapturePane" | "readText" | "setTimeout" | "clearTimeout"
>;

const TMUX_DEPS: TmuxDependencies = {
  hasSession: (name) => $`tmux has-session -t ${name} 2>/dev/null`.quiet(),
  createSession: (name, command) => $`tmux new-session -d -s ${name} ${command}`.quiet(),
  sendInterrupt: (name) => $`tmux send-keys -t ${name} C-c`.quiet(),
  killSession: (name) => $`tmux kill-session -t ${name}`.quiet(),
  listSessions: () => $`tmux list-sessions -F '#{session_name}'`.quiet(),
  spawnCapturePane: (name, lines) =>
    Bun.spawn(["tmux", "capture-pane", "-t", name, "-p", "-S", `-${lines}`], {
      stdout: "pipe",
      stderr: "ignore",
    }),
  readText: (stdout) => new Response(stdout).text(),
  setTimeout,
  clearTimeout,
};

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

export async function sessionExists(
  name: string,
  deps: SessionExistsDeps = TMUX_DEPS
): Promise<boolean> {
  try {
    const result = await deps.hasSession(name);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function createSession(
  name: string,
  command: string,
  deps: CreateSessionDeps = TMUX_DEPS
): Promise<void> {
  await deps.createSession(name, command);
}

export async function sendInterrupt(
  name: string,
  deps: SendInterruptDeps = TMUX_DEPS
): Promise<void> {
  try {
    await deps.sendInterrupt(name);
  } catch {
    // Session might not exist
  }
}

export async function killSession(name: string, deps: KillSessionDeps = TMUX_DEPS): Promise<void> {
  try {
    await deps.killSession(name);
  } catch {
    // Session might not exist
  }
}

export async function listSessions(deps: ListSessionsDeps = TMUX_DEPS): Promise<string[]> {
  try {
    const result = await deps.listSessions();
    if (result.exitCode !== 0) {
      return [];
    }
    return result.text().trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export async function listRalphSessions(deps: ListSessionsDeps = TMUX_DEPS): Promise<string[]> {
  const sessions = await listSessions(deps);
  return sessions.filter((name) => name.startsWith("rr-"));
}

export function normalizeSessionOutput(output: string): string {
  // Keep leading indentation (used by box-drawing output) but drop trailing capture padding.
  return output.trimEnd();
}

export async function getSessionOutput(
  name: string,
  lines: number = 50,
  deps: SessionOutputDeps = TMUX_DEPS
): Promise<string> {
  const safeLines = Number.isFinite(lines) && lines > 0 ? Math.floor(lines) : 50;
  const timeoutMs = 750;

  try {
    const proc = deps.spawnCapturePane(name, safeLines);

    let timedOut = false;
    const timeoutId = deps.setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);

    await proc.exited.catch(() => {});
    deps.clearTimeout(timeoutId);

    if (timedOut || proc.exitCode !== 0 || !proc.stdout) {
      return "";
    }

    const output = await deps.readText(proc.stdout);
    return normalizeSessionOutput(output);
  } catch {
    return "";
  }
}
