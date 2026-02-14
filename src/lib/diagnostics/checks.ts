import { configExists, loadConfig } from "@/lib/config";
import { cleanupStaleLockfile, hasActiveLockfile } from "@/lib/lockfile";
import { isTmuxInstalled } from "@/lib/tmux";
import { type AgentSettings, type Config, isAgentType } from "@/lib/types";
import { type CapabilityDiscoveryOptions, discoverAgentCapabilities } from "./capabilities";
import { isFixable } from "./remediation";
import { resolveTmuxInstallGuidance } from "./tmux-install";
import type {
  AgentCapabilitiesMap,
  DiagnosticContext,
  DiagnosticItem,
  DiagnosticsReport,
} from "./types";

interface RunDiagnosticsDependencies {
  configExists?: typeof configExists;
  loadConfig?: typeof loadConfig;
  discoverAgentCapabilities?: (
    options?: CapabilityDiscoveryOptions
  ) => Promise<AgentCapabilitiesMap>;
  isGitRepository?: (path: string) => Promise<boolean>;
  hasUncommittedChanges?: (path: string) => Promise<boolean>;
  cleanupStaleLockfile?: typeof cleanupStaleLockfile;
  hasActiveLockfile?: typeof hasActiveLockfile;
  isTmuxInstalled?: () => boolean;
  resolveTmuxInstallGuidance?: (
    options?: Parameters<typeof resolveTmuxInstallGuidance>[0]
  ) => ReturnType<typeof resolveTmuxInstallGuidance>;
  platform?: NodeJS.Platform;
  which?: (command: string) => string | null;
}

export interface RunDiagnosticsOptions {
  projectPath?: string;
  baseBranch?: string;
  commitSha?: string;
  capabilitiesByAgent?: AgentCapabilitiesMap;
  capabilityDiscoveryOptions?: CapabilityDiscoveryOptions;
  dependencies?: RunDiagnosticsDependencies;
}

const ROLE_ORDER = ["reviewer", "fixer", "code-simplifier"] as const;

type ConfiguredRole = (typeof ROLE_ORDER)[number];

function runStep(command: string): string {
  return `Run: ${command}`;
}

function thenStep(command: string): string {
  return `Then run: ${command}`;
}

function getRoleSeverity(context: DiagnosticContext, role: ConfiguredRole): "warning" | "error" {
  if (context === "init") {
    return "warning";
  }

  if (role === "code-simplifier") {
    return "warning";
  }

  return "error";
}

function getRoleLabel(role: ConfiguredRole): string {
  if (role === "code-simplifier") {
    return "Code simplifier";
  }

  return role === "reviewer" ? "Reviewer" : "Fixer";
}

function normalizeModelId(model: string): string {
  return model.trim().toLowerCase();
}

function modelMatches(
  settings: AgentSettings,
  candidate: { model: string; provider?: string }
): boolean {
  if (settings.agent === "pi") {
    return (
      normalizeModelId(settings.model) === normalizeModelId(candidate.model) &&
      normalizeModelId(settings.provider) === normalizeModelId(candidate.provider ?? "")
    );
  }

  return normalizeModelId(settings.model ?? "") === normalizeModelId(candidate.model);
}

function summarizeAvailableModels(
  settings: AgentSettings,
  capabilities: AgentCapabilitiesMap
): string {
  const capability = capabilities[settings.agent];
  if (!capability || capability.models.length === 0) {
    return "No models discovered.";
  }

  const topModels = capability.models.slice(0, 5).map((entry) => {
    if (settings.agent === "pi") {
      return `${entry.provider}/${entry.model}`;
    }
    return entry.model;
  });

  return topModels.join(", ");
}

async function runGitInPath(
  path: string,
  args: string[]
): Promise<{ exitCode: number; stdout: string }> {
  const proc = Bun.spawn(["git", ...args], {
    cwd: path,
    stdout: "pipe",
    stderr: "ignore",
  });

  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { exitCode, stdout };
}

async function isGitRepository(path: string): Promise<boolean> {
  const result = await runGitInPath(path, ["rev-parse", "--git-dir"]);
  return result.exitCode === 0;
}

