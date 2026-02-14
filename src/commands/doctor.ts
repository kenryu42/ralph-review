import * as p from "@clack/prompts";
import { runDiagnostics } from "@/lib/diagnostics";
import type { FixResult, RemediationDependencies } from "@/lib/diagnostics/remediation";
import { applyFixes as defaultApplyFixes, isFixable } from "@/lib/diagnostics/remediation";
import type {
  DiagnosticCategory,
  DiagnosticItem,
  DiagnosticsReport,
} from "@/lib/diagnostics/types";

interface DoctorRuntime {
  runDiagnostics: () => Promise<DiagnosticsReport>;
  applyFixes: (
    items: DiagnosticItem[],
    deps?: Partial<RemediationDependencies>
  ) => Promise<FixResult[]>;
  intro: (message: string) => void;
  note: (message: string, title: string) => void;
  spinner: () => {
    start: (message: string) => void;
    stop: (message: string) => void;
  };
  log: {
    error: (message: string) => void;
    warn: (message: string) => void;
    success: (message: string) => void;
    info: (message: string) => void;
    step: (message: string) => void;
  };
  exit: (code: number) => void;
}

interface DoctorRuntimeOverrides extends Partial<Omit<DoctorRuntime, "log">> {
  log?: Partial<DoctorRuntime["log"]>;
}

const CATEGORY_ORDER: readonly DiagnosticCategory[] = [
  "environment",
  "agents",
  "config",
  "git",
  "tmux",
];

const CATEGORY_LABELS: Record<DiagnosticCategory, string> = {
  environment: "🌍 Environment",
  agents: "🤖 Agents",
  config: "⚙️ Config",
  git: "🌿 Git",
  tmux: "🧵 tmux",
};

// alphabetically ordered list of agents
const AGENT_ORDER = ["claude", "codex", "droid", "gemini", "opencode", "pi"] as const;
const MAX_FIX_PASSES = 3;

function getSeverityIcon(item: DiagnosticItem): string {
  switch (item.severity) {
    case "ok":
      return "✅";
    case "warning":
      return "⚠️";
    case "error":
      return "❌";
  }
}

function formatDoctorItem(item: DiagnosticItem): string {
  const fixTag = item.severity !== "ok" && isFixable(item.id) ? " 🔧" : "";
  const lines = [`${getSeverityIcon(item)} ${item.summary}${fixTag}`];

  if (item.details) {
    lines.push(`  ${item.details}`);
  }

  for (const step of item.remediation) {
    lines.push(`  → ${step}`);
  }

  return lines.join("\n");
}

function getFixableItems(report: DiagnosticsReport): DiagnosticItem[] {
  return report.items.filter((item) => item.severity !== "ok" && isFixable(item.id));
}

function toIdSet(items: DiagnosticItem[]): Set<string> {
  return new Set(items.map((item) => item.id));
}

function setEquals(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }

  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }

  return true;
}

function collectNextActions(report: DiagnosticsReport, results: FixResult[]): string[] {
  const actions: string[] = [];
  const seen = new Set<string>();

  function addUnique(steps: string[]): void {
    for (const step of steps) {
      if (!seen.has(step)) {
        seen.add(step);
        actions.push(step);
      }
    }
  }

  const unresolvedErrorIds = new Set(
    report.items.filter((item) => item.severity === "error").map((item) => item.id)
  );

  for (const item of report.items) {
    if (item.severity === "error") {
      addUnique(item.remediation);
    }
  }

  for (const result of results) {
    if (!result.success && result.nextActions && unresolvedErrorIds.has(result.id)) {
      addUnique(result.nextActions);
    }
  }

  return actions;
}

function parseAgentBinaryItem(item: DiagnosticItem): { agent: string; installed: boolean } | null {
  const contextAgent = item.context?.agent;
  const contextInstalled = item.context?.installed;
  if (typeof contextAgent !== "string" || typeof contextInstalled !== "boolean") {
    return null;
  }

  return {
    agent: contextAgent,
    installed: contextInstalled,
  };
}

function renderAgentsSection(items: DiagnosticItem[], note: DoctorRuntime["note"]): void {
  const lines: string[] = [];
  const binaryItems = new Map<string, { installed: boolean }>();

  for (const item of items) {
    const parsed = parseAgentBinaryItem(item);
    if (!parsed) {
      continue;
    }
    binaryItems.set(parsed.agent, { installed: parsed.installed });
  }

  for (const agent of AGENT_ORDER) {
    const entry = binaryItems.get(agent);
    if (!entry) {
      continue;
    }

    if (entry.installed) {
      lines.push(`✅ ${agent}`);
    } else {
      lines.push(`🔳 ${agent}`);
    }
  }

  const countItem = items.find((item) => item.id === "agents-installed-count");
  if (countItem) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push(countItem.summary);

    if (countItem.severity === "error") {
      for (const remediation of countItem.remediation) {
        lines.push(`→ ${remediation}`);
      }
    }
  }

  const supplementalItems = items.filter((item) => {
    if (item.id === "agents-installed-count") {
      return false;
    }
    return !item.id.match(/^agent-(.+)-binary$/);
  });
  if (supplementalItems.length > 0) {
    if (lines.length > 0) {
      lines.push("");
    }
    for (const item of supplementalItems) {
      lines.push(formatDoctorItem(item));
      lines.push("");
    }
    if (lines[lines.length - 1] === "") {
      lines.pop();
    }
  }

  note(lines.join("\n"), CATEGORY_LABELS.agents);
}

