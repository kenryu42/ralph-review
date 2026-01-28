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
 * Agent availability map
 */
export type AgentAvailability = Record<AgentType, boolean>;

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
 * Check availability of all supported agents
 * Uses Bun.which() which is synchronous and fast (PATH lookup)
 */
export function checkAllAgents(): AgentAvailability {
  return {
    codex: Bun.which("codex") !== null,
    opencode: Bun.which("opencode") !== null,
    claude: Bun.which("claude") !== null,
    droid: Bun.which("droid") !== null,
    gemini: Bun.which("gemini") !== null,
  };
}

/**
 * User input collected during init
 */
interface InitInput {
  reviewerAgent: string;
  reviewerModel: string;
  fixerAgent: string;
  fixerModel: string;
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
      agent: input.fixerAgent as AgentType,
      model: input.fixerModel || undefined,
    },
    maxIterations: input.maxIterations,
    iterationTimeout: input.iterationTimeoutMinutes * 60 * 1000, // convert to ms
  };
}

/**
 * Agent options for select prompts
 */
const agentOptions = [
  { value: "claude", label: "Claude", hint: "Anthropic" },
  { value: "codex", label: "Codex", hint: "OpenAI" },
  { value: "droid", label: "Droid", hint: "Factory" },
  { value: "gemini", label: "Gemini", hint: "Google" },
  { value: "opencode", label: "OpenCode", hint: "Anomaly" },
] as const;

/**
 * Build agent options with disabled state for unavailable agents
 */
function buildAgentSelectOptions(availability: AgentAvailability) {
  return agentOptions.map((opt) => ({
    value: opt.value,
    label: opt.label,
    hint: availability[opt.value] ? opt.hint : `${opt.hint} - not installed`,
    disabled: !availability[opt.value],
  }));
}

const claudeModelOptions = [
  { value: "opus", label: "Claude Opus 4.5" },
  { value: "sonnet", label: "Claude Sonnet 4.5" },
  { value: "haiku", label: "Claude Haiku 4.5" },
] as const;

const codexModelOptions = [
  { value: "gpt-5.2-codex", label: "GPT-5.2 Codex" },
  { value: "gpt-5.2", label: "GPT-5.2" },
  { value: "gpt-5.1-codex-max", label: "GPT-5.1 Codex Max" },
  { value: "gpt-5.1-codex-mini", label: "GPT-5.1 Codex Mini" },
] as const;

