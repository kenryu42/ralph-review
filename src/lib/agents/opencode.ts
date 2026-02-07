/**
 * OpenCode agent configuration
 */

import {
  type AgentConfig,
  type AgentRole,
  isReasoningLevel,
  type ReviewOptions,
} from "@/lib/types";
import { defaultBuildEnv } from "./core";

export const opencodeConfig: AgentConfig = {
  command: "opencode",
  buildArgs: (
    _role: AgentRole,
    prompt: string,
    model?: string,
    _reviewOptions?: ReviewOptions,
    _provider?: string,
    reasoning?: string
  ): string[] => {
    const args = ["run"];
    if (model) {
      args.push("--model", model);
    }
    if (isReasoningLevel(reasoning) && reasoning !== "max") {
      args.push("--variant", reasoning);
    }
    args.push(prompt);
    return args;
  },
  buildEnv: defaultBuildEnv,
};
