import { homedir } from "node:os";
import { getAgentDisplayName, getModelDisplayName } from "@/lib/agents/models";
import type {
  EffectiveConfigDiagnostics,
  LoadedConfigDiagnostics,
  LoadedConfigOverrideDiagnostics,
} from "@/lib/config";
import type { AgentOverrideSettings, AgentSettings, Config, ConfigOverride } from "@/lib/types";

type DisplayConfig = Config | ConfigOverride;

interface ConfigSection {
  title?: string;
  path?: string | null;
  note?: string;
  config?: DisplayConfig | null;
  errors?: string[];
  missingText?: string;
}

interface ReadableConfigSectionBase {
  title?: string;
  path?: string | null;
  note?: string;
  showMetadata?: boolean;
  emptyText?: string;
}

interface ReadableFullConfigSection extends ReadableConfigSectionBase {
  mode: "full";
  config: Config;
}

interface ReadableOverrideConfigSection extends ReadableConfigSectionBase {
  mode: "override";
  config: ConfigOverride;
}

type ReadableConfigSection = ReadableFullConfigSection | ReadableOverrideConfigSection;

interface FormatConfigLayersOptions {
  showMetadata?: boolean;
}

interface DisplayEntry {
  label: string;
  value: string;
}

function formatDisplayPath(path: string): string {
  const homePath = homedir();
  return path.startsWith(homePath) ? `~${path.slice(homePath.length)}` : path;
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

function formatOverrideRoleSummary(settings: AgentOverrideSettings): string {
  if (settings.agent) {
    const summarySettings: AgentSettings =
      settings.agent === "pi"
        ? {
            agent: "pi",
            provider: settings.provider ?? "inherited",
            model: settings.model ?? "inherited",
            ...(typeof settings.reasoning === "string" ? { reasoning: settings.reasoning } : {}),
          }
        : {
            agent: settings.agent,
            ...(typeof settings.model === "string" ? { model: settings.model } : {}),
            ...(typeof settings.reasoning === "string" ? { reasoning: settings.reasoning } : {}),
          };
    const baseSummary = formatRoleSummary(summarySettings);

    const qualifiers: string[] = [];
    if (settings.model === null) {
      qualifiers.push("model removed");
    }
    if (settings.reasoning === null) {
      qualifiers.push("reasoning removed");
    }
    if (settings.provider === null) {
      qualifiers.push("provider removed");
    }

    return qualifiers.length > 0 ? `${baseSummary}; ${qualifiers.join(", ")}` : baseSummary;
  }

  const entries: string[] = [];
  if (settings.model !== undefined) {
    entries.push(settings.model === null ? "model removed" : `model ${settings.model}`);
  }
  if (settings.reasoning !== undefined) {
    entries.push(
      settings.reasoning === null ? "reasoning removed" : `reasoning ${settings.reasoning}`
    );
  }
  if (settings.provider !== undefined) {
    entries.push(settings.provider === null ? "provider removed" : `provider ${settings.provider}`);
  }

  return entries.join(", ");
}

function formatFeatureState(value: boolean): string {
  return value ? "enabled" : "disabled";
}

function formatIterationTimeout(value: number): string {
  const formatted = value.toLocaleString("en-US");
  const hour = 60 * 60 * 1000;
  const minute = 60 * 1000;
  const second = 1000;

  if (value % hour === 0) {
    return `${formatted} ms (${value / hour}h)`;
  }

  if (value % minute === 0) {
    return `${formatted} ms (${value / minute}m)`;
  }

  if (value % second === 0) {
    return `${formatted} ms (${value / second}s)`;
  }

  return `${formatted} ms`;
}

function formatDefaultReview(defaultReview: Config["defaultReview"]): string {
  return defaultReview.type === "base"
    ? `base branch (${defaultReview.branch})`
    : "uncommitted changes";
}

function pushSection(lines: string[], title: string, entries: DisplayEntry[]): void {
  if (entries.length === 0) {
    return;
  }

  if (lines.length > 0) {
    lines.push("");
  }

  lines.push(title);
  for (const entry of entries) {
    lines.push(`  ${entry.label}: ${entry.value}`);
  }
}

function formatReadableConfigBody(configSection: ReadableConfigSection): string[] {
  const lines: string[] = [];
  const { config, mode, showMetadata = false } = configSection;

  if (mode === "full") {
    pushSection(lines, "Agents", [
      { label: "Reviewer", value: formatRoleSummary(config.reviewer) },
      { label: "Fixer", value: formatRoleSummary(config.fixer) },
      {
        label: "Simplifier",
        value: config["code-simplifier"]
          ? formatRoleSummary(config["code-simplifier"])
          : "Not configured",
      },
    ]);

    pushSection(lines, "Run", [
      { label: "Simplifier", value: formatFeatureState(config.run?.simplifier ?? false) },
      { label: "Interactive Mode", value: formatFeatureState(config.run?.interactive ?? true) },
    ]);

    pushSection(lines, "Limits", [
      { label: "Max iterations", value: String(config.maxIterations) },
      { label: "Iteration timeout", value: formatIterationTimeout(config.iterationTimeout) },
    ]);

    pushSection(lines, "Default review", [
      { label: "Mode", value: formatDefaultReview(config.defaultReview) },
    ]);

    if (config.retry) {
      pushSection(lines, "Retry", [
        { label: "Max retries", value: String(config.retry.maxRetries) },
        { label: "Base delay", value: `${config.retry.baseDelayMs} ms` },
        { label: "Max delay", value: `${config.retry.maxDelayMs} ms` },
      ]);
    }

    pushSection(lines, "Notifications", [
      { label: "Sound", value: formatFeatureState(config.notifications.sound.enabled) },
    ]);

    if (showMetadata) {
      pushSection(lines, "Metadata", [
        { label: "Schema", value: config.$schema },
        { label: "Version", value: String(config.version) },
      ]);
    }

    return lines;
  }

  const agentEntries: DisplayEntry[] = [];
  if (config.reviewer) {
    agentEntries.push({ label: "Reviewer", value: formatOverrideRoleSummary(config.reviewer) });
  }
  if (config.fixer) {
    agentEntries.push({ label: "Fixer", value: formatOverrideRoleSummary(config.fixer) });
  }
  if (config["code-simplifier"]) {
    agentEntries.push({
      label: "Simplifier",
      value: formatOverrideRoleSummary(config["code-simplifier"]),
    });
  }
  pushSection(lines, "Agents", agentEntries);

  const removedEntries: DisplayEntry[] = [];
  if (config["code-simplifier"] === null) {
    removedEntries.push({ label: "Simplifier", value: "removed" });
  }
  if (config.run === null) {
    removedEntries.push({ label: "Run", value: "removed" });
  }
  if (config.retry === null) {
    removedEntries.push({ label: "Retry", value: "removed" });
  }
  pushSection(lines, "Removed sections", removedEntries);

  const runEntries: DisplayEntry[] = [];
  if (config.run?.simplifier !== undefined) {
    runEntries.push({
      label: "Simplifier",
      value: formatFeatureState(config.run.simplifier),
    });
  }
  if (config.run?.interactive !== undefined) {
    runEntries.push({
      label: "Interactive Mode",
      value: formatFeatureState(config.run.interactive),
    });
  }
  pushSection(lines, "Run", runEntries);

  const limitEntries: DisplayEntry[] = [];
  if (config.maxIterations !== undefined) {
    limitEntries.push({ label: "Max iterations", value: String(config.maxIterations) });
  }
  if (config.iterationTimeout !== undefined) {
    limitEntries.push({
      label: "Iteration timeout",
      value: formatIterationTimeout(config.iterationTimeout),
    });
  }
  pushSection(lines, "Limits", limitEntries);

  if (config.defaultReview) {
    pushSection(lines, "Default review", [
      { label: "Mode", value: formatDefaultReview(config.defaultReview) },
    ]);
  }

  if (config.retry) {
    const retryEntries: DisplayEntry[] = [];
    if (config.retry.maxRetries !== undefined) {
      retryEntries.push({ label: "Max retries", value: String(config.retry.maxRetries) });
    }
    if (config.retry.baseDelayMs !== undefined) {
      retryEntries.push({ label: "Base delay", value: `${config.retry.baseDelayMs} ms` });
    }
    if (config.retry.maxDelayMs !== undefined) {
      retryEntries.push({ label: "Max delay", value: `${config.retry.maxDelayMs} ms` });
    }
    pushSection(lines, "Retry", retryEntries);
  }

  if (config.notifications?.sound?.enabled !== undefined) {
    pushSection(lines, "Notifications", [
      { label: "Sound", value: formatFeatureState(config.notifications.sound.enabled) },
    ]);
  }

  if (showMetadata) {
    const metadataEntries: DisplayEntry[] = [];
    if (config.$schema) {
      metadataEntries.push({ label: "Schema", value: config.$schema });
    }
    if (config.version !== undefined) {
      metadataEntries.push({ label: "Version", value: String(config.version) });
    }
    pushSection(lines, "Metadata", metadataEntries);
  }

  return lines;
}

function resolveReadableEmptyText(section: ReadableConfigSection): string {
  return (
    section.emptyText ?? (section.mode === "override" ? "No repo-local overrides." : "Not found.")
  );
}

export function formatConfigSection({
  title,
  path,
  note,
  config,
  errors = [],
  missingText = "Not found.",
}: ConfigSection): string {
  const lines = title ? [title] : [];

  if (path) {
    lines.push(`Path: ${formatDisplayPath(path)}`);
  }

  if (note) {
    lines.push(note);
  }

  if (errors.length > 0 && !config) {
    lines.push("Invalid configuration:");
    for (const error of errors) {
      lines.push(`- ${error}`);
    }
    return lines.join("\n");
  }

  if (!config) {
    lines.push(missingText);
    return lines.join("\n");
  }

  lines.push(JSON.stringify(config, null, 2));
  return lines.join("\n");
}

export function formatReadableConfigSection(section: ReadableConfigSection): string {
  const lines = section.title ? [section.title] : [];

  if (section.path) {
    lines.push(`Path: ${formatDisplayPath(section.path)}`);
  }

  if (section.note) {
    lines.push(section.note);
  }

  const bodyLines = formatReadableConfigBody(section);
  if (bodyLines.length === 0) {
    lines.push(resolveReadableEmptyText(section));
    return lines.join("\n");
  }

  if (lines.length > 0) {
    lines.push("");
  }

  return [...lines, ...bodyLines].join("\n");
}

function formatEffectiveSource(source: EffectiveConfigDiagnostics["source"]): string {
  switch (source) {
    case "merged":
      return "global + repo-local";
    case "local":
      return "repo-local only";
    case "global":
      return "global";
    default:
      return "none";
  }
}

export function formatConfigLayersDisplay(
  effective: EffectiveConfigDiagnostics,
  globalConfig: LoadedConfigDiagnostics,
  localConfig: LoadedConfigOverrideDiagnostics | null,
  options: FormatConfigLayersOptions = {}
): string {
  const effectiveConfig = effective.config ?? globalConfig.config;
  if (!effectiveConfig) {
    return formatConfigSection({
      title: "Effective config",
      path:
        effective.source === "local" && effective.localPath
          ? effective.localPath
          : effective.globalPath,
      config: null,
      errors: effective.errors,
    });
  }

  const sections = [
    formatReadableConfigSection({
      title: "Effective config",
      path:
        effective.source === "local" && effective.localPath
          ? effective.localPath
          : effective.globalPath,
      note: `Source: ${formatEffectiveSource(effective.source)}`,
      config: effectiveConfig,
      mode: "full",
      showMetadata: options.showMetadata,
    }),
  ];

  if (effective.localExists && effective.localPath) {
    sections.push(
      formatReadableConfigSection({
        title: "Repo-local overrides",
        path: effective.localPath,
        config: localConfig?.config ?? {},
        mode: "override",
        showMetadata: options.showMetadata,
      })
    );
  }

  return sections.join("\n\n");
}

export function formatConfigRawLayersDisplay(
  effective: EffectiveConfigDiagnostics,
  globalConfig: LoadedConfigDiagnostics,
  localConfig: LoadedConfigOverrideDiagnostics | null
): string {
  return JSON.stringify(
    {
      effective: effective.config ?? globalConfig.config ?? null,
      global: globalConfig.config ?? null,
      local: effective.localExists ? (localConfig?.config ?? null) : null,
    },
    null,
    2
  );
}
