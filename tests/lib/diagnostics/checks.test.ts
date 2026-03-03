import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDiagnostics } from "@/lib/diagnostics";
import { createCapabilities, createConfig } from "../../helpers/diagnostics";

function runGitIn(repoPath: string, args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: repoPath,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`);
  }
}

describe("diagnostics checks", () => {
  test("reports missing config as error for run context", async () => {
    const report = await runDiagnostics("run", {
      capabilitiesByAgent: createCapabilities(),
      dependencies: {
        configExists: async () => false,
        isGitRepository: async () => true,
        hasUncommittedChanges: async () => true,
        cleanupStaleLockfile: async () => false,
        hasActiveLockfile: async () => false,
        isTmuxInstalled: () => true,
      },
    });

    const configItem = report.items.find((item) => item.id === "config-missing");
    expect(configItem?.severity).toBe("error");
    expect(configItem?.remediation[0]).toContain("rr init");
    expect(report.hasErrors).toBe(true);
  });

  test("reports missing config as warning for init context", async () => {
    const report = await runDiagnostics("init", {
      capabilitiesByAgent: createCapabilities(),
      dependencies: {
        configExists: async () => false,
        isTmuxInstalled: () => true,
      },
    });

    const configItem = report.items.find((item) => item.id === "config-missing");
    expect(configItem?.severity).toBe("warning");
    expect(report.hasErrors).toBe(false);
    expect(report.hasWarnings).toBe(true);
  });

  test("flags configured dynamic model that is not discovered", async () => {
    const capabilities = createCapabilities();
    capabilities.opencode.models = [{ model: "gpt-5.2-codex" }];

    const config = createConfig();
    config.reviewer = {
      agent: "opencode",
      model: "model-not-found",
    };

    const report = await runDiagnostics("run", {
      capabilitiesByAgent: capabilities,
      dependencies: {
        configExists: async () => true,
        loadConfig: async () => config,
        isGitRepository: async () => true,
        hasUncommittedChanges: async () => true,
        cleanupStaleLockfile: async () => false,
        hasActiveLockfile: async () => false,
        isTmuxInstalled: () => true,
      },
    });

    const missingModel = report.items.find((item) => item.id === "config-reviewer-model-missing");
    expect(missingModel?.severity).toBe("error");
    expect(missingModel?.remediation.some((entry) => entry.includes("rr config set"))).toBe(true);
    expect(report.hasErrors).toBe(true);
  });

  test("reports invalid config as warning for init context", async () => {
    const report = await runDiagnostics("init", {
      capabilitiesByAgent: createCapabilities(),
      dependencies: {
        configExists: async () => true,
        loadConfig: async () => null,
        isTmuxInstalled: () => true,
      },
    });

    const configItem = report.items.find((item) => item.id === "config-invalid");
    expect(configItem?.severity).toBe("warning");
    expect(report.hasErrors).toBe(false);
    expect(report.hasWarnings).toBe(true);
  });

  test("reports invalid config as error for run context", async () => {
    const report = await runDiagnostics("run", {
      capabilitiesByAgent: createCapabilities(),
      dependencies: {
        configExists: async () => true,
        loadConfig: async () => null,
        isGitRepository: async () => true,
        hasUncommittedChanges: async () => true,
        cleanupStaleLockfile: async () => false,
        hasActiveLockfile: async () => false,
        isTmuxInstalled: () => true,
      },
    });

    const configItem = report.items.find((item) => item.id === "config-invalid");
    expect(configItem?.severity).toBe("error");
    expect(report.hasErrors).toBe(true);
  });

  test("downgrades role validation errors to warnings for init context", async () => {
    const capabilities = createCapabilities();
    capabilities.codex.installed = false;

    const report = await runDiagnostics("init", {
      capabilitiesByAgent: capabilities,
      dependencies: {
        configExists: async () => true,
        loadConfig: async () => createConfig(),
        isTmuxInstalled: () => true,
      },
    });

    const agentMissing = report.items.find((item) => item.id === "config-reviewer-agent-missing");
    expect(agentMissing?.severity).toBe("warning");
    expect(report.hasErrors).toBe(false);
  });

  test("reports role validation errors as errors for run context", async () => {
    const capabilities = createCapabilities();
    capabilities.codex.installed = false;

    const report = await runDiagnostics("run", {
      capabilitiesByAgent: capabilities,
      dependencies: {
        configExists: async () => true,
        loadConfig: async () => createConfig(),
        isGitRepository: async () => true,
        hasUncommittedChanges: async () => true,
        cleanupStaleLockfile: async () => false,
        hasActiveLockfile: async () => false,
        isTmuxInstalled: () => true,
      },
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

    const report = await runDiagnostics("doctor", {
      capabilitiesByAgent: capabilities,
      dependencies: {
        configExists: async () => true,
        loadConfig: async () => createConfig(),
        isGitRepository: async () => true,
        isTmuxInstalled: () => true,
      },
    });

    const item = report.items.find((diagnostic) => diagnostic.id === "agents-installed-count");
    expect(item?.severity).toBe("error");
    expect(item?.remediation).toContain(
      "Run: install at least one CLI: codex, claude, opencode, droid, gemini, or pi"
    );
    expect(item?.remediation).toContain("Then run: rr doctor");
  });

  test("keeps simplifier validation as warning for doctor context", async () => {
    const capabilities = createCapabilities();
    capabilities.droid.installed = false;

    const report = await runDiagnostics("doctor", {
      capabilitiesByAgent: capabilities,
      dependencies: {
        configExists: async () => true,
        loadConfig: async () => createConfig(),
        isGitRepository: async () => true,
        isTmuxInstalled: () => true,
      },
    });

    const simplifierMissing = report.items.find(
      (item) => item.id === "config-code-simplifier-agent-missing"
    );
    expect(simplifierMissing?.severity).toBe("warning");
    expect(report.hasErrors).toBe(false);
  });

  test("skips code-simplifier validation when that role is not configured", async () => {
    const capabilities = createCapabilities();
    capabilities.droid.installed = false;

    const config = createConfig();
    delete config["code-simplifier"];

    const report = await runDiagnostics("run", {
      capabilitiesByAgent: capabilities,
      dependencies: {
        configExists: async () => true,
        loadConfig: async () => config,
        isGitRepository: async () => true,
        hasUncommittedChanges: async () => true,
        cleanupStaleLockfile: async () => false,
        hasActiveLockfile: async () => false,
        isTmuxInstalled: () => true,
      },
    });

    expect(report.items.some((item) => item.id.startsWith("config-code-simplifier-"))).toBe(false);
  });

  test("downgrades simplifier validation to warning for run context", async () => {
    const capabilities = createCapabilities();
    capabilities.droid.installed = false;

    const report = await runDiagnostics("run", {
      capabilitiesByAgent: capabilities,
      dependencies: {
        configExists: async () => true,
        loadConfig: async () => createConfig(),
        isGitRepository: async () => true,
        hasUncommittedChanges: async () => true,
        cleanupStaleLockfile: async () => false,
        hasActiveLockfile: async () => false,
        isTmuxInstalled: () => true,
      },
    });

    const simplifierMissing = report.items.find(
      (item) => item.id === "config-code-simplifier-agent-missing"
    );
    expect(simplifierMissing?.severity).toBe("warning");
    expect(report.hasErrors).toBe(false);
  });

  test("reports invalid configured agent type", async () => {
    const config = createConfig();
    const invalidReviewer = { ...config.reviewer, agent: "invalid-agent" };
    config.reviewer = invalidReviewer as unknown as (typeof config)["reviewer"];

    const report = await runDiagnostics("run", {
      capabilitiesByAgent: createCapabilities(),
      dependencies: {
        configExists: async () => true,
        loadConfig: async () => config,
        isGitRepository: async () => true,
        hasUncommittedChanges: async () => true,
        cleanupStaleLockfile: async () => false,
        hasActiveLockfile: async () => false,
        isTmuxInstalled: () => true,
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

    const report = await runDiagnostics("run", {
      capabilitiesByAgent: createCapabilities(),
      dependencies: {
        configExists: async () => true,
        loadConfig: async () => config,
        isGitRepository: async () => true,
        hasUncommittedChanges: async () => true,
        cleanupStaleLockfile: async () => false,
        hasActiveLockfile: async () => false,
        isTmuxInstalled: () => true,
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

    const report = await runDiagnostics("run", {
      capabilitiesByAgent: capabilities,
      dependencies: {
        configExists: async () => true,
        loadConfig: async () => config,
        isGitRepository: async () => true,
        hasUncommittedChanges: async () => true,
        cleanupStaleLockfile: async () => false,
        hasActiveLockfile: async () => false,
        isTmuxInstalled: () => true,
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

    const report = await runDiagnostics("run", {
      capabilitiesByAgent: createCapabilities(),
      dependencies: {
        configExists: async () => true,
        loadConfig: async () => config,
        isGitRepository: async () => true,
        hasUncommittedChanges: async () => true,
        cleanupStaleLockfile: async () => false,
        hasActiveLockfile: async () => false,
        isTmuxInstalled: () => true,
      },
    });

    const modelFound = report.items.find((item) => item.id === "config-reviewer-model-found");
    expect(modelFound?.severity).toBe("ok");
    expect(modelFound?.summary).toContain("available");
  });

  test("includes no-discovered-models details when dynamic lookup returns empty list", async () => {
    const capabilities = createCapabilities();
    capabilities.opencode.models = [];

    const config = createConfig();
    config.reviewer = {
      agent: "opencode",
      model: "nonexistent-model",
    };

    const report = await runDiagnostics("run", {
      capabilitiesByAgent: capabilities,
      dependencies: {
        configExists: async () => true,
        loadConfig: async () => config,
        isGitRepository: async () => true,
        hasUncommittedChanges: async () => true,
        cleanupStaleLockfile: async () => false,
        hasActiveLockfile: async () => false,
        isTmuxInstalled: () => true,
      },
    });

    const missingModel = report.items.find((item) => item.id === "config-reviewer-model-missing");
    expect(missingModel?.details).toContain("No models discovered.");
  });

  test("reports git execution failures explicitly", async () => {
    const report = await runDiagnostics("doctor", {
      capabilitiesByAgent: createCapabilities(),
      dependencies: {
        configExists: async () => true,
        loadConfig: async () => createConfig(),
        isGitRepository: async () => {
          throw new Error("spawn git ENOENT");
        },
        isTmuxInstalled: () => true,
      },
    });

    const gitItem = report.items.find((item) => item.id === "git-repo");
    expect(gitItem?.severity).toBe("error");
    expect(gitItem?.summary).toBe("Unable to run git checks.");
    expect(gitItem?.details).toContain("spawn git ENOENT");
  });

  test("reports git uncommitted check failures explicitly", async () => {
    const report = await runDiagnostics("run", {
      capabilitiesByAgent: createCapabilities(),
      dependencies: {
        configExists: async () => true,
        loadConfig: async () => createConfig(),
        isGitRepository: async () => true,
        hasUncommittedChanges: async () => {
          throw new Error("git status failed");
        },
        cleanupStaleLockfile: async () => false,
        hasActiveLockfile: async () => false,
        isTmuxInstalled: () => true,
      },
    });

    const gitItem = report.items.find((item) => item.id === "git-uncommitted-check-failed");
    expect(gitItem?.severity).toBe("error");
    expect(gitItem?.details).toContain("git status failed");
    expect(gitItem?.remediation).toContain("Run: git status");
  });

  test("runs uncommitted checks when custom instructions are provided", async () => {
    let uncommittedChecks = 0;

    const report = await runDiagnostics("run", {
      customInstructions: "focus on security",
      capabilitiesByAgent: createCapabilities(),
      dependencies: {
        configExists: async () => true,
        loadConfig: async () => createConfig(),
        isGitRepository: async () => true,
        hasUncommittedChanges: async () => {
          uncommittedChecks += 1;
          return false;
        },
        cleanupStaleLockfile: async () => false,
        hasActiveLockfile: async () => false,
        isTmuxInstalled: () => true,
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

    const report = await runDiagnostics("run", {
      baseBranch: "origin/main",
      capabilitiesByAgent: createCapabilities(),
      dependencies: {
        configExists: async () => true,
        loadConfig: async () => createConfig(),
        isGitRepository: async () => true,
        gitRefExists: async (_path, ref) => {
          checkedRefs.push(ref);
          return true;
        },
        hasUncommittedChanges: async () => {
          uncommittedChecks += 1;
          return true;
        },
        cleanupStaleLockfile: async () => false,
        hasActiveLockfile: async () => false,
        isTmuxInstalled: () => true,
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
    const report = await runDiagnostics("run", {
      baseBranch: "mian",
      capabilitiesByAgent: createCapabilities(),
      dependencies: {
        configExists: async () => true,
        loadConfig: async () => createConfig(),
        isGitRepository: async () => true,
        gitRefExists: async () => false,
        cleanupStaleLockfile: async () => false,
        hasActiveLockfile: async () => false,
        isTmuxInstalled: () => true,
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

      const report = await runDiagnostics("run", {
        baseBranch: "   ",
        capabilitiesByAgent: createCapabilities(),
        projectPath: repoPath,
        dependencies: {
          configExists: async () => true,
          loadConfig: async () => createConfig(),
          cleanupStaleLockfile: async () => false,
          hasActiveLockfile: async () => false,
          isTmuxInstalled: () => true,
        },
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

      const report = await runDiagnostics("run", {
        baseBranch: "HEAD",
        capabilitiesByAgent: createCapabilities(),
        projectPath: repoPath,
        dependencies: {
          configExists: async () => true,
          loadConfig: async () => createConfig(),
          cleanupStaleLockfile: async () => false,
          hasActiveLockfile: async () => false,
          isTmuxInstalled: () => true,
        },
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
    const report = await runDiagnostics("run", {
      baseBranch: "origin/main",
      capabilitiesByAgent: createCapabilities(),
      dependencies: {
        configExists: async () => true,
        loadConfig: async () => createConfig(),
        isGitRepository: async () => true,
        gitRefExists: async () => {
          throw new Error("base ref check failed");
        },
        cleanupStaleLockfile: async () => false,
        hasActiveLockfile: async () => false,
        isTmuxInstalled: () => true,
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

    const report = await runDiagnostics("run", {
      commitSha: "abc123",
      capabilitiesByAgent: createCapabilities(),
      dependencies: {
        configExists: async () => true,
        loadConfig: async () => createConfig(),
        isGitRepository: async () => true,
        gitRefExists: async (_path, ref) => {
          checkedRefs.push(ref);
          return true;
        },
        hasUncommittedChanges: async () => {
          uncommittedChecks += 1;
          return true;
        },
        cleanupStaleLockfile: async () => false,
        hasActiveLockfile: async () => false,
        isTmuxInstalled: () => true,
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
    const report = await runDiagnostics("run", {
      commitSha: "does-not-exist",
      capabilitiesByAgent: createCapabilities(),
      dependencies: {
        configExists: async () => true,
        loadConfig: async () => createConfig(),
        isGitRepository: async () => true,
        gitRefExists: async () => false,
        cleanupStaleLockfile: async () => false,
        hasActiveLockfile: async () => false,
        isTmuxInstalled: () => true,
      },
    });

    const commitRefItem = report.items.find((item) => item.id === "git-commit-ref");
    expect(commitRefItem?.severity).toBe("error");
    expect(commitRefItem?.summary).toContain("does-not-exist");
    expect(report.hasErrors).toBe(true);
  });

  test("reports commit ref validation errors explicitly", async () => {
    const report = await runDiagnostics("run", {
      commitSha: "deadbeef",
      capabilitiesByAgent: createCapabilities(),
      dependencies: {
        configExists: async () => true,
        loadConfig: async () => createConfig(),
        isGitRepository: async () => true,
        gitRefExists: async () => {
          throw new Error("commit ref check failed");
        },
        cleanupStaleLockfile: async () => false,
        hasActiveLockfile: async () => false,
        isTmuxInstalled: () => true,
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

      const report = await runDiagnostics("run", {
        capabilitiesByAgent: createCapabilities(),
        projectPath: repoPath,
        dependencies: {
          configExists: async () => true,
          loadConfig: async () => createConfig(),
          cleanupStaleLockfile: async () => false,
          hasActiveLockfile: async () => false,
          isTmuxInstalled: () => true,
        },
      });

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

      const report = await runDiagnostics("run", {
        capabilitiesByAgent: createCapabilities(),
        projectPath: repoPath,
        dependencies: {
          configExists: async () => true,
          loadConfig: async () => createConfig(),
          cleanupStaleLockfile: async () => false,
          hasActiveLockfile: async () => false,
          isTmuxInstalled: () => true,
        },
      });

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

    const report = await runDiagnostics("run", {
      capabilitiesByAgent: capabilities,
      dependencies: {
        configExists: async () => true,
        loadConfig: async () => createConfig(),
        isGitRepository: async () => true,
        hasUncommittedChanges: async () => true,
        cleanupStaleLockfile: async () => false,
        hasActiveLockfile: async () => false,
        isTmuxInstalled: () => true,
      },
    });

    expect(report.hasErrors).toBe(false);
    expect(report.hasWarnings).toBe(true);
  });

  test("marks run-lockfile as fixable when an active review lock is present", async () => {
    const report = await runDiagnostics("run", {
      capabilitiesByAgent: createCapabilities(),
      dependencies: {
        configExists: async () => true,
        loadConfig: async () => createConfig(),
        isGitRepository: async () => true,
        hasUncommittedChanges: async () => true,
        cleanupStaleLockfile: async () => false,
        hasActiveLockfile: async () => true,
        isTmuxInstalled: () => true,
      },
    });

    const lockItem = report.items.find((item) => item.id === "run-lockfile");
    expect(lockItem?.severity).toBe("error");
    expect(lockItem?.fixable).toBe(true);
    expect(lockItem?.remediation).toContain("Then run: rr run");
  });

  test("uses platform-aware tmux remediation via injected guidance", async () => {
    const report = await runDiagnostics("doctor", {
      capabilitiesByAgent: createCapabilities(),
      dependencies: {
        configExists: async () => true,
        loadConfig: async () => createConfig(),
        isGitRepository: async () => true,
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

    const report = await runDiagnostics("run", {
      capabilitiesByAgent: capabilities,
      dependencies: {
        configExists: async () => true,
        loadConfig: async () => createConfig(),
        isGitRepository: async () => true,
        hasUncommittedChanges: async () => true,
        cleanupStaleLockfile: async () => false,
        hasActiveLockfile: async () => false,
        isTmuxInstalled: () => true,
      },
    });

    const missingAgent = report.items.find((item) => item.id === "config-reviewer-agent-missing");
    expect(missingAgent?.severity).toBe("error");
    expect(missingAgent?.fixable).toBe(true);
  });
});
