/** Interactive setup for reviewer/fixer agents and iteration limits */

import * as p from "@clack/prompts";
import {
  agentOptions,
  claudeModelOptions,
  codexModelOptions,
  droidModelOptions,
  geminiModelOptions,
  getAgentDisplayName,
  getModelDisplayName,
} from "@/lib/agents/display";
import {
  CONFIG_PATH,
  configExists,
  DEFAULT_CONFIG,
  ensureConfigDir,
  loadConfig,
  saveConfig,
} from "@/lib/config";
import type { AgentType, Config, DefaultReview } from "@/lib/types";
import { isAgentType } from "@/lib/types";

export type AgentAvailability = Record<AgentType, boolean>;

export function validateAgentSelection(value: string): boolean {
  return isAgentType(value);
}

export function checkAgentInstalled(command: string): boolean {
  return Bun.which(command) !== null;
}

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

interface InitInput {
  reviewerAgent: string;
  reviewerModel: string;
  fixerAgent: string;
  fixerModel: string;
  maxIterations: number;
  iterationTimeoutMinutes: number;
  defaultReviewType: string;
  defaultReviewBranch?: string;
}

export function buildConfig(input: InitInput): Config {
  const defaultReview: DefaultReview =
    input.defaultReviewType === "base" && input.defaultReviewBranch
      ? { type: "base", branch: input.defaultReviewBranch }
      : { type: "uncommitted" };

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
    defaultReview,
  };
}

function buildAgentSelectOptions(availability: AgentAvailability) {
  return agentOptions.map((opt) => ({
    value: opt.value,
    label: opt.label,
    hint: availability[opt.value] ? opt.hint : `${opt.hint} - not installed`,
    disabled: !availability[opt.value],
  }));
}

let cachedOpencodeModels: { value: string; label: string }[] | null = null;

/** Fetch models from `opencode models`, ignoring INFO lines. Results cached. */
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

function handleCancel(value: unknown): asserts value is string {
  if (p.isCancel(value)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }
}

function formatConfigDisplay(config: Config): string {
  const reviewerName = getAgentDisplayName(config.reviewer.agent);
  const fixerName = getAgentDisplayName(config.fixer.agent);

  const reviewerModel = config.reviewer.model
    ? ` (${getModelDisplayName(config.reviewer.agent, config.reviewer.model)})`
    : "";
  const fixerModel = config.fixer.model
    ? ` (${getModelDisplayName(config.fixer.agent, config.fixer.model)})`
    : "";

  const defaultReviewDisplay =
    config.defaultReview.type === "base"
      ? `base branch (${config.defaultReview.branch})`
      : "uncommitted changes";

  return [
    `  Reviewer:          ${reviewerName}${reviewerModel}`,
    `  Fixer:             ${fixerName}${fixerModel}`,
    `  Max iterations:    ${config.maxIterations}`,
    `  Iteration timeout: ${config.iterationTimeout / 1000 / 60} minutes`,
    `  Default review:    ${defaultReviewDisplay}`,
  ].join("\n");
}

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
        "   Install at least one of: codex, claude, opencode, droid, gemini"
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

  // Prompt for default review mode
  const defaultReviewType = await p.select({
    message: "Default review mode for 'rr run'",
    options: [
      { value: "uncommitted", label: "Uncommitted changes", hint: "staged, unstaged, untracked" },
      { value: "base", label: "Compare against base branch" },
    ],
    initialValue: "uncommitted",
  });

  handleCancel(defaultReviewType);

  let defaultReviewBranch: string | undefined;
  if (defaultReviewType === "base") {
    defaultReviewBranch = (await p.text({
      message: "Base branch name",
      placeholder: "main",
      defaultValue: "main",
      validate: (value) => {
        if (!value || value.trim() === "") {
          return "Branch name is required";
        }
      },
    })) as string;
    handleCancel(defaultReviewBranch);
  }

  // Build and save config
  const config = buildConfig({
    reviewerAgent: reviewerAgent as string,
    reviewerModel: reviewerModel as string,
    fixerAgent: fixerAgent as string,
    fixerModel: fixerModel as string,
    maxIterations: Number.parseInt(maxIterationsStr as string, 10),
    iterationTimeoutMinutes: Number.parseInt(iterationTimeoutStr as string, 10),
    defaultReviewType: defaultReviewType as string,
    defaultReviewBranch: defaultReviewBranch as string | undefined,
  });

  await ensureConfigDir();
  await saveConfig(config);

  p.log.success(`Configuration saved to ${CONFIG_PATH}`);
  p.outro("You can now run: rr run");
}