const droidModelOptions = [
  { value: "gpt-5.1", label: "GPT-5.1" },
  { value: "gpt-5.1-codex", label: "GPT-5.1 Codex" },
  { value: "gpt-5.1-codex-max", label: "GPT-5.1 Codex Max" },
  { value: "gpt-5.2", label: "GPT-5.2" },
  { value: "gpt-5.2-codex", label: "GPT-5.2 Codex" },
  { value: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
  { value: "claude-opus-4-5-20251101", label: "Claude Opus 4.5" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  { value: "gemini-3-pro-preview", label: "Gemini 3 Pro" },
  { value: "gemini-3-flash-preview", label: "Gemini 3 Flash" },
  { value: "glm-4.7", label: "Droid Core (GLM-4.7)" },
] as const;

const geminiModelOptions = [
  { value: "gemini-3-pro-preview", label: "Gemini 3 Pro" },
  { value: "gemini-3-flash-preview", label: "Gemini 3 Flash" },
] as const;

/**
 * Cached OpenCode models to avoid fetching multiple times
 */
let cachedOpencodeModels: { value: string; label: string }[] | null = null;

/**
 * Fetch available models from OpenCode CLI
 * Runs `opencode models` and parses the output, ignoring INFO lines
 * Results are cached to avoid redundant fetches
 */
async function fetchOpencodeModels(): Promise<{ value: string; label: string }[]> {
  if (cachedOpencodeModels) {
    return cachedOpencodeModels;
  }

  const proc = Bun.spawn(["opencode", "models"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const errMsg = stderr.trim() || `exit code ${exitCode}`;
    throw new Error(`Failed to fetch OpenCode models: ${errMsg}`);
  }

  const models = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("INFO"));

  cachedOpencodeModels = models.map((model) => ({ value: model, label: model }));
  return cachedOpencodeModels;
}

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
 * Get display name for an agent type
 */
export function getAgentDisplayName(agent: AgentType): string {
  const option = agentOptions.find((opt) => opt.value === agent);
  return option?.label ?? agent;
}

/**
 * Get display name for a model
 */
export function getModelDisplayName(agent: AgentType, model: string): string {
  let options: readonly { value: string; label: string }[];

  switch (agent) {
    case "claude":
      options = claudeModelOptions;
      break;
    case "codex":
      options = codexModelOptions;
      break;
    case "droid":
      options = droidModelOptions;
      break;
    case "gemini":
      options = geminiModelOptions;
      break;
    case "opencode":
      // OpenCode models use the same value for label
      return model;
  }

  const option = options.find((opt) => opt.value === model);
  return option?.label ?? model;
}

/**
 * Format config for display
 */
function formatConfigDisplay(config: Config): string {
  const reviewerName = getAgentDisplayName(config.reviewer.agent);
  const fixerName = getAgentDisplayName(config.fixer.agent);

  const reviewerModel = config.reviewer.model
    ? ` (${getModelDisplayName(config.reviewer.agent, config.reviewer.model)})`
    : "";
  const fixerModel = config.fixer.model
    ? ` (${getModelDisplayName(config.fixer.agent, config.fixer.model)})`
    : "";

  return [
    `  Reviewer:          ${reviewerName}${reviewerModel}`,
    `  Fixer:             ${fixerName}${fixerModel}`,
    `  Max iterations:    ${config.maxIterations}`,
    `  Iteration timeout: ${config.iterationTimeout / 1000 / 60} minutes`,
  ].join("\n");
}

/**
 * Main init command handler
 */
export async function runInit(): Promise<void> {
  p.intro("Ralph Review Setup");

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

  // Check all agents upfront
  const agentAvailability = checkAllAgents();
  const availableCount = Object.values(agentAvailability).filter(Boolean).length;

  if (availableCount === 0) {
    p.log.error(
      "No supported agents are installed.\n" +
        "   Install at least one of: codex, claude, opencode, droid"
    );
    process.exit(1);
  }

  const selectOptions = buildAgentSelectOptions(agentAvailability);

  // Prompt for reviewer agent
  const reviewerAgent = await p.select({
    message: "Select reviewer agent",
    options: selectOptions,
  });

  handleCancel(reviewerAgent);

  // Prompt for reviewer model
  let reviewerModel: string | symbol;
  if (reviewerAgent === "claude") {
    reviewerModel = await p.select({
      message: "Select reviewer model",
      options: [...claudeModelOptions],
    });
  } else if (reviewerAgent === "codex") {
    reviewerModel = await p.select({
      message: "Select reviewer model",
      options: [...codexModelOptions],
    });
  } else if (reviewerAgent === "droid") {
    reviewerModel = await p.select({
      message: "Select reviewer model",
      options: [...droidModelOptions],
    });
  } else if (reviewerAgent === "gemini") {
    reviewerModel = await p.select({
      message: "Select reviewer model",
      options: [...geminiModelOptions],
    });
  } else if (reviewerAgent === "opencode") {
    let opencodeModels: { value: string; label: string }[];
    if (cachedOpencodeModels) {
      opencodeModels = cachedOpencodeModels;
    } else {
      const spinner = p.spinner();
      spinner.start("Fetching available models...");
      opencodeModels = await fetchOpencodeModels();
      spinner.stop("Models loaded");
    }

    if (opencodeModels.length === 0) {
      p.log.error("No models available from OpenCode");
      process.exit(1);
    }

    reviewerModel = await p.select({
      message: "Select reviewer model",
      options: opencodeModels,
    });
  } else {
    reviewerModel = await p.text({
      message: "Reviewer model (optional)",
      placeholder: "Press enter for default",
      defaultValue: "",
    });
  }

  handleCancel(reviewerModel);

  // Prompt for fixer agent
  const fixerAgent = await p.select({
    message: "Select fixer agent",
    options: selectOptions,
  });

  handleCancel(fixerAgent);

  // Prompt for fixer model
  let fixerModel: string | symbol;
  if (fixerAgent === "claude") {
    fixerModel = await p.select({
      message: "Select fixer model",
      options: [...claudeModelOptions],
    });
  } else if (fixerAgent === "codex") {
    fixerModel = await p.select({
      message: "Select fixer model",
      options: [...codexModelOptions],
    });
  } else if (fixerAgent === "droid") {
    fixerModel = await p.select({
      message: "Select fixer model",
      options: [...droidModelOptions],
    });
  } else if (fixerAgent === "gemini") {
    fixerModel = await p.select({
      message: "Select fixer model",
      options: [...geminiModelOptions],
    });
  } else if (fixerAgent === "opencode") {
    let opencodeModels: { value: string; label: string }[];
    if (cachedOpencodeModels) {
      opencodeModels = cachedOpencodeModels;
    } else {
      const spinner = p.spinner();
      spinner.start("Fetching available models...");
      opencodeModels = await fetchOpencodeModels();
      spinner.stop("Models loaded");
    }

    if (opencodeModels.length === 0) {
      p.log.error("No models available from OpenCode");
      process.exit(1);
    }

    fixerModel = await p.select({
      message: "Select fixer model",
      options: opencodeModels,
    });
  } else {
    fixerModel = await p.text({
      message: "Fixer model (optional)",
      placeholder: "Press enter for default",
      defaultValue: "",
    });
  }

  handleCancel(fixerModel);

  // Prompt for max iterations
  const maxIterationsStr = await p.text({
    message: `Maximum iterations (default: ${DEFAULT_CONFIG.maxIterations ?? 5})`,
    placeholder: "Press enter for default",
    defaultValue: String(DEFAULT_CONFIG.maxIterations ?? 5),
    validate: (value) => {
      if (!value || value === "") return; // allow empty for default
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
      if (!value || value === "") return; // allow empty for default
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
    fixerAgent: fixerAgent as string,
    fixerModel: fixerModel as string,
    maxIterations: Number.parseInt(maxIterationsStr as string, 10),
    iterationTimeoutMinutes: Number.parseInt(iterationTimeoutStr as string, 10),
  });

  await ensureConfigDir();
  await saveConfig(config);

  p.log.success(`Configuration saved to ${CONFIG_PATH}`);
  p.outro("You can now run: rr run");
}
