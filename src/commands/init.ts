import * as p from "@clack/prompts";
import {
  agentOptions,
  claudeModelOptions,
  codexModelOptions,
  droidModelOptions,
  geminiModelOptions,
  getAgentDisplayName,
  getModelDisplayName,
  getReasoningOptions,
} from "@/lib/agents/models";
import {
  CONFIG_PATH,
  configExists,
  DEFAULT_CONFIG,
  ensureConfigDir,
  loadConfig,
  saveConfig,
} from "@/lib/config";
import type { AgentSettings, AgentType, Config, DefaultReview, ReasoningLevel } from "@/lib/types";
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

export function checkAllAgents(): AgentAvailability {
  return {
    codex: Bun.which("codex") !== null,
    opencode: Bun.which("opencode") !== null,
    claude: Bun.which("claude") !== null,
    droid: Bun.which("droid") !== null,
    gemini: Bun.which("gemini") !== null,
    pi: Bun.which("pi") !== null,
  };
}

interface InitInput {
  reviewerAgent: string;
  reviewerModel: string;
  reviewerProvider?: string;
  reviewerReasoning?: ReasoningLevel;
  fixerAgent: string;
  fixerModel: string;
  fixerProvider?: string;
  fixerReasoning?: ReasoningLevel;
  maxIterations: number;
  iterationTimeoutMinutes: number;
  defaultReviewType: string;
  defaultReviewBranch?: string;
}

function createAgentSettings(
  agent: string,
  model: string,
  provider?: string,
  reasoning?: ReasoningLevel
): AgentSettings {
  if (agent === "pi") {
    if (!provider || !model) {
      throw new Error("Pi agent requires provider and model");
    }
    return { agent: "pi", provider, model, reasoning };
  }

  return {
    agent: agent as Exclude<AgentType, "pi">,
    model: model || undefined,
    reasoning,
  };
}

