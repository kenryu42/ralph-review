/**
 * OpenCode agent configuration
 */

import { type AgentConfig, type AgentRole, isThinkingLevel, type ReviewOptions } from "@/lib/types";
import { defaultBuildEnv } from "./core";

export const opencodeConfig: AgentConfig = {
  command: "opencode",
  buildArgs: (
    _role: AgentRole,
    prompt: string,
    model?: string,
    _reviewOptions?: ReviewOptions,
    _provider?: string,
    thinking?: string
  ): string[] => {
    const args = ["run"];
    if (model) {
      args.push("--model", model);
    }
    if (isThinkingLevel(thinking) && thinking !== "max") {
      args.push("--variant", thinking);
    }
    args.push(prompt);
    return args;
  },
  buildEnv: defaultBuildEnv,
};
