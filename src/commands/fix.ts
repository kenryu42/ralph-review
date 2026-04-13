import * as p from "@clack/prompts";
import { CliError } from "@/lib/cli-parser";
import { CONFIG_DIR, loadEffectiveConfig } from "@/lib/config";
import { formatHandoffNote } from "@/lib/handoff-note";
import { loadFindingsArtifactBySessionId } from "@/lib/review-workflow/findings/artifact";
import type { FindingId } from "@/lib/review-workflow/findings/types";
import { runFixSession } from "@/lib/review-workflow/remediation/run-fix-session";
import type { Priority } from "@/lib/types";

export interface ParsedFixCommandOptions {
  sessionId: string;
  selector?: {
    all?: boolean;
    priorities?: Priority[];
    ids?: FindingId[];
  };
}

export interface FixCommandDeps {
  loadConfig: typeof loadEffectiveConfig;
  loadFindingsArtifactBySessionId: typeof loadFindingsArtifactBySessionId;
  runFixSession: typeof runFixSession;
  isTTY: () => boolean;
  logError: (message: string) => void;
  exit: (code: number) => void;
}

const DEFAULT_FIX_COMMAND_DEPS: FixCommandDeps = {
  loadConfig: loadEffectiveConfig,
  loadFindingsArtifactBySessionId,
  runFixSession,
  isTTY: () => process.stdout.isTTY === true,
  logError: (message: string) => p.log.error(message),
  exit: (code: number) => process.exit(code),
};

function readOptionValue(args: string[], index: number, optionName: string): [string, number] {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`Option --${optionName} requires a value`);
  }
  return [value, index + 1];
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function isPriority(value: string): value is Priority {
  return value === "P0" || value === "P1" || value === "P2" || value === "P3";
}

function isFindingId(value: string): value is FindingId {
  return /^F\d+$/u.test(value);
}

export function parseFixCommandOptions(args: string[]): ParsedFixCommandOptions {
  let sessionId: string | undefined;
  let all = false;
  const priorities: Priority[] = [];
  const ids: FindingId[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }

    if (arg === "--session" || arg === "-s") {
      const [value, nextIndex] = readOptionValue(args, index, "session");
      sessionId = value.trim();
      index = nextIndex;
      continue;
    }

    if (arg.startsWith("--session=")) {
      sessionId = arg.slice("--session=".length).trim();
      continue;
    }

    if (arg === "--all") {
      all = true;
      continue;
    }

    if (arg === "--priority") {
      const [value, nextIndex] = readOptionValue(args, index, "priority");
      if (!isPriority(value)) {
        throw new Error(`Invalid priority: ${value}`);
      }
      priorities.push(value);
      index = nextIndex;
      continue;
    }

    if (arg.startsWith("--priority=")) {
      const value = arg.slice("--priority=".length);
      if (!isPriority(value)) {
        throw new Error(`Invalid priority: ${value}`);
      }
      priorities.push(value);
      continue;
    }

    if (arg === "--id") {
      const [value, nextIndex] = readOptionValue(args, index, "id");
      if (!isFindingId(value)) {
        throw new Error(`Invalid finding ID: ${value}`);
      }
      ids.push(value);
      index = nextIndex;
      continue;
    }

    if (arg.startsWith("--id=")) {
      const value = arg.slice("--id=".length);
      if (!isFindingId(value)) {
        throw new Error(`Invalid finding ID: ${value}`);
      }
      ids.push(value);
      continue;
    }

    throw new CliError("fix", "unknown_option", arg, ["--session", "--all", "--priority", "--id"]);
  }

  if (!sessionId) {
    throw new CliError("fix", "missing_required", "session");
  }

  const selectorModeCount =
    (all ? 1 : 0) + (priorities.length > 0 ? 1 : 0) + (ids.length > 0 ? 1 : 0);
  if (selectorModeCount > 1) {
    throw new Error(
      "Selector modes are mutually exclusive. Use only one of --all, --priority, or --id."
    );
  }

  const selector =
    all || priorities.length > 0 || ids.length > 0
      ? {
          all: all || undefined,
          priorities: priorities.length > 0 ? unique(priorities) : undefined,
          ids: ids.length > 0 ? unique(ids) : undefined,
        }
      : undefined;

  return {
    sessionId,
    selector,
  };
}

export async function runFix(
  args: string[] = [],
  deps: Partial<FixCommandDeps> = {}
): Promise<void> {
  const commandDeps = { ...DEFAULT_FIX_COMMAND_DEPS, ...deps };

  let parsed: ParsedFixCommandOptions;
  try {
    parsed = parseFixCommandOptions(args);
  } catch (error) {
    commandDeps.logError(`${error}`);
    commandDeps.exit(1);
    return;
  }

  const artifact = await commandDeps.loadFindingsArtifactBySessionId(CONFIG_DIR, parsed.sessionId);
  if (!artifact) {
    commandDeps.logError(`Findings artifact not found for session ${parsed.sessionId}`);
    commandDeps.exit(1);
    return;
  }

  const config = await commandDeps.loadConfig(artifact.projectPath);
  if (!config) {
    commandDeps.logError("Failed to load configuration");
    commandDeps.exit(1);
    return;
  }

  const result = await commandDeps.runFixSession(config, {
    sessionId: parsed.sessionId,
    selector: parsed.selector,
    isTTY: commandDeps.isTTY(),
  });

  if (result.sessionStatus === "failed") {
    commandDeps.logError(result.reason);
    commandDeps.exit(1);
    return;
  }

  if (result.reviewOutcome === "findings-pending") {
    p.log.info(result.reason);
    return;
  }

  const handoffNote = formatHandoffNote({
    handoffStatus: result.handoffStatus,
    commitSha: result.commitSha,
    applyCommand: result.artifact
      ? `Apply: rr apply --session ${result.artifact.sessionId}`
      : undefined,
    discardCommand: result.artifact
      ? `Discard: rr discard --session ${result.artifact.sessionId}`
      : undefined,
  });

  if (result.reviewOutcome === "fixed-selected") {
    p.log.success(result.reason);
    if (handoffNote) {
      p.note(handoffNote, "Handoff");
    }
    return;
  }

  p.log.warn(result.reason);
  if (handoffNote) {
    p.note(handoffNote, "Handoff");
  }
  commandDeps.exit(1);
}