async function hasGitUncommittedChanges(path: string): Promise<boolean> {
  const result = await runGitInPath(path, ["status", "--porcelain"]);
  if (result.exitCode !== 0) {
    return false;
  }
  return result.stdout.trim().length > 0;
}

function buildReport(
  context: DiagnosticContext,
  items: DiagnosticItem[],
  capabilitiesByAgent: AgentCapabilitiesMap,
  config: Config | null
): DiagnosticsReport {
  return {
    context,
    items,
    hasErrors: items.some((item) => item.severity === "error"),
    hasWarnings: items.some((item) => item.severity === "warning"),
    capabilitiesByAgent,
    generatedAt: new Date().toISOString(),
    config,
  };
}

export async function runDiagnostics(
  context: DiagnosticContext,
  options: RunDiagnosticsOptions = {}
): Promise<DiagnosticsReport> {
  const projectPath = options.projectPath ?? process.cwd();
  const deps = options.dependencies ?? {};

  const resolveConfigExists = deps.configExists ?? configExists;
  const resolveLoadConfig = deps.loadConfig ?? loadConfig;
  const resolveCapabilityDiscovery = deps.discoverAgentCapabilities ?? discoverAgentCapabilities;
  const resolveIsGitRepo = deps.isGitRepository ?? isGitRepository;
  const resolveHasChanges = deps.hasUncommittedChanges ?? hasGitUncommittedChanges;
  const resolveCleanupStaleLockfile = deps.cleanupStaleLockfile ?? cleanupStaleLockfile;
  const resolveHasActiveLockfile = deps.hasActiveLockfile ?? hasActiveLockfile;
  const resolveIsTmuxInstalled = deps.isTmuxInstalled ?? isTmuxInstalled;
  const resolveTmuxGuidance = deps.resolveTmuxInstallGuidance ?? resolveTmuxInstallGuidance;
  const tmuxGuidance = resolveTmuxGuidance({
    platform: deps.platform ?? process.platform,
    which: deps.which ?? Bun.which,
    recheckCommand: "rr doctor --fix",
  });

  const capabilitiesByAgent =
    options.capabilitiesByAgent ??
    (await resolveCapabilityDiscovery(options.capabilityDiscoveryOptions));

  const items: DiagnosticItem[] = [];

  for (const capability of Object.values(capabilitiesByAgent)) {
    items.push({
      id: `agent-${capability.agent}-binary`,
      category: "agents",
      title: `${capability.agent} binary`,
      severity: "ok",
      summary: capability.installed
        ? `Command '${capability.command}' is installed.`
        : `Command '${capability.command}' is not installed (optional unless configured).`,
      remediation: [],
      context: {
        agent: capability.agent,
        installed: capability.installed,
      },
    });

    if (capability.installed && capability.probeWarnings.length > 0) {
      items.push({
        id: `agent-${capability.agent}-probe`,
        category: "agents",
        title: `${capability.agent} capability probe`,
        severity: "warning",
        summary: "Model discovery probe returned warnings.",
        details: capability.probeWarnings.join("\n"),
        remediation: [
          runStep(`${capability.command} --help`),
          thenStep("rr doctor"),
          runStep("rr init (if model discovery warnings persist)"),
        ],
      });
    }
  }

  const installedAgentCount = Object.values(capabilitiesByAgent).filter(
    (entry) => entry.installed
  ).length;
  items.push({
    id: "agents-installed-count",
    category: "agents",
    title: "Installed coding agents",
    severity: installedAgentCount > 0 ? "ok" : "error",
    summary:
      installedAgentCount > 0
        ? `Detected ${installedAgentCount} installed coding agent${installedAgentCount === 1 ? "" : "s"}.`
        : "No supported coding agent CLI was detected.",
    remediation:
      installedAgentCount > 0
        ? []
        : [
            runStep("install at least one CLI: codex, claude, opencode, droid, gemini, or pi"),
            thenStep("rr doctor"),
          ],
  });

  const hasConfigFile = await resolveConfigExists();
  let config: Config | null = null;

  if (!hasConfigFile) {
    items.push({
      id: "config-missing",
      category: "config",
      title: "Configuration file",
      severity: context === "init" ? "warning" : "error",
      summary: "Configuration file was not found.",
      remediation:
        context === "init"
          ? [runStep("rr init"), thenStep("rr doctor")]
          : [runStep("rr init"), thenStep("rr doctor --fix")],
      fixable: isFixable("config-missing"),
    });
  } else {
    config = await resolveLoadConfig();
    if (!config) {
      items.push({
        id: "config-invalid",
        category: "config",
        title: "Configuration file",
        severity: context === "init" ? "warning" : "error",
        summary: "Configuration exists but could not be parsed.",
        remediation: [runStep("rr init"), thenStep("rr doctor --fix")],
        fixable: isFixable("config-invalid"),
      });
    } else {
      items.push({
        id: "config-valid",
        category: "config",
        title: "Configuration file",
        severity: "ok",
        summary: "Configuration loaded successfully.",
        remediation: [],
      });
    }
  }

  if (config) {
    for (const role of ROLE_ORDER) {
      const roleSeverity = getRoleSeverity(context, role);
      const settings = config[role];
      if (!settings) {
        continue;
      }

      const roleLabel = getRoleLabel(role);
      if (!isAgentType(settings.agent)) {
        const id = `config-${role}-agent-invalid`;
        items.push({
          id,
          category: "config",
          title: `${roleLabel} agent`,
          severity: roleSeverity,
          summary: `Configured ${roleLabel.toLowerCase()} agent is invalid.`,
          remediation: [runStep("rr init"), thenStep("rr doctor --fix")],
          fixable: isFixable(id),
        });
        continue;
      }

      const capability = capabilitiesByAgent[settings.agent];
      if (!capability.installed) {
        const id = `config-${role}-agent-missing`;
        items.push({
          id,
          category: "config",
          title: `${roleLabel} agent binary`,
          severity: roleSeverity,
          summary: `${roleLabel} agent '${settings.agent}' is configured but not installed.`,
          remediation: [
            runStep(`install '${capability.command}'`),
            runStep("rr init (to choose a different agent)"),
            thenStep("rr doctor --fix"),
          ],
          fixable: isFixable(id),
        });
      }

      if (settings.agent === "pi" && (!settings.provider?.trim() || !settings.model?.trim())) {
        const id = `config-${role}-pi-invalid`;
        items.push({
          id,
          category: "config",
          title: `${roleLabel} Pi settings`,
          severity: roleSeverity,
          summary: "Pi agent requires both provider and model.",
          remediation: [runStep("rr init"), thenStep("rr doctor --fix")],
          fixable: isFixable(id),
        });
      }

      if (capability.modelCatalogSource === "dynamic" && settings.model) {
        const found = capability.models.some((entry) => modelMatches(settings, entry));
        if (!found) {
          const configuredModel =
            settings.agent === "pi" ? `${settings.provider}/${settings.model}` : settings.model;
          const id = `config-${role}-model-missing`;
          items.push({
            id,
            category: "config",
            title: `${roleLabel} model availability`,
            severity: roleSeverity,
            summary: `Configured model '${configuredModel}' was not found in live discovery.`,
            details: `Discovered models: ${summarizeAvailableModels(settings, capabilitiesByAgent)}`,
            remediation: [
              runStep("rr init"),
              runStep(`rr config set ${role}.model <model>`),
              thenStep("rr doctor --fix"),
            ],
            fixable: isFixable(id),
          });
        } else {
          items.push({
            id: `config-${role}-model-found`,
            category: "config",
            title: `${roleLabel} model availability`,
            severity: "ok",
            summary: "Configured model is available in live discovery.",
            remediation: [],
          });
        }
      } else if (
        capability.installed &&
        capability.modelCatalogSource === "none" &&
        settings.model &&
        capability.probeWarnings.length > 0 &&
        (settings.agent === "opencode" || settings.agent === "pi")
      ) {
        const configuredModel =
          settings.agent === "pi" ? `${settings.provider}/${settings.model}` : settings.model;
        const probeCommand = settings.agent === "opencode" ? "opencode models" : "pi --list-models";
        const id = `config-${role}-model-unverified`;
        items.push({
          id,
          category: "config",
          title: `${roleLabel} model verification`,
          severity: roleSeverity,
          summary: `Configured model '${configuredModel}' could not be verified because live model discovery failed.`,
          details: capability.probeWarnings.join("\n"),
          remediation: [
            runStep(probeCommand),
            thenStep("rr doctor"),
            runStep("rr init (if model discovery keeps failing)"),
          ],
          fixable: isFixable(id),
        });
      }
    }
  }

  if (context === "doctor" || context === "run") {
    let insideGitRepo = false;
    let gitRepoError: string | null = null;
    try {
      insideGitRepo = await resolveIsGitRepo(projectPath);
    } catch (error) {
      gitRepoError = `${error}`;
    }

    if (gitRepoError) {
      items.push({
        id: "git-repo",
        category: "git",
        title: "Git repository",
        severity: "error",
        summary: "Unable to run git checks.",
        details: gitRepoError,
        remediation: [runStep("install git and ensure it is on PATH"), thenStep("rr doctor")],
      });
    } else {
      items.push({
        id: "git-repo",
        category: "git",
        title: "Git repository",
        severity: insideGitRepo ? "ok" : "error",
        summary: insideGitRepo
          ? "Current directory is a git repository."
          : "Current directory is not a git repository.",
        remediation: insideGitRepo
          ? []
          : [runStep("cd <your-git-repository>"), thenStep("rr doctor")],
      });
    }

    if (context === "run") {
      if (!options.baseBranch && !options.commitSha && insideGitRepo && !gitRepoError) {
        let hasChanges = false;
        let hasChangesError: string | null = null;
        try {
          hasChanges = await resolveHasChanges(projectPath);
        } catch (error) {
          hasChangesError = `${error}`;
        }

        if (hasChangesError) {
          items.push({
            id: "git-uncommitted-check-failed",
            category: "git",
            title: "Uncommitted changes",
            severity: "error",
            summary: "Unable to check uncommitted changes.",
            details: hasChangesError,
            remediation: [
              runStep("git status"),
              runStep("install git and ensure it is on PATH if git status fails"),
              thenStep("rr run"),
            ],
          });
        } else {
          items.push({
            id: "git-uncommitted",
            category: "git",
            title: "Uncommitted changes",
            severity: hasChanges ? "ok" : "error",
            summary: hasChanges
              ? "Uncommitted changes detected."
              : "No uncommitted changes to review.",
            remediation: hasChanges
              ? []
              : [runStep("modify files or create a commit"), thenStep("rr run")],
          });
        }
      }

      await resolveCleanupStaleLockfile(undefined, projectPath);
      const hasRunningReview = await resolveHasActiveLockfile(undefined, projectPath);
      items.push({
        id: "run-lockfile",
        category: "environment",
        title: "Review lock",
        severity: hasRunningReview ? "error" : "ok",
        summary: hasRunningReview
          ? "A review is already running for this project."
          : "No running review lock detected.",
        remediation: hasRunningReview
          ? [runStep("rr status"), runStep("rr stop"), thenStep("rr run")]
          : [],
        fixable: hasRunningReview && isFixable("run-lockfile"),
      });
    }
  }

  const tmuxInstalled = resolveIsTmuxInstalled();
  const tmuxSeverity = tmuxInstalled ? "ok" : context === "init" ? "warning" : "error";
  items.push({
    id: "tmux-installed",
    category: "tmux",
    title: "tmux availability",
    severity: tmuxSeverity,
    summary: tmuxInstalled ? "tmux is installed." : "tmux is not installed.",
    remediation: tmuxInstalled ? [] : tmuxGuidance.nextActions,
    fixable: !tmuxInstalled && isFixable("tmux-installed"),
  });

  return buildReport(context, items, capabilitiesByAgent, config);
}
