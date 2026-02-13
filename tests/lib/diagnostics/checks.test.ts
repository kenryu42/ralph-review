import { describe, expect, test } from "bun:test";
import { runDiagnostics } from "@/lib/diagnostics";
import { createCapabilities, createConfig } from "../../helpers/diagnostics";

describe("diagnostics checks", () => {
  test("reports missing config as error for run context", async () => {
    const report = await runDiagnostics("run", {
      capabilitiesByAgent: createCapabilities(),
      dependencies: {
        configExists: async () => false,
        isGitRepository: async () => true,
        hasUncommittedChanges: async () => true,
        cleanupStaleLockfile: async () => false,
        lockfileExists: async () => false,
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
        lockfileExists: async () => false,
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
        lockfileExists: async () => false,
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
        lockfileExists: async () => false,
        isTmuxInstalled: () => true,
      },
    });

    const agentMissing = report.items.find((item) => item.id === "config-reviewer-agent-missing");
    expect(agentMissing?.severity).toBe("error");
    expect(report.hasErrors).toBe(true);
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
        lockfileExists: async () => false,
        isTmuxInstalled: () => true,
      },
    });

    const simplifierMissing = report.items.find(
      (item) => item.id === "config-code-simplifier-agent-missing"
    );
    expect(simplifierMissing?.severity).toBe("warning");
    expect(report.hasErrors).toBe(false);
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
        lockfileExists: async () => false,
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
        lockfileExists: async () => false,
        isTmuxInstalled: () => true,
      },
    });

    expect(report.hasErrors).toBe(false);
    expect(report.hasWarnings).toBe(true);
  });
});
