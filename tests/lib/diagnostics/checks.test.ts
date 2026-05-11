import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDiagnostics } from "@/lib/diagnostics";
import { createCapabilities, createConfig } from "../../helpers/diagnostics";
import { runGitIn } from "../../helpers/git";

type DiagnosticsOptions = NonNullable<Parameters<typeof runDiagnostics>[1]>;

function runDiagnosticsWithDefaults(
  context: Parameters<typeof runDiagnostics>[0],
  options: DiagnosticsOptions = {}
) {
  return runDiagnostics(context, {
    capabilitiesByAgent: createCapabilities(),
    ...options,
    dependencies: {
      configExists: async () => true,
      loadConfig: async () => createConfig(),
      isGitRepository: async () => true,
      hasUncommittedChanges: async () => true,
      isTmuxInstalled: () => true,
      ...options.dependencies,
    },
  });
}

function createEffectiveConfigDiagnostics(
  overrides: Partial<ReturnType<typeof createDefaultEffectiveConfigDiagnostics>> = {}
) {
  return {
    ...createDefaultEffectiveConfigDiagnostics(),
    ...overrides,
  };
}

function createDefaultEffectiveConfigDiagnostics() {
  return {
    exists: true,
    config: null as ReturnType<typeof createConfig> | null,
    errors: [] as string[],
    source: "local" as "none" | "global" | "local" | "merged",
    globalPath: "/Users/test/.config/ralph-review/config.json",
    localPath: "/repo/.ralph-review/config.json",
    repoRoot: "/repo",
    globalExists: true,
    localExists: true,
    globalErrors: [] as string[],
    localErrors: [] as string[],
  };
}

function runRealGitDiagnostics(
  repoPath: string,
  options: Omit<DiagnosticsOptions, "capabilitiesByAgent" | "projectPath" | "dependencies"> & {
    dependencies?: DiagnosticsOptions["dependencies"];
  } = {}
) {
  return runDiagnostics("run", {
    ...options,
    capabilitiesByAgent: createCapabilities(),
    projectPath: repoPath,
    dependencies: {
      configExists: async () => true,
      loadConfig: async () => createConfig(),
      isTmuxInstalled: () => true,
      ...options.dependencies,
    },
  });
}

function runDiagnosticsWithEffectiveConfig(
  overrides: Parameters<typeof createEffectiveConfigDiagnostics>[0]
) {
  return runDiagnosticsWithDefaults("run", {
    projectPath: "/repo/project",
    dependencies: {
      loadEffectiveConfigWithDiagnostics: async () => createEffectiveConfigDiagnostics(overrides),
    },
  });
}

function findReportItem(report: Awaited<ReturnType<typeof runDiagnostics>>, id: string) {
  return report.items.find((item) => item.id === id);
}

function expectGlobalConfigInvalid(report: Awaited<ReturnType<typeof runDiagnostics>>) {
  const configItem = findReportItem(report, "config-invalid");
  expect(configItem?.severity).toBe("error");
  expect(configItem?.details).toContain("global config issue");
  expect(configItem?.details).not.toContain("repo-local config issue");
  expect(configItem?.context).toEqual({ configScope: "global" });
  return configItem;
}

async function runMissingReviewerModelDiagnostics(
  models: Array<{ model: string }>,
  model = "nonexistent-model"
) {
  const capabilities = createCapabilities();
  capabilities.opencode.models = models;

  const config = createConfig();
  config.reviewer = {
    agent: "opencode",
    model,
  };

  return runDiagnosticsWithDefaults("run", {
    capabilitiesByAgent: capabilities,
    dependencies: {
      loadConfig: async () => config,
    },
  });
}

