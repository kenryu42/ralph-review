#!/usr/bin/env bun

import { printCommandHelp } from "@/cli-core";
import { CONSOLE_ERROR, CONSOLE_LOG, PROCESS_EXIT } from "@/cli-io";
import { startReview } from "@/commands/run";

export interface RrrDeps {
  printCommandHelp: typeof printCommandHelp;
  startReview: typeof startReview;
  log: (message: string) => void;
  error: (message: string) => void;
  exit: (code: number) => void;
}

const DEFAULT_RRR_DEPS: RrrDeps = {
  printCommandHelp,
  startReview,
  log: CONSOLE_LOG,
  error: CONSOLE_ERROR,
  exit: PROCESS_EXIT,
};

function buildRrrDeps(overrides: Partial<RrrDeps>): RrrDeps {
  return { ...DEFAULT_RRR_DEPS, ...overrides };
}

export async function runRrr(
  args: string[] = process.argv.slice(2),
  deps: Partial<RrrDeps> = {}
): Promise<void> {
  const rrrDeps = buildRrrDeps(deps);
  if (args.includes("--help") || args.includes("-h")) {
    rrrDeps.log("rrr - Start non-interactive review run\n");
    rrrDeps.log("USAGE:");
    rrrDeps.log("  rrr [options]\n");
    rrrDeps.log("Equivalent to 'rr run' without launching Interactive Mode.\n");
    const optionsMatch = rrrDeps
      .printCommandHelp("run")
      ?.match(/OPTIONS:[\s\S]*?(?=\nEXAMPLES:|\n\n|$)/);
    if (optionsMatch) {
      rrrDeps.log(optionsMatch[0]);
    }
    return;
  }

  await rrrDeps.startReview(args);
}

export function runRrrEntrypoint(
  run?: () => Promise<void>,
  deps: Pick<RrrDeps, "error" | "exit"> = DEFAULT_RRR_DEPS
): void {
  const runFn = run ?? runRrr;
  runFn().catch((error) => {
    deps.error(`Error: ${error}`);
    deps.exit(1);
  });
}

if (import.meta.main) {
  runRrrEntrypoint();
}
