import {
  claudeModelOptions,
  codexModelOptions,
  droidModelOptions,
  geminiModelOptions,
} from "@/lib/agents/models";
import { AGENTS } from "@/lib/agents/registry";
import type { AgentType } from "@/lib/types";
import type { AgentCapabilitiesMap, AgentCapability, AgentModelInfo } from "./types";

export interface CapabilityDiscoveryDependencies {
  fetchOpencodeModels?: () => Promise<{ value: string; label: string }[]>;
  fetchPiModels?: () => Promise<{ provider: string; model: string }[]>;
}

export interface CapabilityDiscoveryOptions {
  availabilityOverride?: Partial<Record<AgentType, boolean>>;
  cacheNamespace?: string;
  forceRefresh?: boolean;
  probeAgents?: AgentType[];
  deps?: CapabilityDiscoveryDependencies;
}

const AGENT_ORDER: readonly AgentType[] = ["codex", "claude", "opencode", "droid", "gemini", "pi"];

const STATIC_MODELS: Record<Exclude<AgentType, "opencode" | "pi">, readonly { value: string }[]> = {
  claude: claudeModelOptions,
  codex: codexModelOptions,
  droid: droidModelOptions,
  gemini: geminiModelOptions,
};

const capabilityCache = new Map<string, AgentCapability>();

function getAgentCommand(agent: AgentType): string {
  return AGENTS[agent].config.command;
}

function toStaticModels(agent: Exclude<AgentType, "opencode" | "pi">): AgentModelInfo[] {
  return STATIC_MODELS[agent].map((entry) => ({ model: entry.value }));
}

function parseOpencodeModelsOutput(output: string): { value: string; label: string }[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("INFO"))
    .map((model) => ({ value: model, label: model }));
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

async function fetchPiModels(): Promise<{ provider: string; model: string }[]> {
  const { stdout, stderr, exitCode } = await runProbe(["pi", "--list-models"]);
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `pi --list-models exited with code ${exitCode}`);
  }

  return parsePiListModelsOutput(stdout);
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

async function discoverDynamicCapability(
  agent: Extract<AgentType, "opencode" | "pi">,
  deps: CapabilityDiscoveryDependencies
): Promise<AgentCapability> {
  const command = getAgentCommand(agent);

  try {
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

function discoverStaticCapability(agent: Exclude<AgentType, "opencode" | "pi">): AgentCapability {
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
  agent: Extract<AgentType, "opencode" | "pi">
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

export function clearCapabilityDiscoveryCache(): void {
  capabilityCache.clear();
}

export async function discoverAgentCapabilities(
  options: CapabilityDiscoveryOptions = {}
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

    const isDynamic = agent === "opencode" || agent === "pi";
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
          : await discoverDynamicCapability(agent, deps);
    } else {
      capability = discoverStaticCapability(agent);
    }

    capabilityCache.set(cacheKey, capability);
    result[agent] = capability;
  }

  return result as AgentCapabilitiesMap;
}
