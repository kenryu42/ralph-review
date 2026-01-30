/**
 * OpenCode agent configuration
 * Integrates with OpenCode CLI (no JSONL streaming)
 */

import type { AgentConfig, AgentRole } from "@/lib/types";

export const opencodeConfig: AgentConfig = {
  command: "opencode",
  buildArgs: (role: AgentRole, prompt: string, model?: string): string[] => {
    if (role === "reviewer") {
      const args = ["run"];
      if (model) {
        args.push("--model", model);
      }
      // Use custom prompt if provided, otherwise default to /review command
      args.push(prompt || "/review");
      return args;
    } else {
      const args = ["run"];
      if (model) {
        args.push("--model", model);
      }
      args.push(prompt);
      return args;
    }
  },
  buildEnv: (): Record<string, string> => {
    return {
      ...(process.env as Record<string, string>),
    };
  },
};

// Result extraction is done inline in the AGENTS registry.
