/**
 * Agent registry and runner for ralph-review
 * Defines how to invoke each supported AI coding agent
 */

import type { AgentConfig, AgentRole, AgentType, Config, IterationResult } from "./types";

/**
 * Stream output to console while capturing it for parsing
 * @param stream - The readable stream from process stdout/stderr
 * @param writeStream - Where to write the output (process.stdout or process.stderr)
 * @returns The accumulated output as a string
 */
async function streamAndCapture(
  stream: ReadableStream<Uint8Array> | null,
  writeStream: NodeJS.WriteStream
): Promise<string> {
  if (!stream) return "";

  const decoder = new TextDecoder();
  let output = "";

  for await (const chunk of stream) {
    const text = decoder.decode(chunk, { stream: true });
    output += text;
    writeStream.write(text);
  }

  // Flush any remaining bytes
  const remaining = decoder.decode();
  if (remaining) {
    output += remaining;
    writeStream.write(remaining);
  }

  return output;
}

/**
 * Registry of supported agents with their configuration
 */
export const AGENTS: Record<AgentType, AgentConfig> = {
  codex: {
    command: "codex",
    buildArgs: (role: AgentRole, prompt: string, _model?: string): string[] => {
      if (role === "reviewer") {
        return ["review", "--uncommitted"];
      } else {
        // Fixer mode - use exec with the prompt
        const args = ["exec"];
        if (prompt) {
          args.push(prompt);
        }
        return args;
      }
    },
    buildEnv: (): Record<string, string> => {
      return {
        ...(process.env as Record<string, string>),
      };
    },
  },

  claude: {
    command: "claude",
    buildArgs: (role: AgentRole, prompt: string, _model?: string): string[] => {
      if (role === "reviewer") {
        return [
          "-p",
          "Review my uncommitted changes. Focus on bugs, security issues, and code quality problems.",
        ];
      } else {
        // Fixer mode
        return ["-p", prompt];
      }
    },
    buildEnv: (): Record<string, string> => {
      return {
        ...(process.env as Record<string, string>),
      };
    },
  },

  opencode: {
    command: "opencode",
    buildArgs: (role: AgentRole, prompt: string, _model?: string): string[] => {
      if (role === "reviewer") {
        return ["run", "/review"];
      } else {
        // Fixer mode
        return ["run", prompt];
      }
    },
    buildEnv: (): Record<string, string> => {
      return {
        ...(process.env as Record<string, string>),
      };
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
  const agentSettings = role === "reviewer" ? config.reviewer : config.fixer;
  const agentConfig = AGENTS[agentSettings.agent];

  const command = agentConfig.command;
  const args = agentConfig.buildArgs(role, prompt, agentSettings.model);
  const env = agentConfig.buildEnv();

  let output = "";
  const hasIssues = true; // Assume issues until proven otherwise
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

    // Stream output to console while capturing it
    const [stdout, stderr] = await Promise.all([
      streamAndCapture(proc.stdout, process.stdout),
      streamAndCapture(proc.stderr, process.stderr),
    ]);

    output = stdout + (stderr ? `\n[stderr]\n${stderr}` : "");

    // Wait for process to exit
    exitCode = await proc.exited;

    clearTimeout(timeoutId);
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
