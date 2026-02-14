import { describe, expect, test } from "bun:test";
import { runDoctor } from "@/commands/doctor";
import type { FixResult } from "@/lib/diagnostics/remediation";
import type { DiagnosticItem, DiagnosticsReport } from "@/lib/diagnostics/types";
import { createCapabilities } from "../helpers/diagnostics";

function createReport(items: DiagnosticItem[]): DiagnosticsReport {
  return {
    context: "doctor",
    items,
    hasErrors: items.some((item) => item.severity === "error"),
    hasWarnings: items.some((item) => item.severity === "warning"),
    capabilitiesByAgent: createCapabilities(),
    generatedAt: new Date().toISOString(),
    config: null,
  };
}

function createRuntime(report: DiagnosticsReport) {
  const intros: string[] = [];
  const notes: { body: string; title: string }[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const successes: string[] = [];
  const infos: string[] = [];
  const steps: string[] = [];
  const exits: number[] = [];
  const spinnerStarts: string[] = [];
  const spinnerStops: string[] = [];
  const fixedItems: DiagnosticItem[][] = [];

  return {
    intros,
    notes,
    errors,
    warnings,
    successes,
    infos,
    steps,
    exits,
    spinnerStarts,
    spinnerStops,
    fixedItems,
    overrides: {
      runDiagnostics: async () => report,
      applyFixes: async (items: DiagnosticItem[]): Promise<FixResult[]> => {
        fixedItems.push(items);
        return items.map((item) => ({
          id: item.id,
          success: true,
          message: `Fixed ${item.id}`,
        }));
      },
      intro: (message: string) => intros.push(message),
      note: (body: string, title: string) => notes.push({ body, title }),
      spinner: () => ({
        start: (message: string) => spinnerStarts.push(message),
        stop: (message: string) => spinnerStops.push(message),
      }),
      log: {
        error: (message: string) => errors.push(message),
        warn: (message: string) => warnings.push(message),
        success: (message: string) => successes.push(message),
        info: (message: string) => infos.push(message),
        step: (message: string) => steps.push(message),
      },
      exit: (code: number) => {
        exits.push(code);
      },
    },
  };
}

describe("doctor command", () => {
  test("exits with code 1 when diagnostics contain errors", async () => {
    const report = createReport([
      {
        id: "config-missing",
        category: "config",
        title: "Configuration file",
        severity: "error",
        summary: "Configuration file was not found.",
        remediation: ["Run rr init before running rr run."],
      },
    ]);
    const runtime = createRuntime(report);

    await runDoctor([], runtime.overrides);

    expect(runtime.intros).toEqual(["Ralph Review Doctor"]);
    expect(runtime.spinnerStarts).toEqual(["Running diagnostics..."]);
    expect(runtime.spinnerStops).toEqual(["Diagnostics complete."]);
    expect(runtime.errors).toEqual(["Doctor found blocking issues."]);
    expect(runtime.exits).toEqual([1]);
  });

  test("logs warning and does not exit when diagnostics contain warnings only", async () => {
    const report = createReport([
      {
        id: "agent-opencode-probe",
        category: "agents",
        title: "opencode capability probe",
        severity: "warning",
        summary: "Model discovery probe returned warnings.",
        remediation: [],
      },
    ]);
    const runtime = createRuntime(report);

    await runDoctor([], runtime.overrides);

    expect(runtime.errors).toEqual([]);
    expect(runtime.exits).toEqual([]);
    expect(runtime.warnings).toEqual(["Doctor completed with warnings."]);
  });

  test("logs success when no errors or warnings exist", async () => {
    const report = createReport([
      {
        id: "config-valid",
        category: "config",
        title: "Configuration file",
        severity: "ok",
        summary: "Configuration loaded successfully.",
        remediation: [],
      },
    ]);
    const runtime = createRuntime(report);

    await runDoctor([], runtime.overrides);

    expect(runtime.errors).toEqual([]);
    expect(runtime.warnings).toEqual([]);
    expect(runtime.exits).toEqual([]);
    expect(runtime.successes).toEqual(["Doctor completed. Environment is ready."]);
  });

  test("uses structured context metadata to render agent installation status", async () => {
    const report = createReport([
      {
        id: "agent-codex-binary",
        category: "agents",
        title: "codex binary",
        severity: "ok",
        summary: "Command 'codex' is not installed (optional unless configured).",
        remediation: [],
        context: {
          agent: "codex",
          installed: true,
        },
      },
      {
        id: "agent-claude-binary",
        category: "agents",
        title: "claude binary",
        severity: "ok",
        summary: "Command 'claude' is installed.",
        remediation: [],
        context: {
          agent: "claude",
          installed: false,
        },
      },
      {
        id: "agents-installed-count",
        category: "agents",
        title: "Installed coding agents",
        severity: "ok",
        summary: "Detected 1 installed coding agent.",
        remediation: [],
      },
    ]);
    const runtime = createRuntime(report);

    await runDoctor([], runtime.overrides);

    const agentsNote = runtime.notes.find((entry) => entry.title === "🤖 Agents");
    expect(agentsNote?.body).toContain("✅ codex");
    expect(agentsNote?.body).toContain("🔳 claude");
  });

  test("stops spinner even when runDiagnostics throws", async () => {
    const report = createReport([]);
    const runtime = createRuntime(report);
    runtime.overrides.runDiagnostics = async () => {
      throw new Error("unexpected diagnostics failure");
    };

    await expect(runDoctor([], runtime.overrides)).rejects.toThrow(
      "unexpected diagnostics failure"
    );

    expect(runtime.spinnerStarts).toEqual(["Running diagnostics..."]);
    expect(runtime.spinnerStops).toEqual(["Diagnostics complete."]);
  });
});

describe("doctor --fix", () => {
  test("runs multi-pass remediation until diagnostics are clean", async () => {
    const passOneReport = createReport([
      {
        id: "tmux-installed",
        category: "tmux",
        title: "tmux availability",
        severity: "error",
        summary: "tmux is not installed.",
        remediation: ["Run: brew install tmux", "Then run: rr doctor --fix"],
      },
    ]);
    const passTwoReport = createReport([
      {
        id: "config-missing",
        category: "config",
        title: "Configuration file",
        severity: "error",
        summary: "Configuration file was not found.",
        remediation: ["Run: rr init", "Then run: rr doctor --fix"],
      },
    ]);
    const cleanReport = createReport([
      {
        id: "config-valid",
        category: "config",
        title: "Configuration file",
        severity: "ok",
        summary: "Configuration loaded successfully.",
        remediation: [],
      },
    ]);

    const runtime = createRuntime(passOneReport);
    let diagnosticsRunCount = 0;
    runtime.overrides.runDiagnostics = async () => {
      diagnosticsRunCount++;
      if (diagnosticsRunCount === 1) return passOneReport;
      if (diagnosticsRunCount === 2) return passTwoReport;
      return cleanReport;
    };

    let fixPass = 0;
    runtime.overrides.applyFixes = async (items: DiagnosticItem[]): Promise<FixResult[]> => {
      runtime.fixedItems.push(items);
      fixPass++;
      return items.map((item) => ({
        id: item.id,
        success: true,
        message: `Pass ${fixPass} fixed ${item.id}`,
      }));
    };

    await runDoctor(["--fix"], runtime.overrides);

    expect(diagnosticsRunCount).toBe(3);
    expect(runtime.steps).toContain("Remediation pass 1/3");
    expect(runtime.steps).toContain("Remediation pass 2/3");
    expect(runtime.successes).toContain("Doctor completed. Environment is ready.");
  });

  test("stops remediation when no progress is detected", async () => {
    const stuckReport = createReport([
      {
        id: "run-lockfile",
        category: "environment",
        title: "Review lock",
        severity: "error",
        summary: "A review is already running for this project.",
        remediation: ["Run: rr status", "Run: rr stop", "Then run: rr run"],
      },
    ]);

    const runtime = createRuntime(stuckReport);
    let diagnosticsRunCount = 0;
    runtime.overrides.runDiagnostics = async () => {
      diagnosticsRunCount++;
      return stuckReport;
    };
    runtime.overrides.applyFixes = async () => [
      {
        id: "run-lockfile",
        success: false,
        message: "Lockfile is not stale.",
        nextActions: ["Run: rr status", "Run: rr stop", "Then run: rr run"],
      },
    ];

    await runDoctor(["--fix"], runtime.overrides);

    expect(diagnosticsRunCount).toBe(2);
    expect(runtime.infos.some((line) => line.includes("No remediation progress detected"))).toBe(
      true
    );
    expect(runtime.notes.some((n) => n.title === "🧭 Next actions")).toBe(true);
    expect(runtime.exits).toEqual([1]);
  });

  test("stops remediation when unresolved IDs do not change, even after a reported success", async () => {
    const persistentReport = createReport([
      {
        id: "config-reviewer-model-unverified",
        category: "config",
        title: "Reviewer model verification",
        severity: "error",
        summary: "Configured model could not be verified because live model discovery failed.",
        remediation: ["Run: rr init", "Then run: rr doctor --fix"],
      },
    ]);

    const runtime = createRuntime(persistentReport);
    let diagnosticsRunCount = 0;
    runtime.overrides.runDiagnostics = async () => {
      diagnosticsRunCount++;
      return persistentReport;
    };
    runtime.overrides.applyFixes = async () => [
      {
        id: "config-reviewer-model-unverified",
        success: true,
        message: "Configuration updated via rr init.",
      },
    ];

    await runDoctor(["--fix"], runtime.overrides);

    expect(diagnosticsRunCount).toBe(2);
    expect(runtime.steps).toEqual(["Remediation pass 1/3"]);
    expect(runtime.infos.some((line) => line.includes("No remediation progress detected"))).toBe(
      true
    );
    expect(runtime.exits).toEqual([1]);
  });

  test("stops after reaching the remediation pass limit", async () => {
    const firstReport = createReport([
      {
        id: "tmux-installed",
        category: "tmux",
        title: "tmux availability",
        severity: "error",
        summary: "tmux is not installed.",
        remediation: ["Run: brew install tmux", "Then run: rr doctor --fix"],
      },
    ]);
    const secondReport = createReport([
      {
        id: "config-missing",
        category: "config",
        title: "Configuration file",
        severity: "error",
        summary: "Configuration file was not found.",
        remediation: ["Run: rr init", "Then run: rr doctor --fix"],
      },
    ]);

    const runtime = createRuntime(firstReport);
    let diagnosticsRunCount = 0;
    runtime.overrides.runDiagnostics = async () => {
      diagnosticsRunCount++;
      return diagnosticsRunCount % 2 === 1 ? firstReport : secondReport;
    };
    runtime.overrides.applyFixes = async (items: DiagnosticItem[]) => {
      runtime.fixedItems.push(items);
      return items.map((item) => ({
        id: item.id,
        success: true,
        message: `Fixed ${item.id}`,
      }));
    };

    await runDoctor(["--fix"], runtime.overrides);

    expect(diagnosticsRunCount).toBe(4);
    expect(runtime.steps).toEqual([
      "Remediation pass 1/3",
      "Remediation pass 2/3",
      "Remediation pass 3/3",
    ]);
    expect(runtime.infos).toContain("Reached remediation pass limit.");
    expect(runtime.exits).toEqual([1]);
  });

  test("logs info when no fixable issues exist", async () => {
    const report = createReport([
      {
        id: "git-repo",
        category: "git",
        title: "Git repository",
        severity: "error",
        summary: "Current directory is not a git repository.",
        remediation: ["Run rr from inside a git repository."],
      },
    ]);
    const runtime = createRuntime(report);

    await runDoctor(["--fix"], runtime.overrides);

    expect(runtime.infos).toEqual(["No auto-fixable issues found."]);
    expect(runtime.fixedItems).toEqual([]);
    // Still exits with error since git-repo is unfixable
    expect(runtime.exits).toEqual([1]);
  });

  test("does not apply fixes when --fix is not passed", async () => {
    const report = createReport([
      {
        id: "tmux-installed",
        category: "tmux",
        title: "tmux availability",
        severity: "error",
        summary: "tmux is not installed.",
        remediation: ["Run: brew install tmux", "Then run: rr doctor --fix"],
        fixable: true,
      },
    ]);
    const runtime = createRuntime(report);

    await runDoctor([], runtime.overrides);

    expect(runtime.fixedItems).toEqual([]);
    expect(runtime.infos).toEqual([]);
    expect(runtime.exits).toEqual([1]);
  });

  test("shows wrench icon for known fixable IDs even when item.fixable is false", async () => {
    const report = createReport([
      {
        id: "config-missing",
        category: "config",
        title: "Configuration file",
        severity: "error",
        summary: "Configuration file was not found.",
        remediation: ["Run rr init before running rr run."],
        fixable: false,
      },
    ]);
    const runtime = createRuntime(report);

    await runDoctor([], runtime.overrides);

    const configNote = runtime.notes.find((n) => n.title === "⚙️ Config");
    expect(configNote?.body).toContain("🔧");
  });
});
