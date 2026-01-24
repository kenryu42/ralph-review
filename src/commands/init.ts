/**
 * Init command for ralph-review
 * Sets up the configuration by prompting user for agent selection
 */

import * as readline from "readline";
import type { Config, AgentType } from "../lib/types";
import { isAgentType } from "../lib/types";
import {
  saveConfig,
  configExists,
  ensureConfigDir,
  CONFIG_PATH,
  DEFAULT_CONFIG,
} from "../lib/config";

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
    implementor: {
      agent: input.implementorAgent as AgentType,
      model: input.implementorModel || undefined,
    },
    maxIterations: DEFAULT_CONFIG.maxIterations!,
    iterationTimeout: DEFAULT_CONFIG.iterationTimeout!,
  };
}

/**
 * Prompt for a single line of input
 */
async function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
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
 * Main init command handler
 */
export async function runInit(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log("\n🔧 ralph-review configuration\n");

    // Check if config already exists
    if (await configExists()) {
      const overwrite = await prompt(
        rl,
        "Configuration already exists. Overwrite? (y/N): "
      );
      if (overwrite.toLowerCase() !== "y") {
        console.log("Aborted.");
        return;
      }
    }

    // Check tmux
    if (!checkTmuxInstalled()) {
      console.log("⚠️  Warning: tmux is not installed.");
      console.log("   Install with: brew install tmux");
      console.log("   (Required for background review sessions)\n");
    }

    // Prompt for reviewer agent
    let reviewerAgent: string;
    while (true) {
      reviewerAgent = await prompt(
        rl,
        "Select reviewer agent (codex/claude/opencode): "
      );
      if (validateAgentSelection(reviewerAgent)) {
        break;
      }
      console.log("Invalid selection. Please enter codex, claude, or opencode.");
    }

    // Check if reviewer agent is installed
    const reviewerCmd = getAgentCommand(reviewerAgent as AgentType);
    if (!checkAgentInstalled(reviewerCmd)) {
      console.log(`⚠️  Warning: ${reviewerCmd} is not installed.`);
    }

    // Prompt for reviewer model (optional)
    const reviewerModel = await prompt(
      rl,
      "Reviewer model (optional, press enter for default): "
    );

    // Prompt for implementor agent
    let implementorAgent: string;
    while (true) {
      implementorAgent = await prompt(
        rl,
        "Select implementor agent (codex/claude/opencode): "
      );
      if (validateAgentSelection(implementorAgent)) {
        break;
      }
      console.log("Invalid selection. Please enter codex, claude, or opencode.");
    }

    // Check if implementor agent is installed
    const implementorCmd = getAgentCommand(implementorAgent as AgentType);
    if (!checkAgentInstalled(implementorCmd)) {
      console.log(`⚠️  Warning: ${implementorCmd} is not installed.`);
    }

    // Prompt for implementor model (optional)
    const implementorModel = await prompt(
      rl,
      "Implementor model (optional, press enter for default): "
    );

    // Build and save config
    const config = buildConfig({
      reviewerAgent,
      reviewerModel,
      implementorAgent,
      implementorModel,
    });

    await ensureConfigDir();
    await saveConfig(config);

    console.log(`\n✅ Configuration saved to ${CONFIG_PATH}`);
    console.log("\nYou can now run: rr run");
  } finally {
    rl.close();
  }
}
