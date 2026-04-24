import {
  claudeModelOptions,
  geminiModelOptions,
  registerCodexReasoningOptions,
  registerDroidReasoningOptions,
} from "@/lib/agents/models";
import { AGENTS } from "@/lib/agents/registry";
import { type AgentType, isReasoningLevel, type ReasoningLevel } from "@/lib/types";
import type { AgentCapabilitiesMap, AgentCapability, AgentModelInfo } from "./types";

export interface CapabilityReviewDependencies {
  fetchCodexModels?: () => Promise<{
    models: { value: string; label: string }[];
    reasoningByModel: Record<string, ReasoningLevel[]>;
  }>;
  fetchDroidModels?: () => Promise<{ value: string; label: string }[]>;
  fetchOpencodeModels?: () => Promise<{ value: string; label: string }[]>;
  fetchPiModels?: () => Promise<{ provider: string; model: string }[]>;
}

export interface CapabilityReviewOptions {
  availabilityOverride?: Partial<Record<AgentType, boolean>>;
  cacheNamespace?: string;
  forceRefresh?: boolean;
  probeAgents?: AgentType[];
  deps?: CapabilityReviewDependencies;
}

const AGENT_ORDER: readonly AgentType[] = ["codex", "claude", "opencode", "droid", "gemini", "pi"];

const STATIC_MODELS: Record<
  Exclude<AgentType, "codex" | "droid" | "opencode" | "pi">,
  readonly { value: string }[]
> = {
  claude: claudeModelOptions,
  gemini: geminiModelOptions,
};

const capabilityCache = new Map<string, AgentCapability>();

function getAgentCommand(agent: AgentType): string {
  return AGENTS[agent].config.command;
}

function toStaticModels(
  agent: Exclude<AgentType, "codex" | "droid" | "opencode" | "pi">
): AgentModelInfo[] {
  return STATIC_MODELS[agent].map((entry) => ({ model: entry.value }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCodexSupportedReasoningLevels(value: unknown): ReasoningLevel[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }
      return entry.effort;
    })
    .filter((effort): effort is ReasoningLevel => isReasoningLevel(effort));
}

export function parseCodexDebugModelsOutput(output: string): {
  models: { value: string; label: string }[];
  reasoningByModel: Record<string, ReasoningLevel[]>;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("Invalid JSON from `codex debug models`.");
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.models)) {
    throw new Error("`codex debug models` output did not include a models array.");
  }

  const models: { value: string; label: string }[] = [];
  const reasoningByModel: Record<string, ReasoningLevel[]> = {};
  const seen = new Set<string>();

  for (const entry of parsed.models) {
    if (!isRecord(entry) || typeof entry.slug !== "string") {
      continue;
    }

    const slug = entry.slug.trim();
    if (!slug || slug === "codex-auto-review" || seen.has(slug)) {
      continue;
    }

    seen.add(slug);
    const displayName =
      typeof entry.display_name === "string" && entry.display_name.trim()
        ? entry.display_name.trim()
        : slug;
    const reasoningLevels = parseCodexSupportedReasoningLevels(entry.supported_reasoning_levels);

    models.push({ value: slug, label: displayName });
    reasoningByModel[slug] = reasoningLevels;
  }

  return {
    models,
    reasoningByModel,
  };
}

function parseOpencodeModelsOutput(output: string): { value: string; label: string }[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("INFO"))
    .map((model) => ({ value: model, label: model }));
}

function isPiProviderToken(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/i.test(value);
}

