import * as p from "@clack/prompts";
import { isAgentAvailable } from "@/lib/agents";
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
import { type AgentCapabilitiesMap, discoverAgentCapabilities } from "@/lib/diagnostics";
import { getTmuxInstallHint } from "@/lib/diagnostics/tmux-install";
import {
  type AgentSettings,
  type AgentType,
  CONFIG_SCHEMA_URI,
  CONFIG_VERSION,
  type Config,
  type DefaultReview,
  isAgentType,
  type ReasoningLevel,
} from "@/lib/types";

export type AgentAvailability = Record<AgentType, boolean>;

type ConfiguredRole = "reviewer" | "fixer" | "code-simplifier";

interface InitInput {
  reviewerAgent: AgentType;
  reviewerModel: string;
  reviewerProvider?: string;
  reviewerReasoning?: ReasoningLevel;
  fixerAgent: AgentType;
  fixerModel: string;
  fixerProvider?: string;
  fixerReasoning?: ReasoningLevel;
  simplifierAgent: AgentType;
  simplifierModel: string;
  simplifierProvider?: string;
  simplifierReasoning?: ReasoningLevel;
  maxIterations: number;
  iterationTimeoutMinutes: number;
  defaultReviewType: "uncommitted" | "base";
  defaultReviewBranch?: string;
  runSimplifierByDefault: boolean;
  soundNotificationsEnabled: boolean;
}

interface ModelSelection {
  model: string;
  provider?: string;
}

interface RoleAgentSelection {
  agent: AgentType;
  model: string;
  provider?: string;
  reasoning?: ReasoningLevel;
}

export interface AutoModelCandidate {
  agent: AgentType;
  model: string;
  provider?: string;
  modelOrder: number;
  probeOrder: number;
}

export interface AutoSelectionDependencies {
  fetchOpencodeModels?: () => Promise<{ value: string; label: string }[]>;
  fetchPiModels?: () => Promise<{ provider: string; model: string }[]>;
  capabilitiesByAgent?: AgentCapabilitiesMap;
}

export interface AutoModelDiscoveryResult {
  candidates: AutoModelCandidate[];
  skippedAgents: AgentType[];
}

export interface AutoInitInputResult {
  input: InitInput;
  skippedAgents: AgentType[];
}

interface InitPromptLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  message(message: string): void;
  success(message: string): void;
}

interface InitPromptSpinner {
  start(message: string): void;
  stop(message: string): void;
}

