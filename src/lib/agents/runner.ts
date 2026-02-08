import type { AgentRole, Config, IterationResult, ReviewOptions } from "@/lib/types";
import { streamAndCapture } from "./core";
import { AGENTS } from "./registry";

export async function runAgent(
  role: AgentRole,
  config: Config,
  prompt: string = "",
  timeout: number = config.iterationTimeout,
  reviewOptions?: ReviewOptions
): Promise<IterationResult> {
  const startTime = Date.now();
  // Code simplifier intentionally reuses reviewer's agent+model settings.
  const agentSettings = role === "fixer" ? config.fixer : config.reviewer;
  const agentModule = AGENTS[agentSettings.agent];

  const command = agentModule.config.command;
  const args = agentModule.config.buildArgs(
    role,
    prompt,
    agentSettings.model,
    reviewOptions,
    agentSettings.agent === "pi" ? agentSettings.provider : undefined,
    agentSettings.reasoning
  );
  const env = agentModule.config.buildEnv();

  let output = "";
  let exitCode = 1;
  let timedOut = false;

  try {
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

    const [stdout, stderr] = await Promise.all([
      streamAndCapture(proc.stdout, process.stdout, agentModule.usesJsonl, agentModule.formatLine),
      streamAndCapture(proc.stderr, process.stderr),
    ]);

    output = stdout + (stderr ? `\n[stderr]\n${stderr}` : "");

    exitCode = await proc.exited;

    clearTimeout(timeoutId);
  } catch (error) {
    if (timedOut) {
      output = `[Timeout after ${timeout}ms]\n${output}`;
      exitCode = 124;
    } else {
      output = `[Error: ${error}]\n${output}`;
    }
  }

  const duration = Date.now() - startTime;

  return {
    success: exitCode === 0,
    output,
    exitCode,
    duration,
  };
}
