import * as p from "@clack/prompts";
import { getCommandDef } from "@/cli";

export interface InteractiveCommandDeps {
  getCommandDef: typeof getCommandDef;
  logError: (message: string) => void;
  exit: (code: number) => void;
  isTTY: () => boolean;
}

export type PromptSelect = (input: {
  message: string;
  options: Array<{ value: string; label: string; hint: string }>;
}) => Promise<unknown>;

export interface PromptDeps {
  logInfo: (message: string) => void;
  logMessage: (message: string) => void;
  logStep: (message: string) => void;
  logSuccess: (message: string) => void;
  select: PromptSelect;
  isCancel: (value: unknown) => boolean;
}

export function createInteractiveCommandDeps(): InteractiveCommandDeps {
  return {
    getCommandDef,
    logError: (message) => p.log.error(message),
    exit: (code) => process.exit(code),
    isTTY: () => process.stdout.isTTY === true,
  };
}

export function createPromptDeps(): PromptDeps {
  return {
    logInfo: p.log.info,
    logMessage: p.log.message,
    logStep: p.log.step,
    logSuccess: p.log.success,
    select: p.select,
    isCancel: p.isCancel,
  };
}
