import { cleanupStaleLockfile } from "@/lib/lockfile";
import { resolveTmuxInstallGuidance } from "./tmux-install";
import type { DiagnosticItem } from "./types";

export interface FixResult {
  id: string;
  success: boolean;
  message: string;
  nextActions?: string[];
  attemptedCommand?: string;
  category?: "auto-fixed" | "manual-needed" | "no-op";
}

const FIXABLE_IDS = new Set<string>([
  "tmux-installed",
  "config-missing",
  "config-invalid",
  "run-lockfile",
]);

const CONFIG_FIXABLE_PATTERN =
  /^config-(reviewer|fixer|code-simplifier)-(agent-invalid|agent-missing|pi-invalid|model-missing|model-unverified)$/;

export function isFixable(id: string): boolean {
  return FIXABLE_IDS.has(id) || CONFIG_FIXABLE_PATTERN.test(id);
}

export interface RemediationDependencies {
  spawn: typeof Bun.spawn;
  cleanupStaleLockfile: typeof cleanupStaleLockfile;
  execPath: string;
  cliPath: string;
  projectPath: string;
  which: (command: string) => string | null;
  platform: NodeJS.Platform;
}

function getDefaultDependencies(): RemediationDependencies {
  return {
    spawn: Bun.spawn,
    cleanupStaleLockfile,
    execPath: process.execPath,
    cliPath: `${import.meta.dir}/../../cli.ts`,
    projectPath: process.cwd(),
    which: Bun.which,
    platform: process.platform,
  };
}

function isConfigFixableId(id: string): boolean {
  return id === "config-missing" || id === "config-invalid" || CONFIG_FIXABLE_PATTERN.test(id);
}

async function fixTmux(deps: RemediationDependencies): Promise<FixResult> {
  const guidance = resolveTmuxInstallGuidance({
    platform: deps.platform,
    which: deps.which,
    recheckCommand: "rr doctor --fix",
  });

  if (!guidance.commandArgs || !guidance.commandDisplay) {
    return {
      id: "tmux-installed",
      success: false,
      message: "No supported package manager was detected to auto-install tmux.",
      category: "manual-needed",
      nextActions: guidance.nextActions,
    };
  }

  try {
    const proc = deps.spawn(guidance.commandArgs, {
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    });
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      return {
        id: "tmux-installed",
        success: true,
        message: "tmux installed successfully.",
        category: "auto-fixed",
        attemptedCommand: guidance.commandDisplay,
      };
    }
    return {
      id: "tmux-installed",
      success: false,
      message: `${guidance.commandDisplay} exited with code ${exitCode}.`,
      category: "manual-needed",
      attemptedCommand: guidance.commandDisplay,
      nextActions: guidance.nextActions,
    };
  } catch (error) {
    return {
      id: "tmux-installed",
      success: false,
      message: `Failed to install tmux: ${error}`,
      category: "manual-needed",
      attemptedCommand: guidance.commandDisplay,
      nextActions: guidance.nextActions,
    };
  }
}

const CONFIG_FIX_NEXT_ACTIONS = ["Run: rr init", "Then run: rr doctor --fix"];
const MIXED_CONFIG_FIX_NEXT_ACTIONS = [
  "Run: rr init --global",
  "Run: rr init --local",
  "Then run: rr doctor --fix",
];

async function fixConfig(item: DiagnosticItem, deps: RemediationDependencies): Promise<FixResult> {
  if (item.context?.configScope === "mixed") {
    return {
      id: item.id,
      success: false,
      message:
        "Cannot auto-fix configuration because both the global and repo-local config need attention.",
      category: "manual-needed",
      nextActions: MIXED_CONFIG_FIX_NEXT_ACTIONS,
    };
  }

  const initScopeArg =
    item.context?.configScope === "local"
      ? "--local"
      : item.context?.configScope === "global"
        ? "--global"
        : null;
  const initArgs = initScopeArg ? ["init", initScopeArg] : ["init"];
  const attemptedCommand = initScopeArg ? `rr init ${initScopeArg}` : "rr init";
  const nextActions =
    item.context?.configScope === "local"
      ? ["Run: rr init --local", "Then run: rr doctor --fix"]
      : item.context?.configScope === "global"
        ? ["Run: rr init --global", "Then run: rr doctor --fix"]
        : CONFIG_FIX_NEXT_ACTIONS;
  try {
    const proc = deps.spawn([deps.execPath, deps.cliPath, ...initArgs], {
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    });
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      return {
        id: item.id,
        success: true,
        message: "Configuration updated via rr init.",
        category: "auto-fixed",
        attemptedCommand,
      };
    }
    return {
      id: item.id,
      success: false,
      message: `${attemptedCommand} exited with code ${exitCode}.`,
      category: "manual-needed",
      attemptedCommand,
      nextActions,
    };
  } catch (error) {
    return {
      id: item.id,
      success: false,
      message: `Failed to run ${attemptedCommand}: ${error}`,
      category: "manual-needed",
      attemptedCommand,
      nextActions,
    };
  }
}

const LOCKFILE_FIX_NEXT_ACTIONS = ["Run: rr", "Run: rr stop", "Then run: rr run"];

async function fixLockfile(deps: RemediationDependencies): Promise<FixResult> {
  try {
    const cleaned = await deps.cleanupStaleLockfile(undefined, deps.projectPath);
    if (cleaned) {
      return {
        id: "run-lockfile",
        success: true,
        message: "Stale lockfile removed.",
        category: "auto-fixed",
      };
    }
    return {
      id: "run-lockfile",
      success: false,
      message:
        "Lock is still active (heartbeat/session checks passed). Use rr stop to terminate it.",
      category: "manual-needed",
      nextActions: LOCKFILE_FIX_NEXT_ACTIONS,
    };
  } catch (error) {
    return {
      id: "run-lockfile",
      success: false,
      message: `Failed to clean lockfile: ${error}`,
      category: "manual-needed",
      nextActions: LOCKFILE_FIX_NEXT_ACTIONS,
    };
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
      return fixConfig(item, resolved);
    case "run-lockfile":
      return fixLockfile(resolved);
    default:
      if (isConfigFixableId(item.id)) {
        return fixConfig(item, resolved);
      }
      return {
        id: item.id,
        success: false,
        message: `No fix available for '${item.id}'.`,
        category: "no-op",
      };
  }
}

export async function applyFixes(
  items: DiagnosticItem[],
  deps?: Partial<RemediationDependencies>
): Promise<FixResult[]> {
  const fixable = items.filter((item) => item.severity !== "ok" && isFixable(item.id));
  const results: FixResult[] = [];
  let attemptedConfigRemediation = false;

  for (const item of fixable) {
    if (isConfigFixableId(item.id)) {
      if (attemptedConfigRemediation) {
        continue;
      }
      attemptedConfigRemediation = true;
    }

    const result = await applyFix(item, deps);
    results.push(result);
  }

  return results;
}
