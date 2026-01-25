/**
 * Init command for ralph-review
 * Sets up the configuration by prompting user for agent selection
 */

import * as p from "@clack/prompts";
import {
  CONFIG_PATH,
  configExists,
  DEFAULT_CONFIG,
  ensureConfigDir,
  loadConfig,
  saveConfig,
} from "@/lib/config";
import type { AgentType, Config } from "@/lib/types";
import { isAgentType } from "@/lib/types";

/**
 * Validate that a string is a valid agent type
 */
export function validateAgentSelection(value: string): boolean {
  return isAgentType(value);
}

/**
 * Check if a command is installed on the system
 */
export function checkAgentInstalled(command: string): boolean {
  return Bun.which(command) !== null;
}

/**
 * Check if tmux is installed
 */
export function checkTmuxInstalled(): boolean {
  return Bun.which("tmux") !== null;
}

/**
 * User input collected during init
 */
interface InitInput {
  reviewerAgent: string;
  reviewerModel: string;
  implementorAgent: string;
  implementorModel: string;
  maxIterations: number;
  iterationTimeoutMinutes: number;
}

/**
 * Build a Config object from user input
 */
export function buildConfig(input: InitInput): Config {
  return {
    reviewer: {
      agent: input.reviewerAgent as AgentType,
      model: input.reviewerModel || undefined,
    },
    fixer: {
      agent: input.implementorAgent as AgentType,
      model: input.implementorModel || undefined,
    },
    maxIterations: input.maxIterations,
    iterationTimeout: input.iterationTimeoutMinutes * 60 * 1000, // convert to ms
  };
}

/**
 * Get agent command name
 */
function getAgentCommand(agent: AgentType): string {
  switch (agent) {
    case "codex":
      return "codex";
    case "claude":
      return "claude";
    case "opencode":
      return "opencode";
  }
}

/**
 * Agent options for select prompts
 */
const agentOptions = [
  { value: "codex", label: "Codex", hint: "OpenAI Codex CLI" },
  { value: "claude", label: "Claude", hint: "Anthropic Claude Code" },
  { value: "opencode", label: "OpenCode", hint: "OpenCode AI" },
] as const;

/**
 * Check if user cancelled the prompt
 */
function handleCancel(value: unknown): asserts value is string {
  if (p.isCancel(value)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }
}

/**
 * Format config for display
 */
function formatConfigDisplay(config: Config): string {
  const reviewerModel = config.reviewer.model ? ` (${config.reviewer.model})` : "";
  const fixerModel = config.fixer.model ? ` (${config.fixer.model})` : "";

  return [
    `  Reviewer: ${config.reviewer.agent}${reviewerModel}`,
    `  Fixer:    ${config.fixer.agent}${fixerModel}`,
    `  Max iterations: ${config.maxIterations}`,
    `  Iteration timeout: ${config.iterationTimeout / 1000 / 60} minutes`,
  ].join("\n");
}

/**
 * Main init command handler
 */
export async function runInit(): Promise<void> {
  p.intro("ralph-review setup");

  // Check if config already exists
  if (await configExists()) {
    const existingConfig = await loadConfig();
    if (existingConfig) {
      p.log.info(`Current configuration:\n${formatConfigDisplay(existingConfig)}`);
    }

    const shouldOverwrite = await p.confirm({
      message: "Configuration already exists. Overwrite?",
      initialValue: false,
    });

    handleCancel(shouldOverwrite);

    if (!shouldOverwrite) {
      p.cancel("Setup cancelled.");
      return;
    }
  }

  // Check tmux
  if (!checkTmuxInstalled()) {
    p.log.warn(
      "tmux is not installed.\n" +
        "   Install with: brew install tmux\n" +
        "   (Required for background review sessions)"
    );
  }

  // Prompt for reviewer agent
  const reviewerAgent = await p.select({
    message: "Select reviewer agent",
    options: [...agentOptions],
  });

  handleCancel(reviewerAgent);

  // Check if reviewer agent is installed
  const reviewerCmd = getAgentCommand(reviewerAgent as AgentType);
  if (!checkAgentInstalled(reviewerCmd)) {
    p.log.warn(`${reviewerCmd} is not installed.`);
  }

  // Prompt for reviewer model (optional)
  const reviewerModel = await p.text({
    message: "Reviewer model (optional)",
    placeholder: "Press enter for default",
    defaultValue: "",
  });

  handleCancel(reviewerModel);

  // Prompt for fixer agent
  const implementorAgent = await p.select({
    message: "Select fixer agent",
    options: [...agentOptions],
  });

  handleCancel(implementorAgent);

  // Check if fixer agent is installed
  const implementorCmd = getAgentCommand(implementorAgent as AgentType);
  if (!checkAgentInstalled(implementorCmd)) {
    p.log.warn(`${implementorCmd} is not installed.`);
  }

  // Prompt for fixer model (optional)
  const implementorModel = await p.text({
    message: "Fixer model (optional)",
    placeholder: "Press enter for default",
    defaultValue: "",
  });

  handleCancel(implementorModel);

  // Prompt for max iterations
  const maxIterationsStr = await p.text({
    message: `Maximum iterations (default: ${DEFAULT_CONFIG.maxIterations ?? 5})`,
    placeholder: "Press enter for default",
    defaultValue: String(DEFAULT_CONFIG.maxIterations ?? 5),
    validate: (value) => {
      if (value === "") return; // allow empty for default
      const num = Number.parseInt(value, 10);
      if (Number.isNaN(num) || num < 1) {
        return "Must be a positive number";
      }
    },
  });

  handleCancel(maxIterationsStr);

  // Prompt for iteration timeout
  const defaultTimeoutMinutes = (DEFAULT_CONFIG.iterationTimeout ?? 1800000) / 1000 / 60;
  const iterationTimeoutStr = await p.text({
    message: `Timeout per iteration in minutes (default: ${defaultTimeoutMinutes})`,
    placeholder: "Press enter for default",
    defaultValue: String(defaultTimeoutMinutes),
    validate: (value) => {
      if (value === "") return; // allow empty for default
      const num = Number.parseInt(value, 10);
      if (Number.isNaN(num) || num < 1) {
        return "Must be a positive number";
      }
    },
  });

  handleCancel(iterationTimeoutStr);

  // Build and save config
  const config = buildConfig({
    reviewerAgent: reviewerAgent as string,
    reviewerModel: reviewerModel as string,
    implementorAgent: implementorAgent as string,
    implementorModel: implementorModel as string,
    maxIterations: Number.parseInt(maxIterationsStr as string, 10),
    iterationTimeoutMinutes: Number.parseInt(iterationTimeoutStr as string, 10),
  });

  await ensureConfigDir();
  await saveConfig(config);

  p.log.success(`Configuration saved to ${CONFIG_PATH}`);
  p.outro("You can now run: rr run");
}
