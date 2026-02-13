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
  test("applies fixes and re-runs diagnostics when fixable errors exist", async () => {
    const initialReport = createReport([
      {
        id: "tmux-installed",
        category: "tmux",
        title: "tmux availability",
        severity: "error",
        summary: "tmux is not installed.",
        remediation: ["Install tmux with: brew install tmux"],
        fixable: true,
      },
    ]);

    let diagnosticsRunCount = 0;
    const fixedReport = createReport([
      {
        id: "tmux-installed",
        category: "tmux",
        title: "tmux availability",
        severity: "ok",
        summary: "tmux is installed.",
        remediation: [],
      },
    ]);

    const runtime = createRuntime(initialReport);
    runtime.overrides.runDiagnostics = async () => {
      diagnosticsRunCount++;
      return diagnosticsRunCount === 1 ? initialReport : fixedReport;
    };

    await runDoctor(["--fix"], runtime.overrides);

    expect(diagnosticsRunCount).toBe(2);
    expect(runtime.infos[0]).toContain("1 fixable issue");
    expect(runtime.successes).toContain("Fixed: Fixed tmux-installed");
    // Post-fix should show the re-diagnosis note
    expect(runtime.notes.some((n) => n.title === "🔧 Re-diagnosis")).toBe(true);
    // Final report is clean, so should succeed
    expect(runtime.successes).toContain("Doctor completed. Environment is ready.");
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
        remediation: ["Install tmux with: brew install tmux"],
        fixable: true,
      },
    ]);
    const runtime = createRuntime(report);

    await runDoctor([], runtime.overrides);

    expect(runtime.fixedItems).toEqual([]);
    expect(runtime.infos).toEqual([]);
    expect(runtime.exits).toEqual([1]);
  });

  test("does not re-diagnose when all fixes fail", async () => {
    const report = createReport([
      {
        id: "run-lockfile",
        category: "environment",
        title: "Review lock",
        severity: "error",
        summary: "A review is already running for this project.",
        remediation: ["Use rr stop to terminate the running session."],
        fixable: true,
      },
    ]);

    let diagnosticsRunCount = 0;
    const runtime = createRuntime(report);
    runtime.overrides.runDiagnostics = async () => {
      diagnosticsRunCount++;
      return report;
    };
    runtime.overrides.applyFixes = async () => [
      { id: "run-lockfile", success: false, message: "Lockfile is not stale." },
    ];

    await runDoctor(["--fix"], runtime.overrides);

    // Should only run diagnostics once (no re-run since fix failed)
    expect(diagnosticsRunCount).toBe(1);
    expect(runtime.warnings).toContain("Could not fix: Lockfile is not stale.");
  });

  test("shows wrench icon for fixable items in report", async () => {
    const report = createReport([
      {
        id: "config-missing",
        category: "config",
        title: "Configuration file",
        severity: "error",
        summary: "Configuration file was not found.",
        remediation: ["Run rr init before running rr run."],
        fixable: true,
      },
    ]);
    const runtime = createRuntime(report);

    await runDoctor([], runtime.overrides);

    const configNote = runtime.notes.find((n) => n.title === "⚙️ Config");
    expect(configNote?.body).toContain("🔧");
  });
});
