import * as p from "@clack/prompts";
import { getCommandDef } from "@/cli";

export interface InteractiveCommandDeps {
  getCommandDef: typeof getCommandDef;
  logError: (message: string) => void;
  exit: (code: number) => void;
  isTTY: () => boolean;
}

export function createInteractiveCommandDeps(): InteractiveCommandDeps {
  return {
    getCommandDef,
    logError: (message) => p.log.error(message),
    exit: (code) => process.exit(code),
    isTTY: () => process.stdout.isTTY === true,
  };
}