function dedupePiModels(
  models: { provider: string; model: string }[]
): { provider: string; model: string }[] {
  const deduped: { provider: string; model: string }[] = [];
  const seen = new Set<string>();

  for (const entry of models) {
    const key = `${entry.provider}\u0000${entry.model}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(entry);
  }

  return deduped;
}

export function parsePiListModelsOutput(output: string): { provider: string; model: string }[] {
  const models: { provider: string; model: string }[] = [];
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const headerIndex = lines.findIndex((line) => /^provider\s+model(?:\s+|$)/i.test(line));
  const candidateLines = headerIndex === -1 ? lines : lines.slice(headerIndex + 1);

  for (const line of candidateLines) {
    const columns =
      headerIndex === -1
        ? line.split(/\s+/)
        : line
            .split(/\s{2,}/)
            .map((value) => value.trim())
            .filter(Boolean);
    if (columns.length < 2) {
      continue;
    }

    const provider = columns[0]?.trim();
    const model = columns[1]?.trim();
    if (!provider || !model || !isPiProviderToken(provider)) {
      continue;
    }

    models.push({ provider, model });
  }

  return dedupePiModels(models);
}

function dedupeModelOptions(
  models: { value: string; label: string }[]
): { value: string; label: string }[] {
  const deduped: { value: string; label: string }[] = [];
  const seen = new Set<string>();

  for (const entry of models) {
    if (seen.has(entry.value)) {
      continue;
    }
    seen.add(entry.value);
    deduped.push(entry);
  }

  return deduped;
}

function isDroidModelLine(line: string): boolean {
  return /^\S+\s{2,}\S/.test(line);
}

function parseDroidModelLine(line: string): { value: string; label: string } | null {
  if (!isDroidModelLine(line)) {
    return null;
  }

  const [value, ...labelParts] = line.split(/\s{2,}/);
  const label = labelParts.join(" ").trim();
  if (!value || !label) {
    return null;
  }

  return { value: value.trim(), label };
}

function parseSupportedReasoningLevels(line: string): ReasoningLevel[] {
  const supportedMatch = line.match(/supported:\s*\[([^\]]*)\]/i);
  if (!supportedMatch) {
    return [];
  }

  const supportedLevels = supportedMatch[1];
  if (!supportedLevels) {
    return [];
  }

  return supportedLevels
    .split(",")
    .map((level) => level.trim())
    .filter((level): level is ReasoningLevel => {
      return level !== "off" && level !== "none" && level !== "minimal" && isReasoningLevel(level);
    });
}

function normalizeDroidModelLabel(label: string): string {
  return label
    .replace(/\s+\[Deprecated\]$/i, "")
    .replace(/\s+\(default\)$/i, "")
    .trim();
}

export function parseDroidExecHelpOutput(output: string): {
  models: { value: string; label: string }[];
  reasoningByModel: Record<string, ReasoningLevel[]>;
} {
  const lines = output.split("\n");
  const models: { value: string; label: string }[] = [];
  const modelNamesByLabel = new Map<string, string>();
  const reasoningByModel: Record<string, ReasoningLevel[]> = {};

  let inAvailableModels = false;
  let inModelDetails = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^Available Models:\s*$/i.test(line)) {
      inAvailableModels = true;
      inModelDetails = false;
      continue;
    }
    if (/^Model details:\s*$/i.test(line)) {
      inAvailableModels = false;
      inModelDetails = true;
      continue;
    }

    if (inAvailableModels) {
      if (!line) {
        continue;
      }

      const model = parseDroidModelLine(line);
      if (!model) {
        continue;
      }

      models.push(model);
      modelNamesByLabel.set(normalizeDroidModelLabel(model.label), model.value);
      continue;
    }

    if (inModelDetails) {
      const detailMatch = line.match(/^-\s+(.+?):\s+supports reasoning:/i);
      if (!detailMatch) {
        continue;
      }

      const modelLabel = detailMatch[1];
      if (!modelLabel) {
        continue;
      }

      const model = modelNamesByLabel.get(modelLabel);
      if (!model) {
        continue;
      }

      reasoningByModel[model] = parseSupportedReasoningLevels(line);
    }
  }

  return {
    models: dedupeModelOptions(models),
    reasoningByModel,
  };
}

async function runProbe(
  args: string[],
  timeoutMs: number = 8000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  clearTimeout(timeoutId);

  if (timedOut) {
    return {
      stdout,
      stderr: `${stderr}\nprobe timed out after ${timeoutMs}ms`.trim(),
      exitCode: exitCode === 0 ? 124 : exitCode,
    };
  }

  return { stdout, stderr, exitCode };
}

async function fetchOpencodeModels(): Promise<{ value: string; label: string }[]> {
  const { stdout, stderr, exitCode } = await runProbe(["opencode", "models"]);
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `opencode models exited with code ${exitCode}`);
  }

  return parseOpencodeModelsOutput(stdout);
}

async function fetchCodexModels(): Promise<{
  models: { value: string; label: string }[];
  reasoningByModel: Record<string, ReasoningLevel[]>;
}> {
  const { stdout, stderr, exitCode } = await runProbe(["codex", "debug", "models"]);
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `codex debug models exited with code ${exitCode}`);
  }

  return parseCodexDebugModelsOutput(stdout);
}

async function fetchDroidModels(): Promise<{ value: string; label: string }[]> {
  const { stdout, stderr, exitCode } = await runProbe(["droid", "exec", "--help"]);
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `droid exec --help exited with code ${exitCode}`);
  }

  const parsed = parseDroidExecHelpOutput(stdout);
  registerDroidReasoningOptions(parsed.reasoningByModel);
  return parsed.models;
}

async function fetchPiModels(): Promise<{ provider: string; model: string }[]> {
  const { stdout, stderr, exitCode } = await runProbe(["pi", "--list-models"]);
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `pi --list-models exited with code ${exitCode}`);
  }

  return dedupePiModels([...parsePiListModelsOutput(stdout), ...parsePiListModelsOutput(stderr)]);
}

function createUninstalledCapability(agent: AgentType): AgentCapability {
  return {
    agent,
    command: getAgentCommand(agent),
    installed: false,
    modelCatalogSource: "none",
    models: [],
    probeWarnings: [],
  };
}

async function reviewDynamicCapability(
  agent: Extract<AgentType, "codex" | "droid" | "opencode" | "pi">,
  deps: CapabilityReviewDependencies
): Promise<AgentCapability> {
  const command = getAgentCommand(agent);

  try {
    if (agent === "codex") {
      const parsed = await (deps.fetchCodexModels ?? fetchCodexModels)();
      registerCodexReasoningOptions(parsed.reasoningByModel);
      if (parsed.models.length === 0) {
        return {
          agent,
          command,
          installed: true,
          modelCatalogSource: "none",
          models: [],
          probeWarnings: ["No models were returned by `codex debug models`."],
        };
      }

      return {
        agent,
        command,
        installed: true,
        modelCatalogSource: "dynamic",
        models: parsed.models.map((entry) => ({ model: entry.value, label: entry.label })),
        probeWarnings: [],
      };
    }

    if (agent === "opencode") {
      const models = await (deps.fetchOpencodeModels ?? fetchOpencodeModels)();
      return {
        agent,
        command,
        installed: true,
        modelCatalogSource: "dynamic",
        models: models.map((entry) => ({ model: entry.value })),
        probeWarnings: models.length === 0 ? ["No models were returned by `opencode models`."] : [],
      };
    }

    if (agent === "droid") {
      const models = await (deps.fetchDroidModels ?? fetchDroidModels)();
      if (models.length === 0) {
        return {
          agent,
          command,
          installed: true,
          modelCatalogSource: "none",
          models: [],
          probeWarnings: ["No models were returned by `droid exec --help`."],
        };
      }

      return {
        agent,
        command,
        installed: true,
        modelCatalogSource: "dynamic",
        models: models.map((entry) => ({ model: entry.value, label: entry.label })),
        probeWarnings: [],
      };
    }

    const models = await (deps.fetchPiModels ?? fetchPiModels)();
    return {
      agent,
      command,
      installed: true,
      modelCatalogSource: "dynamic",
      models: models.map((entry) => ({ provider: entry.provider, model: entry.model })),
      probeWarnings: models.length === 0 ? ["No models were returned by `pi --list-models`."] : [],
    };
  } catch (error) {
    const message = `${error}`;
    return {
      agent,
      command,
      installed: true,
      modelCatalogSource: "none",
      models: [],
      probeWarnings: [message],
    };
  }
}

function reviewStaticCapability(
  agent: Exclude<AgentType, "codex" | "droid" | "opencode" | "pi">
): AgentCapability {
  return {
    agent,
    command: getAgentCommand(agent),
    installed: true,
    modelCatalogSource: "static",
    models: toStaticModels(agent),
    probeWarnings: [],
  };
}

function createDynamicProbeSkippedCapability(
  agent: Extract<AgentType, "codex" | "droid" | "opencode" | "pi">
): AgentCapability {
  return {
    agent,
    command: getAgentCommand(agent),
    installed: true,
    modelCatalogSource: "none",
    models: [],
    probeWarnings: [],
  };
}

export function clearCapabilityReviewCache(): void {
  capabilityCache.clear();
}

export async function reviewAgentCapabilities(
  options: CapabilityReviewOptions = {}
): Promise<AgentCapabilitiesMap> {
  const result: Partial<AgentCapabilitiesMap> = {};
  const namespace = options.cacheNamespace ?? "default";
  const deps = options.deps ?? {};
  const probeAgents = options.probeAgents ? new Set(options.probeAgents) : null;

  for (const agent of AGENT_ORDER) {
    const command = getAgentCommand(agent);
    const installed = options.availabilityOverride?.[agent] ?? Bun.which(command) !== null;

    if (!installed) {
      result[agent] = createUninstalledCapability(agent);
      continue;
    }

    const isDynamic =
      agent === "codex" || agent === "droid" || agent === "opencode" || agent === "pi";
    const probeMode = isDynamic
      ? probeAgents && !probeAgents.has(agent)
        ? "skip"
        : "probe"
      : "static";
    const cacheKey = `${namespace}:${agent}:${probeMode}`;
    if (!options.forceRefresh) {
      const cached = capabilityCache.get(cacheKey);
      if (cached) {
        result[agent] = cached;
        continue;
      }
    }

    let capability: AgentCapability;
    if (isDynamic) {
      capability =
        probeMode === "skip"
          ? createDynamicProbeSkippedCapability(agent)
          : await reviewDynamicCapability(agent, deps);
    } else {
      capability = reviewStaticCapability(agent);
    }

    capabilityCache.set(cacheKey, capability);
    result[agent] = capability;
  }

  return result as AgentCapabilitiesMap;
}