export function buildConfig(input: InitInput): Config {
  const defaultReview: DefaultReview =
    input.defaultReviewType === "base" && input.defaultReviewBranch
      ? { type: "base", branch: input.defaultReviewBranch }
      : { type: "uncommitted" };

  return {
    reviewer: createAgentSettings(
      input.reviewerAgent,
      input.reviewerModel,
      input.reviewerProvider,
      input.reviewerReasoning
    ),
    fixer: createAgentSettings(
      input.fixerAgent,
      input.fixerModel,
      input.fixerProvider,
      input.fixerReasoning
    ),
    maxIterations: input.maxIterations,
    iterationTimeout: input.iterationTimeoutMinutes * 60 * 1000,
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
let cachedPiModels: { provider: string; model: string }[] | null = null;

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

export function parsePiListModelsOutput(output: string): { provider: string; model: string }[] {
  const models: { provider: string; model: string }[] = [];
  const seen = new Set<string>();

  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (line.startsWith("provider") && line.includes("model")) {
      continue;
    }

    const columns = line.split(/\s+/);
    if (columns.length < 2) {
      continue;
    }

    const provider = columns[0]?.trim();
    const model = columns[1]?.trim();
    if (!provider || !model) {
      continue;
    }

    const key = `${provider}\u0000${model}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    models.push({ provider, model });
  }

  return models;
}

async function fetchPiModels(): Promise<{ provider: string; model: string }[]> {
  if (cachedPiModels) {
    return cachedPiModels;
  }

  const proc = Bun.spawn(["pi", "--list-models"], {
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
    throw new Error(`Failed to fetch Pi models: ${errMsg}`);
  }

  cachedPiModels = parsePiListModelsOutput(stdout);
  return cachedPiModels;
}

function handleCancel(value: unknown): asserts value is string {
  if (p.isCancel(value)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }
}

const modelOptionsMap: Record<string, readonly { value: string; label: string }[]> = {
  claude: claudeModelOptions,
  codex: codexModelOptions,
  droid: droidModelOptions,
  gemini: geminiModelOptions,
};

interface ModelSelection {
  model: string;
  provider?: string;
}

function selectReasoningInitialValue(levels: ReasoningLevel[]): ReasoningLevel {
  return levels.includes("high") ? "high" : (levels[0] ?? "high");
}

async function promptForReasoning(
  agent: string,
  model: string,
  role: "reviewer" | "fixer"
): Promise<ReasoningLevel | undefined> {
  if (!isAgentType(agent)) {
    return undefined;
  }

  const levels = getReasoningOptions(agent, model);
  if (levels.length === 0) {
    return undefined;
  }

  const reasoning = await p.select({
    message: `Select ${role} reasoning level`,
    options: levels.map((level) => ({
      value: level,
      label: level,
      hint: level === "high" ? "recommended" : undefined,
    })),
    initialValue: selectReasoningInitialValue(levels),
  });
  handleCancel(reasoning);

  return reasoning as ReasoningLevel;
}

function encodePiSelection(selection: { provider: string; model: string }): string {
  return JSON.stringify(selection);
}

function decodePiSelection(value: string): { provider: string; model: string } | null {
  try {
    const parsed = JSON.parse(value) as { provider?: unknown; model?: unknown };
    if (typeof parsed.provider !== "string" || typeof parsed.model !== "string") {
      return null;
    }
    if (!parsed.provider.trim() || !parsed.model.trim()) {
      return null;
    }
    return { provider: parsed.provider, model: parsed.model };
  } catch {
    return null;
  }
}

async function promptForModel(agent: string, role: "reviewer" | "fixer"): Promise<ModelSelection> {
  const staticOptions = modelOptionsMap[agent];

  if (staticOptions) {
    const model = await p.select({
      message: `Select ${role} model`,
      options: [...staticOptions],
    });
    handleCancel(model);
    return { model: model as string };
  }

  if (agent === "opencode") {
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

    const model = await p.select({
      message: `Select ${role} model`,
      options: opencodeModels,
    });
    handleCancel(model);
    return { model: model as string };
  }

  if (agent === "pi") {
    let piModels: { provider: string; model: string }[];

    if (cachedPiModels) {
      piModels = cachedPiModels;
    } else {
      const spinner = p.spinner();
      spinner.start("Fetching available models...");
      try {
        piModels = await fetchPiModels();
      } catch (error) {
        spinner.stop("Failed to load models");
        p.log.error(`${error}`);
        process.exit(1);
      }
      spinner.stop("Models loaded");
    }

    if (!piModels || piModels.length === 0) {
      p.log.error("No models available from Pi");
      process.exit(1);
    }

    const piOptions = piModels.map((entry) => ({
      value: encodePiSelection(entry),
      label: entry.model,
      hint: entry.provider,
    }));

    const rawSelection = await p.select({
      message: `Select ${role} model`,
      options: piOptions,
    });
    handleCancel(rawSelection);

    const selection = decodePiSelection(rawSelection as string);
    if (!selection) {
      p.log.error("Invalid Pi model selection");
      process.exit(1);
    }

    return selection;
  }

  const model = await p.text({
    message: `${role.charAt(0).toUpperCase() + role.slice(1)} model (optional)`,
    placeholder: "Press enter for default",
    defaultValue: "",
  });
  handleCancel(model);
  return { model: model as string };
}

function formatConfigDisplay(config: Config): string {
  const reviewerName = getAgentDisplayName(config.reviewer.agent);
  const fixerName = getAgentDisplayName(config.fixer.agent);

  const reviewerModel =
    config.reviewer.agent === "pi"
      ? `${config.reviewer.provider}/${config.reviewer.model}`
      : config.reviewer.model
        ? getModelDisplayName(config.reviewer.agent, config.reviewer.model)
        : "Default";
  const fixerModel =
    config.fixer.agent === "pi"
      ? `${config.fixer.provider}/${config.fixer.model}`
      : config.fixer.model
        ? getModelDisplayName(config.fixer.agent, config.fixer.model)
        : "Default";

  const defaultReviewDisplay =
    config.defaultReview.type === "base"
      ? `base branch (${config.defaultReview.branch})`
      : "uncommitted changes";
  const reviewerReasoning = config.reviewer.reasoning ?? "Default";
  const fixerReasoning = config.fixer.reasoning ?? "Default";

  return [
    `  Reviewer:            ${reviewerName}`,
    `  Reviewer model:      ${reviewerModel}, ${reviewerReasoning}`,
    `  Fixer:               ${fixerName}`,
    `  Fixer model:         ${fixerModel}, ${fixerReasoning}`,
    `  Max iterations:      ${config.maxIterations}`,
    `  Iteration timeout:   ${config.iterationTimeout / 1000 / 60} minutes`,
    `  Default review:      ${defaultReviewDisplay}`,
  ].join("\n");
}

export async function runInit(): Promise<void> {
  p.intro("Ralph Review Setup");

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

  if (!checkTmuxInstalled()) {
    p.log.warn(
      "tmux is not installed.\n" +
        "   Install with: brew install tmux\n" +
        "   (Required for background review sessions)"
    );
  }

  const agentAvailability = checkAllAgents();
  const availableCount = Object.values(agentAvailability).filter(Boolean).length;

  if (availableCount === 0) {
    p.log.error(
      "No supported agents are installed.\n" +
        "   Install at least one of: codex, claude, opencode, droid, gemini, pi"
    );
    process.exit(1);
  }

  const selectOptions = buildAgentSelectOptions(agentAvailability);

  const reviewerAgent = await p.select({
    message: "Select reviewer agent",
    options: selectOptions,
  });

  handleCancel(reviewerAgent);

  const reviewerSelection = await promptForModel(reviewerAgent as string, "reviewer");
  const reviewerReasoning = await promptForReasoning(
    reviewerAgent as string,
    reviewerSelection.model,
    "reviewer"
  );

  const fixerAgent = await p.select({
    message: "Select fixer agent",
    options: selectOptions,
  });

  handleCancel(fixerAgent);

  const fixerSelection = await promptForModel(fixerAgent as string, "fixer");
  const fixerReasoning = await promptForReasoning(
    fixerAgent as string,
    fixerSelection.model,
    "fixer"
  );

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

  const config = buildConfig({
    reviewerAgent: reviewerAgent as string,
    reviewerModel: reviewerSelection.model,
    reviewerProvider: reviewerSelection.provider,
    reviewerReasoning,
    fixerAgent: fixerAgent as string,
    fixerModel: fixerSelection.model,
    fixerProvider: fixerSelection.provider,
    fixerReasoning,
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