describe("diagnostics checks", () => {
  test("reports missing config as error for run context", async () => {
    const report = await runDiagnosticsWithDefaults("run", {
      dependencies: {
        configExists: async () => false,
      },
    });

    const configItem = report.items.find((item) => item.id === "config-missing");
    expect(configItem?.severity).toBe("error");
    expect(configItem?.remediation[0]).toContain("rr init");
    expect(report.hasErrors).toBe(true);
  });

  test("reports missing config as warning for init context", async () => {
    const report = await runDiagnosticsWithDefaults("init", {
      dependencies: {
        configExists: async () => false,
      },
    });

    const configItem = report.items.find((item) => item.id === "config-missing");
    expect(configItem?.severity).toBe("warning");
    expect(report.hasErrors).toBe(false);
    expect(report.hasWarnings).toBe(true);
  });

  test("reports both valid config locations when no config file exists in a git repo", async () => {
    const report = await runDiagnosticsWithDefaults("run", {
      projectPath: "/repo/project",
      dependencies: {
        loadEffectiveConfigWithDiagnostics: async () => ({
          exists: false,
          config: null,
          errors: [],
          source: "none",
          globalPath: "/Users/test/.config/ralph-review/config.json",
          localPath: "/repo/.ralph-review/config.json",
          repoRoot: "/repo",
          globalExists: false,
          localExists: false,
          globalErrors: [],
          localErrors: [],
        }),
      },
    });

    const configItem = report.items.find((item) => item.id === "config-missing");
    expect(configItem?.details).toContain("/repo/.ralph-review/config.json");
    expect(configItem?.details).toContain("/Users/test/.config/ralph-review/config.json");
    expect(configItem?.details).not.toBe(
      "Expected /repo/.ralph-review/config.json in the project root."
    );
  });

  test("flags configured dynamic model that is not discovered", async () => {
    const report = await runMissingReviewerModelDiagnostics(
      [{ model: "gpt-5.2-codex" }],
      "model-not-found"
    );

    const missingModel = findReportItem(report, "config-reviewer-model-missing");
    expect(missingModel?.severity).toBe("error");
    expect(missingModel?.remediation.some((entry) => entry.includes("rr config set"))).toBe(true);
    expect(report.hasErrors).toBe(true);
  });

  test("reports invalid config as warning for init context", async () => {
    const report = await runDiagnosticsWithDefaults("init", {
      dependencies: {
        loadConfig: async () => null,
      },
    });

    const configItem = findReportItem(report, "config-invalid");
    expect(configItem?.severity).toBe("warning");
    expect(report.hasErrors).toBe(false);
    expect(report.hasWarnings).toBe(true);
  });

  test("reports invalid config as error for run context", async () => {
    const report = await runDiagnosticsWithDefaults("run", {
      dependencies: {
        loadConfig: async () => null,
      },
    });

    const configItem = findReportItem(report, "config-invalid");
    expect(configItem?.severity).toBe("error");
    expect(report.hasErrors).toBe(true);
  });

  test("reports repo-local config failures with source-aware details", async () => {
    const report = await runDiagnosticsWithEffectiveConfig({
      errors: [
        "Local config /repo/.ralph-review/config.json could not be parsed: Invalid JSON syntax: Unexpected token",
      ],
      localErrors: ["Invalid JSON syntax: Unexpected token"],
    });

    const configItem = findReportItem(report, "config-invalid");
    expect(configItem?.severity).toBe("error");
    expect(configItem?.details).toContain("/repo/.ralph-review/config.json");
    expect(configItem?.details).toContain("repo-local");
  });

  test("reports invalid global config as global even when a repo root is detected", async () => {
    const report = await runDiagnosticsWithEffectiveConfig({
      errors: [
        "Invalid global config at /Users/test/.config/ralph-review/config.json",
        "Invalid JSON syntax: Unexpected token",
      ],
      source: "global",
      localExists: false,
      globalErrors: ["Invalid JSON syntax: Unexpected token"],
    });

    const configItem = expectGlobalConfigInvalid(report);
    expect(configItem?.remediation).toEqual(["Run: rr init --global", "Then run: rr doctor --fix"]);
  });

  test("reports merged failures caused only by the global config as global", async () => {
    const report = await runDiagnosticsWithEffectiveConfig({
      errors: [
        "Effective configuration is invalid.",
        "Global config /Users/test/.config/ralph-review/config.json: Invalid JSON syntax: Unexpected token",
        "reviewer must be an object.",
      ],
      source: "merged",
      globalErrors: ["Invalid JSON syntax: Unexpected token"],
    });

    expectGlobalConfigInvalid(report);
  });

  test("downgrades hidden global config parse errors to a warning when an effective config is available", async () => {
    const report = await runDiagnosticsWithDefaults("run", {
      projectPath: "/repo/project",
      dependencies: {
        loadEffectiveConfigWithDiagnostics: async () =>
          createEffectiveConfigDiagnostics({
            config: createConfig(),
            errors: [
              "Invalid global config at /Users/test/.config/ralph-review/config.json: Invalid JSON syntax: Unexpected token",
            ],
            globalErrors: ["Invalid JSON syntax: Unexpected token"],
          }),
      },
    });

    const configItem = report.items.find((item) => item.id === "config-invalid");
    expect(configItem?.severity).toBe("warning");
    expect(configItem?.summary).toBe(
      "Global configuration is invalid, but repo-local config loaded successfully."
    );
    expect(configItem?.details).toContain("global config issue");
    expect(configItem?.context).toEqual({ configScope: "global" });
    expect(report.items.some((item) => item.id === "config-valid")).toBe(false);
    expect(report.hasErrors).toBe(false);
    expect(report.hasWarnings).toBe(true);
  });

  test("reports mixed global and repo-local config failures together", async () => {
    const report = await runDiagnosticsWithEffectiveConfig({
      errors: [
        "Invalid repo-local config at /repo/.ralph-review/config.json: Invalid JSON syntax: Unexpected token",
        "Invalid global config at /Users/test/.config/ralph-review/config.json: Invalid JSON syntax: Unexpected token",
      ],
      globalErrors: ["Invalid JSON syntax: Unexpected token"],
      localErrors: ["Invalid JSON syntax: Unexpected token"],
    });

    const configItem = report.items.find((item) => item.id === "config-invalid");
    expect(configItem?.severity).toBe("error");
    expect(configItem?.details).toContain("global and repo-local config issues");
    expect(configItem?.context).toEqual({ configScope: "mixed" });
    expect(configItem?.remediation).toEqual([
      "Run: rr init --global",
      "Run: rr init --local",
      "Then run: rr doctor --fix",
    ]);
  });

  test("downgrades role validation errors to warnings for init context", async () => {
    const capabilities = createCapabilities();
    capabilities.codex.installed = false;

    const report = await runDiagnosticsWithDefaults("init", {
      capabilitiesByAgent: capabilities,
    });

    const agentMissing = report.items.find((item) => item.id === "config-reviewer-agent-missing");
    expect(agentMissing?.severity).toBe("warning");
    expect(report.hasErrors).toBe(false);
  });

  test("reports role validation errors as errors for run context", async () => {
    const capabilities = createCapabilities();
    capabilities.codex.installed = false;

    const report = await runDiagnosticsWithDefaults("run", {
      capabilitiesByAgent: capabilities,
    });

    const agentMissing = report.items.find((item) => item.id === "config-reviewer-agent-missing");
    expect(agentMissing?.severity).toBe("error");
    expect(report.hasErrors).toBe(true);
  });

  test("reports no installed coding agents with remediation steps", async () => {
    const capabilities = createCapabilities();
    for (const capability of Object.values(capabilities)) {
      capability.installed = false;
    }

    const report = await runDiagnosticsWithDefaults("doctor", {
      capabilitiesByAgent: capabilities,
    });

    const item = report.items.find((diagnostic) => diagnostic.id === "agents-installed-count");
    expect(item?.severity).toBe("error");
    expect(item?.remediation).toContain(
      "Run: install at least one CLI: codex, claude, opencode, droid, gemini, or pi"
    );
    expect(item?.remediation).toContain("Then run: rr doctor");
  });

  test("reports invalid configured agent type", async () => {
    const config = createConfig();
    const invalidReviewer = { ...config.reviewer, agent: "invalid-agent" };
    config.reviewer = invalidReviewer as unknown as (typeof config)["reviewer"];

    const report = await runDiagnosticsWithDefaults("run", {
      dependencies: {
        loadConfig: async () => config,
      },
    });

    const invalidAgent = report.items.find((item) => item.id === "config-reviewer-agent-invalid");
    expect(invalidAgent?.severity).toBe("error");
    expect(invalidAgent?.summary).toContain("invalid");
  });

  test("reports pi settings invalid when provider or model are blank", async () => {
    const config = createConfig();
    config.reviewer = {
      agent: "pi",
      provider: " ",
      model: " ",
    };

    const report = await runDiagnosticsWithDefaults("run", {
      dependencies: {
        loadConfig: async () => config,
      },
    });

    const invalidPi = report.items.find((item) => item.id === "config-reviewer-pi-invalid");
    expect(invalidPi?.severity).toBe("error");
    expect(invalidPi?.summary).toContain("requires both provider and model");
  });

  test("fails run diagnostics when configured dynamic model cannot be verified", async () => {
    const capabilities = createCapabilities();
    capabilities.opencode.modelCatalogSource = "none";
    capabilities.opencode.models = [];
    capabilities.opencode.probeWarnings = ["opencode models failed"];

    const config = createConfig();
    config.reviewer = {
      agent: "opencode",
      model: "gpt-5.2-codex",
    };

    const report = await runDiagnosticsWithDefaults("run", {
      capabilitiesByAgent: capabilities,
      dependencies: {
        loadConfig: async () => config,
      },
    });

    const unverifiedModel = report.items.find(
      (item) => item.id === "config-reviewer-model-unverified"
    );
    expect(unverifiedModel?.severity).toBe("error");
    expect(unverifiedModel?.summary).toContain("could not be verified");
    expect(report.hasErrors).toBe(true);
  });

  test("reports matching dynamic model as available", async () => {
    const config = createConfig();
    config.reviewer = {
      agent: "opencode",
      model: "gpt-5.2-codex",
    };

    const report = await runDiagnosticsWithDefaults("run", {
      dependencies: {
        loadConfig: async () => config,
      },
    });

    const modelFound = report.items.find((item) => item.id === "config-reviewer-model-found");
    expect(modelFound?.severity).toBe("ok");
    expect(modelFound?.summary).toContain("available");
  });

  test("includes no-discovered-models details when dynamic lookup returns empty list", async () => {
    const report = await runMissingReviewerModelDiagnostics([]);

    const missingModel = findReportItem(report, "config-reviewer-model-missing");
    expect(missingModel?.details).toContain("No models found.");
  });

  test("reports git execution failures explicitly", async () => {
    const report = await runDiagnosticsWithDefaults("doctor", {
      dependencies: {
        isGitRepository: async () => {
          throw new Error("spawn git ENOENT");
        },
      },
    });

    const gitItem = report.items.find((item) => item.id === "git-repo");
    expect(gitItem?.severity).toBe("error");
    expect(gitItem?.summary).toBe("Unable to run git checks.");
    expect(gitItem?.details).toContain("spawn git ENOENT");
  });

  test("reports git uncommitted check failures explicitly", async () => {
    const report = await runDiagnosticsWithDefaults("run", {
      dependencies: {
        hasUncommittedChanges: async () => {
          throw new Error("git status failed");
        },
      },
    });

    const gitItem = report.items.find((item) => item.id === "git-uncommitted-check-failed");
    expect(gitItem?.severity).toBe("error");
    expect(gitItem?.details).toContain("git status failed");
    expect(gitItem?.remediation).toContain("Run: git status");
  });

  test("runs uncommitted checks when custom instructions are provided", async () => {
    let uncommittedChecks = 0;

    const report = await runDiagnosticsWithDefaults("run", {
      customInstructions: "focus on security",
      dependencies: {
        hasUncommittedChanges: async () => {
          uncommittedChecks += 1;
          return false;
        },
      },
    });

    expect(uncommittedChecks).toBe(1);
    const uncommittedItem = report.items.find((item) => item.id === "git-uncommitted");
    expect(uncommittedItem?.severity).toBe("error");
    expect(uncommittedItem?.summary).toBe("No uncommitted changes to review.");
    expect(report.hasErrors).toBe(true);
  });

  test("reports existing base ref as ok and skips uncommitted checks", async () => {
    let uncommittedChecks = 0;
    const checkedRefs: string[] = [];

    const report = await runDiagnosticsWithDefaults("run", {
      baseBranch: "origin/main",
      dependencies: {
        gitRefExists: async (_path, ref) => {
          checkedRefs.push(ref);
          return true;
        },
        hasUncommittedChanges: async () => {
          uncommittedChecks += 1;
          return true;
        },
      },
    });

    const baseRefItem = report.items.find((item) => item.id === "git-base-ref");
    expect(baseRefItem?.severity).toBe("ok");
    expect(baseRefItem?.summary).toContain("origin/main");
    expect(checkedRefs).toEqual(["origin/main"]);
    expect(uncommittedChecks).toBe(0);
    expect(report.items.find((item) => item.id === "git-uncommitted")).toBeUndefined();
  });

  test("reports missing base ref as error", async () => {
    const report = await runDiagnosticsWithDefaults("run", {
      baseBranch: "mian",
      dependencies: {
        gitRefExists: async () => false,
      },
    });

    const baseRefItem = report.items.find((item) => item.id === "git-base-ref");
    expect(baseRefItem?.severity).toBe("error");
    expect(baseRefItem?.summary).toContain("mian");
    expect(report.hasErrors).toBe(true);
  });

  test("reports blank base ref as missing using default git ref validation", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "diagnostics-checks-git-base-blank-"));
    try {
      runGitIn(repoPath, ["init"]);

      const report = await runRealGitDiagnostics(repoPath, {
        baseBranch: "   ",
      });

      const baseRefItem = report.items.find((item) => item.id === "git-base-ref");
      expect(baseRefItem?.severity).toBe("error");
      expect(baseRefItem?.summary).toContain("was not found");
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  });

  test("reports existing base ref as ok using default git ref validation", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "diagnostics-checks-git-base-head-"));
    try {
      runGitIn(repoPath, ["init"]);
      runGitIn(repoPath, ["config", "user.email", "ralph-review@example.com"]);
      runGitIn(repoPath, ["config", "user.name", "Ralph Review"]);
      await Bun.write(join(repoPath, "README.md"), "# test repo\n");
      runGitIn(repoPath, ["add", "README.md"]);
      runGitIn(repoPath, ["commit", "-m", "initial commit"]);

      const report = await runRealGitDiagnostics(repoPath, {
        baseBranch: "HEAD",
      });

      const baseRefItem = report.items.find((item) => item.id === "git-base-ref");
      expect(baseRefItem?.severity).toBe("ok");
      expect(baseRefItem?.summary).toContain("HEAD");
      expect(baseRefItem?.summary).toContain("exists");
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  });

  test("reports base ref validation errors explicitly", async () => {
    const report = await runDiagnosticsWithDefaults("run", {
      baseBranch: "origin/main",
      dependencies: {
        gitRefExists: async () => {
          throw new Error("base ref check failed");
        },
      },
    });

    const baseRefItem = report.items.find((item) => item.id === "git-base-ref");
    expect(baseRefItem?.severity).toBe("error");
    expect(baseRefItem?.summary).toContain("Unable to validate base ref");
    expect(baseRefItem?.details).toContain("base ref check failed");
    expect(baseRefItem?.remediation).toContain("Run: git branch --all");
    expect(baseRefItem?.remediation).toContain("Then run: rr run --base <existing-ref>");
  });

  test("reports existing commit ref as ok and skips uncommitted checks", async () => {
    let uncommittedChecks = 0;
    const checkedRefs: string[] = [];

    const report = await runDiagnosticsWithDefaults("run", {
      commitSha: "abc123",
      dependencies: {
        gitRefExists: async (_path, ref) => {
          checkedRefs.push(ref);
          return true;
        },
        hasUncommittedChanges: async () => {
          uncommittedChecks += 1;
          return true;
        },
      },
    });

    const commitRefItem = report.items.find((item) => item.id === "git-commit-ref");
    expect(commitRefItem?.severity).toBe("ok");
    expect(commitRefItem?.summary).toContain("abc123");
    expect(checkedRefs).toEqual(["abc123"]);
    expect(uncommittedChecks).toBe(0);
    expect(report.items.find((item) => item.id === "git-uncommitted")).toBeUndefined();
  });

  test("reports missing commit ref as error", async () => {
    const report = await runDiagnosticsWithDefaults("run", {
      commitSha: "does-not-exist",
      dependencies: {
        gitRefExists: async () => false,
      },
    });

    const commitRefItem = report.items.find((item) => item.id === "git-commit-ref");
    expect(commitRefItem?.severity).toBe("error");
    expect(commitRefItem?.summary).toContain("does-not-exist");
    expect(report.hasErrors).toBe(true);
  });

  test("reports commit ref validation errors explicitly", async () => {
    const report = await runDiagnosticsWithDefaults("run", {
      commitSha: "deadbeef",
      dependencies: {
        gitRefExists: async () => {
          throw new Error("commit ref check failed");
        },
      },
    });

    const commitRefItem = report.items.find((item) => item.id === "git-commit-ref");
    expect(commitRefItem?.severity).toBe("error");
    expect(commitRefItem?.summary).toContain("Unable to validate commit ref");
    expect(commitRefItem?.details).toContain("commit ref check failed");
    expect(commitRefItem?.remediation).toContain("Run: git rev-parse --verify <commit>");
    expect(commitRefItem?.remediation).toContain("Then run: rr run --commit <sha>");
  });

  test("uses default git checks to detect uncommitted changes", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "diagnostics-checks-git-"));
    try {
      runGitIn(repoPath, ["init"]);
      await Bun.write(join(repoPath, "draft.txt"), "draft changes");

      const report = await runRealGitDiagnostics(repoPath);

      const gitItem = report.items.find((item) => item.id === "git-uncommitted");
      expect(gitItem?.severity).toBe("ok");
      expect(gitItem?.summary).toBe("Uncommitted changes detected.");
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  });

  test("treats bare repositories as having no uncommitted changes", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "diagnostics-checks-git-bare-"));
    try {
      runGitIn(repoPath, ["init", "--bare"]);

      const report = await runRealGitDiagnostics(repoPath);

      const gitItem = report.items.find((item) => item.id === "git-uncommitted");
      expect(gitItem?.severity).toBe("error");
      expect(gitItem?.summary).toBe("No uncommitted changes to review.");
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  });

  test("keeps warnings non-blocking when no errors exist", async () => {
    const capabilities = createCapabilities();
    capabilities.opencode.probeWarnings = ["probe warning"];

    const report = await runDiagnosticsWithDefaults("run", {
      capabilitiesByAgent: capabilities,
      dependencies: {},
    });

    expect(report.hasErrors).toBe(false);
    expect(report.hasWarnings).toBe(true);
  });

  test("uses platform-aware tmux remediation via injected guidance", async () => {
    const report = await runDiagnosticsWithDefaults("doctor", {
      dependencies: {
        isTmuxInstalled: () => false,
        resolveTmuxInstallGuidance: () => ({
          commandArgs: ["sudo", "apt-get", "install", "-y", "tmux"],
          commandDisplay: "sudo apt-get install -y tmux",
          nextActions: ["Run: sudo apt-get install -y tmux", "Then run: rr doctor --fix"],
        }),
      },
    });

    const tmuxItem = report.items.find((item) => item.id === "tmux-installed");
    expect(tmuxItem?.remediation).toContain("Run: sudo apt-get install -y tmux");
    expect(tmuxItem?.remediation).toContain("Then run: rr doctor --fix");
  });

  test("marks expanded config diagnostics as fixable", async () => {
    const capabilities = createCapabilities();
    capabilities.codex.installed = false;

    const report = await runDiagnosticsWithDefaults("run", {
      capabilitiesByAgent: capabilities,
    });

    const missingAgent = report.items.find((item) => item.id === "config-reviewer-agent-missing");
    expect(missingAgent?.severity).toBe("error");
    expect(missingAgent?.fixable).toBe(true);
  });
});
