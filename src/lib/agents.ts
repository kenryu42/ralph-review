/**
 * Agent registry and runner for ralph-review
 * Defines how to invoke each supported AI coding agent
 */

import type { AgentType, AgentRole, AgentConfig, Config, IterationResult } from "./types";

/**
 * Registry of supported agents with their configuration
 */
export const AGENTS: Record<AgentType, AgentConfig> = {
  codex: {
    command: "codex",
    buildArgs: (role: AgentRole, prompt: string, model?: string): string[] => {
      if (role === "reviewer") {
        return ["review", "--uncommitted"];
      } else {
        // Implementor mode - use exec with the prompt
        const args = ["exec"];
        if (prompt) {
          args.push(prompt);
        }
        return args;
      }
    },
    buildEnv: (): Record<string, string> => {
      return {
        ...process.env as Record<string, string>,
      };
    },
    parseOutput: (line: string): { hasIssues: boolean } | null => {
      // Check for common "no issues" patterns
      const cleanPatterns = [
        /no issues found/i,
        /no problems detected/i,
        /all checks passed/i,
        /lgtm/i,
        /looks good/i,
      ];
      
      for (const pattern of cleanPatterns) {
        if (pattern.test(line)) {
          return { hasIssues: false };
        }
      }
      
      return null; // No determination yet
    },
  },

  claude: {
    command: "claude",
    buildArgs: (role: AgentRole, prompt: string, model?: string): string[] => {
      if (role === "reviewer") {
        return ["-p", "Review my uncommitted changes. Focus on bugs, security issues, and code quality problems."];
      } else {
        // Implementor mode
        return ["-p", prompt];
      }
    },
    buildEnv: (): Record<string, string> => {
      return {
        ...process.env as Record<string, string>,
      };
    },
    parseOutput: (line: string): { hasIssues: boolean } | null => {
      const cleanPatterns = [
        /no issues found/i,
        /no problems detected/i,
        /all checks passed/i,
        /lgtm/i,
        /looks good/i,
        /no changes needed/i,
      ];
      
      for (const pattern of cleanPatterns) {
        if (pattern.test(line)) {
          return { hasIssues: false };
        }
      }
      
      return null;
    },
  },

  opencode: {
    command: "opencode",
    buildArgs: (role: AgentRole, prompt: string, model?: string): string[] => {
      if (role === "reviewer") {
        return ["run", "/codex-review"];
      } else {
        // Implementor mode
        return ["run", prompt];
      }
    },
    buildEnv: (): Record<string, string> => {
      return {
        ...process.env as Record<string, string>,
      };
    },
    parseOutput: (line: string): { hasIssues: boolean } | null => {
      const cleanPatterns = [
        /no issues found/i,
        /no problems detected/i,
        /all checks passed/i,
        /lgtm/i,
        /looks good/i,
      ];
      
      for (const pattern of cleanPatterns) {
        if (pattern.test(line)) {
          return { hasIssues: false };
        }
      }
      
      return null;
    },
  },
};

/**
 * Run an agent and capture its output
 */
export async function runAgent(
  role: AgentRole,
  config: Config,
  prompt: string = "",
  timeout: number = config.iterationTimeout
): Promise<IterationResult> {
  const startTime = Date.now();
  const agentSettings = role === "reviewer" ? config.reviewer : config.implementor;
  const agentConfig = AGENTS[agentSettings.agent];
  
  const command = agentConfig.command;
  const args = agentConfig.buildArgs(role, prompt, agentSettings.model);
  const env = agentConfig.buildEnv();
  
  let output = "";
  let hasIssues = true; // Assume issues until proven otherwise
  let exitCode = 1;
  let timedOut = false;
  
  try {
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      timedOut = true;
    }, timeout);
    
    const proc = Bun.spawn([command, ...args], {
      env,
      stdout: "pipe",
      stderr: "pipe",
      signal: controller.signal,
    });
    
    // Read stdout and stderr using Bun's text() method
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    
    output = stdout + (stderr ? `\n[stderr]\n${stderr}` : "");
    
    // Wait for process to exit
    exitCode = await proc.exited;
    
    clearTimeout(timeoutId);
    
    // Parse output to detect if there are issues
    const lines = output.split("\n");
    for (const line of lines) {
      const result = agentConfig.parseOutput(line);
      if (result !== null) {
        hasIssues = result.hasIssues;
        break;
      }
    }
    
  } catch (error) {
    if (timedOut) {
      output = `[Timeout after ${timeout}ms]\n${output}`;
      exitCode = 124; // Standard timeout exit code
    } else {
      output = `[Error: ${error}]\n${output}`;
    }
  }
  
  const duration = Date.now() - startTime;
  
  return {
    success: exitCode === 0,
    hasIssues,
    output,
    exitCode,
    duration,
  };
}

/**
 * Check if an agent is available on the system
 */
export function isAgentAvailable(agentType: AgentType): boolean {
  const command = AGENTS[agentType].command;
  return Bun.which(command) !== null;
}