function renderDoctorReport(report: DiagnosticsReport, note: DoctorRuntime["note"]): void {
  for (const category of CATEGORY_ORDER) {
    const items = report.items.filter((item) => item.category === category);
    if (items.length === 0) {
      continue;
    }

    if (category === "agents") {
      renderAgentsSection(items, note);
      continue;
    }

    const sectionBody = items.map((item) => formatDoctorItem(item)).join("\n\n");
    note(sectionBody, CATEGORY_LABELS[category]);
  }

  const errors = report.items.filter((item) => item.severity === "error").length;
  const warnings = report.items.filter((item) => item.severity === "warning").length;
  if (errors > 0 || warnings > 0) {
    const summaryLines: string[] = [];
    if (errors > 0) {
      summaryLines.push(`❌ Errors: ${errors}`);
    }
    if (warnings > 0) {
      summaryLines.push(`⚠️ Warnings: ${warnings}`);
    }

    note(summaryLines.join("\n"), "📊 Summary");
  }
}

function createDoctorRuntime(overrides: DoctorRuntimeOverrides = {}): DoctorRuntime {
  return {
    runDiagnostics: overrides.runDiagnostics ?? (() => runDiagnostics("doctor")),
    applyFixes: overrides.applyFixes ?? defaultApplyFixes,
    intro: overrides.intro ?? p.intro,
    note: overrides.note ?? p.note,
    spinner: overrides.spinner ?? (() => p.spinner()),
    log: {
      error: overrides.log?.error ?? p.log.error,
      warn: overrides.log?.warn ?? p.log.warn,
      success: overrides.log?.success ?? p.log.success,
      info: overrides.log?.info ?? p.log.info,
      step: overrides.log?.step ?? p.log.step,
    },
    exit: overrides.exit ?? ((code: number) => process.exit(code)),
  };
}

export async function runDoctor(
  args: string[] = [],
  runtimeOverrides: DoctorRuntimeOverrides = {}
): Promise<void> {
  const runtime = createDoctorRuntime(runtimeOverrides);
  const fix = args.includes("--fix");
  runtime.intro("Ralph Review Doctor");

  const spinner = runtime.spinner();
  spinner.start("Running diagnostics...");
  let report: DiagnosticsReport;
  try {
    report = await runtime.runDiagnostics();
  } finally {
    spinner.stop("Diagnostics complete.");
  }

  renderDoctorReport(report, runtime.note);

  if (fix) {
    const initialFixableItems = getFixableItems(report);

    if (initialFixableItems.length > 0) {
      runtime.log.info(
        `Found ${initialFixableItems.length} fixable issue${initialFixableItems.length === 1 ? "" : "s"}. Attempting guided remediation...`
      );
      const allFixResults: FixResult[] = [];

      for (let pass = 1; pass <= MAX_FIX_PASSES; pass++) {
        const fixableItems = getFixableItems(report);
        if (fixableItems.length === 0) {
          break;
        }

        runtime.log.step(`Remediation pass ${pass}/${MAX_FIX_PASSES}`);
        const unresolvedBefore = toIdSet(fixableItems);
        const results = await runtime.applyFixes(fixableItems);
        allFixResults.push(...results);

        for (const result of results) {
          if (result.success) {
            runtime.log.success(`Fixed this pass: ${result.message}`);
          } else {
            runtime.log.warn(`Could not fix: ${result.message}`);
          }
        }

        const reSpinner = runtime.spinner();
        reSpinner.start("Re-running diagnostics...");
        try {
          report = await runtime.runDiagnostics();
        } finally {
          reSpinner.stop("Diagnostics complete.");
        }

        runtime.note(
          `Post-fix diagnostic results (pass ${pass}/${MAX_FIX_PASSES}):`,
          "🔧 Re-diagnosis"
        );
        renderDoctorReport(report, runtime.note);

        const unresolvedAfter = toIdSet(getFixableItems(report));

        if (unresolvedAfter.size === 0) {
          break;
        }

        if (pass === MAX_FIX_PASSES) {
          runtime.log.info("Reached remediation pass limit.");
          break;
        }

        if (setEquals(unresolvedBefore, unresolvedAfter)) {
          runtime.log.info(
            "No remediation progress detected for remaining fixable issues. Stopping auto-fix loop."
          );
          break;
        }
      }

      if (report.hasErrors) {
        const actions = collectNextActions(report, allFixResults);
        if (actions.length > 0) {
          const lines = actions.map((action, index) => `${index + 1}. ${action}`);
          runtime.note(lines.join("\n"), "🧭 Next actions");
        }
      }
    } else {
      runtime.log.info("No auto-fixable issues found.");
    }
  }

  if (report.hasErrors) {
    runtime.log.error("Doctor found blocking issues.");
    runtime.exit(1);
    return;
  }

  if (report.hasWarnings) {
    runtime.log.warn("Doctor completed with warnings.");
    return;
  }

  runtime.log.success("Doctor completed. Environment is ready.");
}
