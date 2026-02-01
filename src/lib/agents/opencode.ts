/**
 * OpenCode agent configuration
 * Integrates with OpenCode CLI (no JSONL streaming)
 */

import type { AgentConfig, AgentRole, ReviewOptions } from "@/lib/types";

export const opencodeConfig: AgentConfig = {
  command: "opencode",
  buildArgs: (
    _role: AgentRole,
    prompt: string,
    model?: string,
    _reviewOptions?: ReviewOptions
  ): string[] => {
    const args = ["run"];
    if (model) {
      args.push("--model", model);
    }
    args.push(prompt);
    return args;
  },
  buildEnv: (): Record<string, string> => {
    return {
      ...(process.env as Record<string, string>),
    };
  },
};

// Result extraction is done inline in the AGENTS registry.
