/**
 * Agent registry and runner for ralph-review
 * Defines how to invoke each supported AI coding agent
 */

import type { AgentConfig, AgentRole, AgentType, Config, IterationResult } from "@/lib/types";
import { formatClaudeEventForDisplay, parseClaudeStreamEvent } from "./claude-stream";

/**
 * Stream output to console while capturing it for parsing
 * For Claude agent, parses JSONL and formats for readable display
 * @param stream - The readable stream from process stdout/stderr
 * @param writeStream - Where to write the output (process.stdout or process.stderr)
 * @param agentType - The type of agent (used for Claude-specific formatting)
 * @returns The accumulated output as a string
 */
async function streamAndCapture(
  stream: ReadableStream<Uint8Array> | null,
  writeStream: NodeJS.WriteStream,
  agentType?: AgentType
): Promise<string> {
  if (!stream) return "";

  const decoder = new TextDecoder();
  let output = "";
  let lineBuffer = "";

  for await (const chunk of stream) {
    const text = decoder.decode(chunk, { stream: true });
    output += text;

    if (agentType === "claude") {
      // Buffer and process complete lines for Claude JSONL
      lineBuffer += text;
      const lines = lineBuffer.split("\n");

      // Keep the last incomplete line in the buffer
      lineBuffer = lines.pop() ?? "";

      // Process complete lines
      for (const line of lines) {
        if (!line.trim()) continue;

        const event = parseClaudeStreamEvent(line);
        if (event) {
          const formatted = formatClaudeEventForDisplay(event);
          if (formatted) {
            writeStream.write(`${formatted}

`);
          }
        } else {
          // Preserve non-JSON output (warnings/errors) for observability
          writeStream.write(`${line}\n`);
        }
      }
    } else {
      writeStream.write(text);
    }
  }

  // Flush any remaining bytes
  const remaining = decoder.decode();
  if (remaining) {
    output += remaining;
  }

  if (agentType === "claude") {
    if (remaining) {
      lineBuffer += remaining;
    }
    // Process any remaining line, even without a trailing newline
    if (lineBuffer.trim()) {
      const event = parseClaudeStreamEvent(lineBuffer);
      if (event) {
        const formatted = formatClaudeEventForDisplay(event);
        if (formatted) {
          writeStream.write(`${formatted}

`);
        }
      } else {
        writeStream.write(`${lineBuffer}\n`);
      }
    }
  } else if (remaining) {
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
        const args = ["exec", "--full-auto"];
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
          "--dangerously-skip-permissions",
          "--verbose",
          "--output-format",
          "stream-json",
        ];
      } else {
        // Fixer mode
        return [
          "-p",
          prompt,
          "--dangerously-skip-permissions",
          "--verbose",
          "--output-format",
          "stream-json",
        ];
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
      streamAndCapture(proc.stdout, process.stdout, agentSettings.agent),
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
