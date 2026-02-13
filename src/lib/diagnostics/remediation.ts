import { cleanupStaleLockfile } from "@/lib/lockfile";
import type { DiagnosticItem } from "./types";

export interface FixResult {
  id: string;
  success: boolean;
  message: string;
}

const FIXABLE_IDS = new Set<string>([
  "tmux-installed",
  "config-missing",
  "config-invalid",
  "run-lockfile",
]);

export function isFixable(id: string): boolean {
  return FIXABLE_IDS.has(id);
}

export interface RemediationDependencies {
  spawn: typeof Bun.spawn;
  cleanupStaleLockfile: typeof cleanupStaleLockfile;
  execPath: string;
  cliPath: string;
  projectPath: string;
}

function getDefaultDependencies(): RemediationDependencies {
  return {
    spawn: Bun.spawn,
    cleanupStaleLockfile,
    execPath: process.execPath,
    cliPath: `${import.meta.dir}/../../cli.ts`,
    projectPath: process.cwd(),
  };
}

async function fixTmux(deps: RemediationDependencies): Promise<FixResult> {
  try {
    const proc = deps.spawn(["brew", "install", "tmux"], {
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      return { id: "tmux-installed", success: true, message: "tmux installed successfully." };
    }
    return {
      id: "tmux-installed",
      success: false,
      message: `brew install tmux exited with code ${exitCode}.`,
    };
  } catch (error) {
    return { id: "tmux-installed", success: false, message: `Failed to install tmux: ${error}` };
  }
}

async function fixConfig(
  id: "config-missing" | "config-invalid",
  deps: RemediationDependencies
): Promise<FixResult> {
  try {
    const proc = deps.spawn([deps.execPath, deps.cliPath, "init"], {
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    });
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      return { id, success: true, message: "Configuration created via rr init." };
    }
    return { id, success: false, message: `rr init exited with code ${exitCode}.` };
  } catch (error) {
    return { id, success: false, message: `Failed to run rr init: ${error}` };
  }
}

async function fixLockfile(deps: RemediationDependencies): Promise<FixResult> {
  try {
    const cleaned = await deps.cleanupStaleLockfile(undefined, deps.projectPath);
    if (cleaned) {
      return { id: "run-lockfile", success: true, message: "Stale lockfile removed." };
    }
    return {
      id: "run-lockfile",
      success: false,
      message:
        "Lockfile is not stale — a review may still be running. Use rr stop to terminate it.",
    };
  } catch (error) {
    return { id: "run-lockfile", success: false, message: `Failed to clean lockfile: ${error}` };
  }
}

export async function applyFix(
  item: DiagnosticItem,
  deps?: Partial<RemediationDependencies>
): Promise<FixResult> {
  const resolved = { ...getDefaultDependencies(), ...deps };

  switch (item.id) {
    case "tmux-installed":
      return fixTmux(resolved);
    case "config-missing":
    case "config-invalid":
      return fixConfig(item.id, resolved);
    case "run-lockfile":
      return fixLockfile(resolved);
    default:
      return { id: item.id, success: false, message: `No fix available for '${item.id}'.` };
  }
}

export async function applyFixes(
  items: DiagnosticItem[],
  deps?: Partial<RemediationDependencies>
): Promise<FixResult[]> {
  const fixable = items.filter((item) => item.severity !== "ok" && isFixable(item.id));
  const results: FixResult[] = [];

  for (const item of fixable) {
    const result = await applyFix(item, deps);
    results.push(result);
  }

  return results;
}