interface InitSelectOption {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

interface InitSelectInput {
  message: string;
  options: InitSelectOption[];
  initialValue?: string;
}

interface InitConfirmInput {
  message: string;
  initialValue?: boolean;
}

interface InitTextInput {
  message: string;
  placeholder?: string;
  defaultValue?: string;
  validate?: (value: string | undefined) => string | Error | undefined;
}

interface InitPromptRuntime {
  intro(message: string): void;
  outro(message: string): void;
  cancel(message: string): void;
  isCancel(value: unknown): boolean;
  select(options: InitSelectInput): Promise<unknown>;
  confirm(options: InitConfirmInput): Promise<unknown>;
  text(options: InitTextInput): Promise<unknown>;
  spinner(): InitPromptSpinner;
  log: InitPromptLogger;
}

export interface InitRuntime {
  prompt: InitPromptRuntime;
  configExists: typeof configExists;
  loadConfig: typeof loadConfig;
  ensureConfigDir: typeof ensureConfigDir;
  saveConfig: typeof saveConfig;
  discoverAgentCapabilities: typeof discoverAgentCapabilities;
  checkTmuxInstalled: typeof checkTmuxInstalled;
  checkAllAgents: typeof checkAllAgents;
  getTmuxInstallHint: typeof getTmuxInstallHint;
  exit(code: number): never;
}

export interface InitRuntimeOverrides extends Partial<Omit<InitRuntime, "prompt">> {
  prompt?: Partial<Omit<InitPromptRuntime, "log">> & {
    log?: Partial<InitPromptLogger>;
  };
}

const PROCESS_EXIT = process.exit.bind(process) as (code: number) => never;

export function createInitRuntime(overrides: InitRuntimeOverrides = {}): InitRuntime {
  const defaultPrompt: InitPromptRuntime = {
    intro: p.intro,
    outro: p.outro,
    cancel: p.cancel,
    isCancel: p.isCancel,
    select: async (options) => p.select(options as Parameters<typeof p.select>[0]),
    confirm: async (options) => p.confirm(options),
    text: async (options) => p.text(options as Parameters<typeof p.text>[0]),
    spinner: p.spinner,
    log: {
      info: p.log.info,
      warn: p.log.warn,
      error: p.log.error,
      message: p.log.message,
      success: p.log.success,
    },
  };

  return {
    prompt: {
      ...defaultPrompt,
      ...overrides.prompt,
      log: {
        ...defaultPrompt.log,
        ...overrides.prompt?.log,
      },
    },
    configExists: overrides.configExists ?? configExists,
    loadConfig: overrides.loadConfig ?? loadConfig,
    ensureConfigDir: overrides.ensureConfigDir ?? ensureConfigDir,
    saveConfig: overrides.saveConfig ?? saveConfig,
    discoverAgentCapabilities: overrides.discoverAgentCapabilities ?? discoverAgentCapabilities,
    checkTmuxInstalled: overrides.checkTmuxInstalled ?? checkTmuxInstalled,
    checkAllAgents: overrides.checkAllAgents ?? checkAllAgents,
    getTmuxInstallHint: overrides.getTmuxInstallHint ?? getTmuxInstallHint,
    exit: overrides.exit ?? PROCESS_EXIT,
  };
}

const DEFAULT_MAX_ITERATIONS = 5;
const DEFAULT_ITERATION_TIMEOUT_MINUTES = 30;

const REVIEWER_AGENT_PRIORITY: readonly AgentType[] = ["codex", "droid", "claude", "gemini"];
const FIXER_AGENT_PRIORITY: readonly AgentType[] = ["claude", "codex", "droid", "gemini"];
const SIMPLIFIER_AGENT_PRIORITY: readonly AgentType[] = ["claude", "codex", "droid", "gemini"];

const MODEL_PRIORITY_MATCHERS: Record<ConfiguredRole, readonly ((model: string) => boolean)[]> = {
  reviewer: [
    (model) => matchesModelId(model, "gpt-5.3-codex"),
    (model) => matchesModelId(model, "gpt-5.2"),
    (model) => matchesModelId(model, "gpt-5.2-codex"),
    (model) => matchesModelId(model, "claude-opus-4-6"),
    (model) => matchesModelId(model, "gemini-3-pro-preview"),
  ],
  fixer: [
    (model) => matchesModelId(model, "claude-opus-4-6"),
    (model) => matchesModelId(model, "gpt-5.3-codex"),
    (model) => matchesModelId(model, "gemini-3-pro-preview"),
  ],
  "code-simplifier": [
    (model) => matchesModelId(model, "claude-opus-4-6"),
    (model) => matchesModelId(model, "gpt-5.3-codex"),
    (model) => isClaudeOpus45Model(model),
    (model) => matchesModelId(model, "gpt-5.2-codex"),
  ],
};

const modelOptionsMap: Record<Exclude<AgentType, "opencode" | "pi">, readonly ModelOption[]> = {
  claude: claudeModelOptions,
  codex: codexModelOptions,
  droid: droidModelOptions,
  gemini: geminiModelOptions,
};

type ModelOption = { value: string; label: string };

export function validateAgentSelection(value: string): boolean {
  return isAgentType(value);
}

export function checkAgentInstalled(command: string): boolean {
  return isAgentAvailable(command);
}

export function checkTmuxInstalled(): boolean {
  return checkAgentInstalled("tmux");
}

export function checkAllAgents(): AgentAvailability {
  return {
    codex: checkAgentInstalled("codex"),
    opencode: checkAgentInstalled("opencode"),
    claude: checkAgentInstalled("claude"),
    droid: checkAgentInstalled("droid"),
    gemini: checkAgentInstalled("gemini"),
    pi: checkAgentInstalled("pi"),
  };
}

function createAgentSettings(
  agent: AgentType,
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
    agent,
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
    $schema: CONFIG_SCHEMA_URI,
    version: CONFIG_VERSION,
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
    "code-simplifier": createAgentSettings(
      input.simplifierAgent,
      input.simplifierModel,
      input.simplifierProvider,
      input.simplifierReasoning
    ),
    run: {
      simplifier: input.runSimplifierByDefault,
    },
    maxIterations: input.maxIterations,
    iterationTimeout: input.iterationTimeoutMinutes * 60 * 1000,
    defaultReview,
    notifications: {
      sound: {
        enabled: input.soundNotificationsEnabled,
      },
    },
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

function handleCancel(runtime: InitRuntime, value: unknown): void {
  if (runtime.prompt.isCancel(value)) {
    runtime.prompt.cancel("Setup cancelled.");
    runtime.exit(0);
  }
}

function requireInitInput(runtime: InitRuntime, input: InitInput | undefined): InitInput {
  if (!input) {
    runtime.prompt.log.error("Setup input could not be created");
    runtime.exit(1);
  }

  return input;
}

function selectReasoningInitialValue(levels: ReasoningLevel[]): ReasoningLevel {
  return levels.includes("high") ? "high" : (levels[0] ?? "high");
}

async function promptForReasoning(
  runtime: InitRuntime,
  agent: AgentType,
  model: string,
  role: ConfiguredRole
): Promise<ReasoningLevel | undefined> {
  const levels = getReasoningOptions(agent, model);
  if (levels.length === 0) {
    return undefined;
  }

  const reasoning = await runtime.prompt.select({
    message: `Select ${role} reasoning level`,
    options: levels.map((level) => ({
      value: level,
      label: level,
      hint: level === "high" ? "recommended" : undefined,
    })),
    initialValue: selectReasoningInitialValue(levels),
  });
  handleCancel(runtime, reasoning);

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

async function promptForModel(
  runtime: InitRuntime,
  agent: AgentType,
  role: ConfiguredRole,
  capabilitiesByAgent: AgentCapabilitiesMap,
  availability: AgentAvailability
): Promise<ModelSelection> {
  const staticOptions =
    agent === "opencode" || agent === "pi"
      ? undefined
      : modelOptionsMap[agent as keyof typeof modelOptionsMap];

  if (staticOptions) {
    const model = await runtime.prompt.select({
      message: `Select ${role} model`,
      options: [...staticOptions],
    });
    handleCancel(runtime, model);
    return { model: model as string };
  }

  let capability = capabilitiesByAgent[agent];
  if (agent === "opencode" || agent === "pi") {
    const needsProbe = !capability || capability.models.length === 0;
    if (needsProbe) {
      const spinner = runtime.prompt.spinner();
      spinner.start(`Fetching ${getAgentDisplayName(agent)} models...`);
      try {
        const discovered = await runtime.discoverAgentCapabilities({
          availabilityOverride: availability,
          probeAgents: [agent],
          cacheNamespace: `init-custom-${agent}`,
        });
        capability = discovered[agent];
        capabilitiesByAgent[agent] = capability;
        spinner.stop("Models loaded");
      } catch (error) {
        spinner.stop("Failed to load models");
        runtime.prompt.log.error(`${error}`);
        runtime.exit(1);
      }
    }
  }

  if (!capability) {
    runtime.prompt.log.error(`Unable to inspect ${getAgentDisplayName(agent)} capabilities.`);
    runtime.exit(1);
  }

  if (capability.models.length === 0) {
    runtime.prompt.log.error(`No models available from ${getAgentDisplayName(agent)}.`);
    capability.probeWarnings.forEach((warning) => {
      runtime.prompt.log.message(`  ${warning}`);
    });
    runtime.exit(1);
  }

  if (agent === "opencode") {
    const model = await runtime.prompt.select({
      message: `Select ${role} model`,
      options: capability.models.map((entry) => ({
        value: entry.model,
        label: entry.model,
      })),
    });
    handleCancel(runtime, model);
    return { model: model as string };
  }

  const piModels = capability.models.filter(
    (entry): entry is { model: string; provider: string } =>
      typeof entry.provider === "string" && entry.provider.trim().length > 0
  );
  if (piModels.length === 0) {
    runtime.prompt.log.error("No provider/model entries were discovered for Pi.");
    runtime.exit(1);
  }

  const piOptions = piModels.map((entry) => ({
    value: encodePiSelection({
      provider: entry.provider,
      model: entry.model,
    }),
    label: entry.model,
    hint: entry.provider,
  }));

  const rawSelection = await runtime.prompt.select({
    message: `Select ${role} model`,
    options: piOptions,
  });
  handleCancel(runtime, rawSelection);

  const selection = decodePiSelection(rawSelection as string);
  if (!selection) {
    runtime.prompt.log.error("Invalid Pi model selection");
    runtime.exit(1);
  }

  return selection;
}

function formatAgentModel(settings: AgentSettings): string {
  if (settings.agent === "pi") {
    return `${settings.provider}/${settings.model}`;
  }

  return settings.model ? getModelDisplayName(settings.agent, settings.model) : "Default";
}

function formatRoleSummary(settings: AgentSettings): string {
  const name = getAgentDisplayName(settings.agent);
  const model = formatAgentModel(settings);
  const reasoning = settings.reasoning ?? "default";
  return `${name} (${model}, ${reasoning})`;
}

function formatConfigDisplay(config: Config): string {
  const simplifierSettings = config["code-simplifier"];
  const defaultReviewDisplay =
    config.defaultReview.type === "base"
      ? `base branch (${config.defaultReview.branch})`
      : "uncommitted changes";

  return [
    `  Reviewer:            ${formatRoleSummary(config.reviewer)}`,
    `  Fixer:               ${formatRoleSummary(config.fixer)}`,
    `  Simplifier:          ${simplifierSettings ? formatRoleSummary(simplifierSettings) : "Not configured"}`,
    `  Max iterations:      ${config.maxIterations}`,
    `  Iteration timeout:   ${config.iterationTimeout / 1000 / 60} minutes`,
    `  Default review:      ${defaultReviewDisplay}`,
    `  Run simplifier:      ${config.run?.simplifier ? "enabled" : "disabled"}`,
    `  Sound notify:        ${config.notifications.sound.enabled ? "enabled" : "disabled"}`,
  ].join("\n");
}

function normalizeModelId(model: string): string {
  return model.trim().toLowerCase();
}

function matchesModelId(model: string, target: string): boolean {
  const normalized = normalizeModelId(model);
  return normalized === target || normalized.endsWith(`/${target}`);
}

function isClaudeOpus45Model(model: string): boolean {
  const normalized = normalizeModelId(model);
  return normalized.includes("claude-opus-4-5");
}

function getRoleAgentPriority(role: ConfiguredRole): readonly AgentType[] {
  switch (role) {
    case "reviewer":
      return REVIEWER_AGENT_PRIORITY;
    case "fixer":
      return FIXER_AGENT_PRIORITY;
    case "code-simplifier":
      return SIMPLIFIER_AGENT_PRIORITY;
  }
}

export function getRoleAgentPriorityRank(role: ConfiguredRole, agent: AgentType): number {
  const priority = getRoleAgentPriority(role);
  const rank = priority.indexOf(agent);
  return rank === -1 ? priority.length : rank;
}

export function getRoleModelPriorityRank(role: ConfiguredRole, model: string): number {
  const matchers = MODEL_PRIORITY_MATCHERS[role];
  const rank = matchers.findIndex((matcher) => matcher(model));
  return rank === -1 ? matchers.length : rank;
}

function compareCandidates(
  role: ConfiguredRole,
  left: AutoModelCandidate,
  right: AutoModelCandidate
): number {
  const leftModelRank = getRoleModelPriorityRank(role, left.model);
  const rightModelRank = getRoleModelPriorityRank(role, right.model);
  if (leftModelRank !== rightModelRank) {
    return leftModelRank - rightModelRank;
  }

  const leftAgentRank = getRoleAgentPriorityRank(role, left.agent);
  const rightAgentRank = getRoleAgentPriorityRank(role, right.agent);
  if (leftAgentRank !== rightAgentRank) {
    return leftAgentRank - rightAgentRank;
  }

  const priorityLength = getRoleAgentPriority(role).length;
  if (leftAgentRank === priorityLength && rightAgentRank === priorityLength) {
    if (left.probeOrder !== right.probeOrder) {
      return left.probeOrder - right.probeOrder;
    }
  }

  if (left.modelOrder !== right.modelOrder) {
    return left.modelOrder - right.modelOrder;
  }

  if (left.agent !== right.agent) {
    return left.agent.localeCompare(right.agent);
  }

  return left.model.localeCompare(right.model);
}

export function pickAutoRoleCandidate(
  role: ConfiguredRole,
  candidates: AutoModelCandidate[]
): AutoModelCandidate | null {
  if (candidates.length === 0) {
    return null;
  }

  const sorted = [...candidates].sort((left, right) => compareCandidates(role, left, right));
  return sorted[0] ?? null;
}

export function selectAutoReasoning(agent: AgentType, model: string): ReasoningLevel | undefined {
  const levels = getReasoningOptions(agent, model);
  if (levels.length === 0) {
    return undefined;
  }
  return levels.includes("high") ? "high" : levels[0];
}

function toCandidates(
  agent: AgentType,
  models: ModelSelection[],
  probeOrder: number
): AutoModelCandidate[] {
  return models.map((entry, modelOrder) => ({
    agent,
    model: entry.model,
    provider: entry.provider,
    modelOrder,
    probeOrder,
  }));
}

export async function discoverAutoModelCandidates(
  availability: AgentAvailability,
  deps: AutoSelectionDependencies = {}
): Promise<AutoModelDiscoveryResult> {
  const candidates: AutoModelCandidate[] = [];
  const skipped = new Set<AgentType>();

  const capabilitiesByAgent =
    deps.capabilitiesByAgent ??
    (await discoverAgentCapabilities({
      availabilityOverride: availability,
      deps: {
        fetchOpencodeModels: deps.fetchOpencodeModels,
        fetchPiModels: deps.fetchPiModels,
      },
    }));

  let nextProbeOrder = 0;
  const registerCandidates = (agent: AgentType, models: ModelSelection[]) => {
    if (models.length === 0) {
      skipped.add(agent);
      return;
    }

    const probeOrder = nextProbeOrder++;
    candidates.push(...toCandidates(agent, models, probeOrder));
  };

  const orderedAgents: readonly AgentType[] = [
    "claude",
    "codex",
    "droid",
    "gemini",
    "opencode",
    "pi",
  ];

  for (const agent of orderedAgents) {
    if (!availability[agent]) {
      continue;
    }

    const capability = capabilitiesByAgent[agent];
    const options = capability.models.map((entry) => ({
      model: entry.model,
      provider: entry.provider,
    }));

    registerCandidates(agent, options);
  }

  return {
    candidates,
    skippedAgents: [...skipped],
  };
}

function toRoleSelection(candidate: AutoModelCandidate | null): RoleAgentSelection | null {
  if (!candidate) {
    return null;
  }

  return {
    agent: candidate.agent,
    model: candidate.model,
    provider: candidate.provider,
    reasoning: selectAutoReasoning(candidate.agent, candidate.model),
  };
}

export async function buildAutoInitInput(
  availability: AgentAvailability,
  deps: AutoSelectionDependencies = {}
): Promise<AutoInitInputResult> {
  const { candidates, skippedAgents } = await discoverAutoModelCandidates(availability, deps);

  const reviewer = toRoleSelection(pickAutoRoleCandidate("reviewer", candidates));
  const fixer = toRoleSelection(pickAutoRoleCandidate("fixer", candidates));
  const simplifier = toRoleSelection(pickAutoRoleCandidate("code-simplifier", candidates));

  if (!reviewer || !fixer || !simplifier) {
    throw new Error(
      "Automatic setup could not determine reviewer/fixer/simplifier. Use Customize Setup."
    );
  }

  const maxIterations = DEFAULT_CONFIG.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const timeoutMs =
    DEFAULT_CONFIG.iterationTimeout ?? DEFAULT_ITERATION_TIMEOUT_MINUTES * 60 * 1000;
  const iterationTimeoutMinutes = Math.max(1, Math.round(timeoutMs / 1000 / 60));

  return {
    input: {
      reviewerAgent: reviewer.agent,
      reviewerModel: reviewer.model,
      reviewerProvider: reviewer.provider,
      reviewerReasoning: reviewer.reasoning,
      fixerAgent: fixer.agent,
      fixerModel: fixer.model,
      fixerProvider: fixer.provider,
      fixerReasoning: fixer.reasoning,
      simplifierAgent: simplifier.agent,
      simplifierModel: simplifier.model,
      simplifierProvider: simplifier.provider,
      simplifierReasoning: simplifier.reasoning,
      maxIterations,
      iterationTimeoutMinutes,
      defaultReviewType: "uncommitted",
      runSimplifierByDefault: false,
      soundNotificationsEnabled: DEFAULT_CONFIG.notifications?.sound.enabled ?? true,
    },
    skippedAgents,
  };
}

async function promptForNumericSetting(
  runtime: InitRuntime,
  message: string,
  defaultValue: number
): Promise<number> {
  const value = await runtime.prompt.text({
    message,
    placeholder: "Press enter for default",
    defaultValue: String(defaultValue),
    validate: (text) => {
      if (!text || text === "") {
        return;
      }
      const num = Number.parseInt(text, 10);
      if (Number.isNaN(num) || num < 1) {
        return "Must be a positive number";
      }
    },
  });
  handleCancel(runtime, value);

  return Number.parseInt(value as string, 10);
}

async function promptForCustomInitInput(
  runtime: InitRuntime,
  selectOptions: ReturnType<typeof buildAgentSelectOptions>,
  capabilitiesByAgent: AgentCapabilitiesMap,
  availability: AgentAvailability
) {
  const reviewerAgent = await runtime.prompt.select({
    message: "Select reviewer agent",
    options: selectOptions,
  });
  handleCancel(runtime, reviewerAgent);
  const reviewerAgentValue = reviewerAgent as AgentType;

  const reviewerSelection = await promptForModel(
    runtime,
    reviewerAgentValue,
    "reviewer",
    capabilitiesByAgent,
    availability
  );
  const reviewerReasoning = await promptForReasoning(
    runtime,
    reviewerAgentValue,
    reviewerSelection.model,
    "reviewer"
  );

  const fixerAgent = await runtime.prompt.select({
    message: "Select fixer agent",
    options: selectOptions,
  });
  handleCancel(runtime, fixerAgent);
  const fixerAgentValue = fixerAgent as AgentType;

  const fixerSelection = await promptForModel(
    runtime,
    fixerAgentValue,
    "fixer",
    capabilitiesByAgent,
    availability
  );
  const fixerReasoning = await promptForReasoning(
    runtime,
    fixerAgentValue,
    fixerSelection.model,
    "fixer"
  );

  const simplifierAgent = await runtime.prompt.select({
    message: "Select code simplifier agent",
    options: selectOptions,
  });
  handleCancel(runtime, simplifierAgent);
  const simplifierAgentValue = simplifierAgent as AgentType;

  const simplifierSelection = await promptForModel(
    runtime,
    simplifierAgentValue,
    "code-simplifier",
    capabilitiesByAgent,
    availability
  );
  const simplifierReasoning = await promptForReasoning(
    runtime,
    simplifierAgentValue,
    simplifierSelection.model,
    "code-simplifier"
  );

  const maxIterations = await promptForNumericSetting(
    runtime,
    `Maximum iterations (default: ${DEFAULT_CONFIG.maxIterations ?? DEFAULT_MAX_ITERATIONS})`,
    DEFAULT_CONFIG.maxIterations ?? DEFAULT_MAX_ITERATIONS
  );

  const defaultTimeoutMinutes = (DEFAULT_CONFIG.iterationTimeout ?? 1800000) / 1000 / 60;
  const iterationTimeoutMinutes = await promptForNumericSetting(
    runtime,
    `Timeout per iteration in minutes (default: ${defaultTimeoutMinutes})`,
    defaultTimeoutMinutes
  );

  const defaultReviewType = await runtime.prompt.select({
    message: "Default review mode for 'rr run'",
    options: [
      { value: "uncommitted", label: "Uncommitted changes", hint: "staged, unstaged, untracked" },
      { value: "base", label: "Compare against base branch" },
    ],
    initialValue: "uncommitted",
  });
  handleCancel(runtime, defaultReviewType);

  let defaultReviewBranch: string | undefined;
  if (defaultReviewType === "base") {
    defaultReviewBranch = (await runtime.prompt.text({
      message: "Base branch name",
      placeholder: "main",
      defaultValue: "main",
      validate: (value) => {
        if (!value || value.trim() === "") {
          return "Branch name is required";
        }
      },
    })) as string;
    handleCancel(runtime, defaultReviewBranch);
  }

  const runSimplifierByDefault = await runtime.prompt.confirm({
    message: "Enable code simplifier by default for 'rr run'?",
    initialValue: false,
  });
  handleCancel(runtime, runSimplifierByDefault);

  return {
    reviewerAgent: reviewerAgentValue,
    reviewerModel: reviewerSelection.model,
    reviewerProvider: reviewerSelection.provider,
    reviewerReasoning,
    fixerAgent: fixerAgentValue,
    fixerModel: fixerSelection.model,
    fixerProvider: fixerSelection.provider,
    fixerReasoning,
    simplifierAgent: simplifierAgentValue,
    simplifierModel: simplifierSelection.model,
    simplifierProvider: simplifierSelection.provider,
    simplifierReasoning,
    maxIterations,
    iterationTimeoutMinutes,
    defaultReviewType: defaultReviewType as "uncommitted" | "base",
    defaultReviewBranch: defaultReviewBranch as string | undefined,
    runSimplifierByDefault: runSimplifierByDefault as boolean,
    soundNotificationsEnabled: DEFAULT_CONFIG.notifications?.sound.enabled ?? true,
  } satisfies InitInput;
}

async function promptForSoundNotifications(
  runtime: InitRuntime,
  defaultValue: boolean
): Promise<boolean> {
  const shouldEnable = await runtime.prompt.confirm({
    message: "Play sound when review session finishes?",
    initialValue: defaultValue,
  });
  handleCancel(runtime, shouldEnable);
  return shouldEnable as boolean;
}

export async function runInitWithRuntime(
  runtimeOverrides: InitRuntimeOverrides = {}
): Promise<void> {
  const runtime = createInitRuntime(runtimeOverrides);
  runtime.prompt.intro("Ralph Review Setup");

  if (await runtime.configExists()) {
    const existingConfig = await runtime.loadConfig();
    if (existingConfig) {
      runtime.prompt.log.info(`Current configuration:\n${formatConfigDisplay(existingConfig)}`);
    }

    const shouldOverwrite = await runtime.prompt.confirm({
      message: "Configuration already exists. Overwrite?",
      initialValue: false,
    });

    handleCancel(runtime, shouldOverwrite);

    if (!shouldOverwrite) {
      runtime.prompt.cancel("Setup cancelled.");
      return;
    }
  }

  if (!runtime.checkTmuxInstalled()) {
    const installHint = runtime.getTmuxInstallHint();
    runtime.prompt.log.warn(
      "tmux is not installed.\n" +
        `   Install with: ${installHint}\n` +
        "   (Required for background review sessions)"
    );
  }

  const agentAvailability = runtime.checkAllAgents();
  const availableCount = Object.values(agentAvailability).filter(Boolean).length;
  if (availableCount === 0) {
    runtime.prompt.log.error(
      "No supported agents are installed.\n" +
        "   Install at least one of: codex, claude, opencode, droid, gemini, pi"
    );
    runtime.exit(1);
  }

  const selectOptions = buildAgentSelectOptions(agentAvailability);

  const setupMode = await runtime.prompt.select({
    message: "Choose setup mode",
    options: [
      { value: "auto", label: "Auto Setup", hint: "recommended" },
      { value: "custom", label: "Customize Setup", hint: "configure each detail manually" },
    ],
    initialValue: "auto",
  });
  handleCancel(runtime, setupMode);

  let input: InitInput | undefined;
  if (setupMode === "auto") {
    const spinner = runtime.prompt.spinner();
    spinner.start("Detecting installed models and building automatic configuration...");
    try {
      const capabilitiesByAgent = await runtime.discoverAgentCapabilities({
        availabilityOverride: agentAvailability,
        probeAgents: ["opencode", "pi"],
        cacheNamespace: "init-auto",
      });
      const autoResult = await buildAutoInitInput(agentAvailability, { capabilitiesByAgent });
      input = autoResult.input;
      if (autoResult.skippedAgents.length > 0) {
        const skipped = autoResult.skippedAgents
          .map((agent) => getAgentDisplayName(agent))
          .join(", ");
        runtime.prompt.log.warn(`Skipped agents during automatic setup: ${skipped}`);
        autoResult.skippedAgents.forEach((agent) => {
          const warningList = capabilitiesByAgent[agent].probeWarnings;
          warningList.forEach((warning) => {
            runtime.prompt.log.message(`  ${warning}`);
          });
        });
      }
      spinner.stop("Automatic configuration ready");
    } catch (error) {
      spinner.stop("Automatic setup failed");
      runtime.prompt.log.error(`${error}`);
      runtime.exit(1);
    }
  } else if (setupMode === "custom") {
    const capabilitiesByAgent = await runtime.discoverAgentCapabilities({
      availabilityOverride: agentAvailability,
      probeAgents: [],
      cacheNamespace: "init-custom",
    });
    input = await promptForCustomInitInput(
      runtime,
      selectOptions,
      capabilitiesByAgent,
      agentAvailability
    );
  } else {
    runtime.prompt.log.error("Invalid setup mode selection");
    runtime.exit(1);
  }

  const resolvedInput = requireInitInput(runtime, input);
  const inputWithSound: InitInput = {
    ...resolvedInput,
    soundNotificationsEnabled: await promptForSoundNotifications(
      runtime,
      resolvedInput.soundNotificationsEnabled
    ),
  };

  const config = buildConfig(inputWithSound);
  runtime.prompt.log.info(`Proposed configuration:\n${formatConfigDisplay(config)}`);

  const shouldSave = await runtime.prompt.confirm({
    message: "Save this configuration?",
    initialValue: true,
  });
  handleCancel(runtime, shouldSave);

  if (!shouldSave) {
    runtime.prompt.cancel("Setup cancelled.");
    return;
  }

  await runtime.ensureConfigDir();
  await runtime.saveConfig(config);

  runtime.prompt.log.success(`Configuration saved to ${CONFIG_PATH}`);
  runtime.prompt.outro("You can now run: rr run");
}

export async function runInit(): Promise<void> {
  await runInitWithRuntime();
}
