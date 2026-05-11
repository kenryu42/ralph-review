import { describe, expect, test } from "bun:test";
import type { RemediationDependencies } from "@/lib/diagnostics/remediation";
import { applyFix, applyFixes, isFixable } from "@/lib/diagnostics/remediation";
import type { DiagnosticItem } from "@/lib/diagnostics/types";

function makeItem(
  id: string,
  severity: "ok" | "warning" | "error" = "error",
  context?: Record<string, string | boolean>
): DiagnosticItem {
  return {
    id,
    category: "config",
    title: id,
    severity,
    summary: `Issue: ${id}`,
    remediation: [],
    ...(context ? { context } : {}),
  };
}

function mockDeps(overrides: Partial<RemediationDependencies> = {}): RemediationDependencies {
  return {
    spawn: (() => ({ exited: Promise.resolve(0) })) as unknown as typeof Bun.spawn,
    execPath: "/usr/bin/bun",
    cliPath: "/path/to/cli.ts",
    projectPath: "/project",
    which: () => null,
    platform: "darwin",
    ...overrides,
  };
}

function brewDeps(overrides: Partial<RemediationDependencies> = {}) {
  return mockDeps({
    platform: "darwin",
    which: (command: string) => (command === "brew" ? "/opt/homebrew/bin/brew" : null),
    ...overrides,
  });
}

function createSpawnRecorder(
  exitCode = 0,
  onSpawn?: (args: string[], options?: { stdin?: string | null }) => void
) {
  const calls: Array<{ args: string[]; stdin?: string | null }> = [];
  const spawn = ((args: string[], options?: { stdin?: string | null }) => {
    calls.push({ args, stdin: options?.stdin });
    onSpawn?.(args, options);
    return { exited: Promise.resolve(exitCode) };
  }) as unknown as typeof Bun.spawn;

  return { calls, spawn };
}

async function applyFixWithRecordedSpawn(
  item: DiagnosticItem,
  deps: Partial<RemediationDependencies> = {}
) {
  const recorder = createSpawnRecorder();
  const result = await applyFix(item, mockDeps({ spawn: recorder.spawn, ...deps }));

  return { calls: recorder.calls, result };
}

describe("isFixable", () => {
  test("returns true for fixable IDs", () => {
    expect(isFixable("tmux-installed")).toBe(true);
    expect(isFixable("config-missing")).toBe(true);
    expect(isFixable("config-invalid")).toBe(true);
    expect(isFixable("config-reviewer-agent-invalid")).toBe(true);
    expect(isFixable("config-fixer-agent-missing")).toBe(true);
    expect(isFixable("config-fixer-pi-invalid")).toBe(true);
    expect(isFixable("config-reviewer-model-missing")).toBe(true);
    expect(isFixable("config-fixer-model-unverified")).toBe(true);
  });

  test("returns false for non-fixable IDs", () => {
    expect(isFixable("git-repo")).toBe(false);
    expect(isFixable("agent-codex-binary")).toBe(false);
    expect(isFixable("config-reviewer-model-found")).toBe(false);
    expect(isFixable("unknown-id")).toBe(false);
  });
});

describe("applyFix", () => {
  test("uses brew on darwin when available", async () => {
    const { calls, result } = await applyFixWithRecordedSpawn(makeItem("tmux-installed"), {
      platform: "darwin",
      which: (command: string) => (command === "brew" ? "/opt/homebrew/bin/brew" : null),
    });

    expect(result.success).toBe(true);
    expect(result.id).toBe("tmux-installed");
    expect(calls[0]?.args).toEqual(["brew", "install", "tmux"]);
  });

  test("uses apt-get with sudo on linux when both are available", async () => {
    const { calls, result } = await applyFixWithRecordedSpawn(makeItem("tmux-installed"), {
      platform: "linux",
      which: (command: string) => {
        if (command === "apt-get") return "/usr/bin/apt-get";
        if (command === "sudo") return "/usr/bin/sudo";
        return null;
      },
    });

    expect(result.success).toBe(true);
    expect(calls[0]?.args).toEqual(["sudo", "apt-get", "install", "-y", "tmux"]);
    expect(calls[0]?.stdin).toBe("inherit");
  });

  test("uses apt-get without sudo on linux when sudo is unavailable", async () => {
    const { calls, result } = await applyFixWithRecordedSpawn(makeItem("tmux-installed"), {
      platform: "linux",
      which: (command: string) => (command === "apt-get" ? "/usr/bin/apt-get" : null),
    });

    expect(result.success).toBe(true);
    expect(calls[0]?.args).toEqual(["apt-get", "install", "-y", "tmux"]);
  });

  test("falls back to choco on windows when winget is unavailable", async () => {
    const { calls, result } = await applyFixWithRecordedSpawn(makeItem("tmux-installed"), {
      platform: "win32",
      which: (command: string) => (command === "choco" ? "C:\\choco\\bin\\choco" : null),
    });

    expect(result.success).toBe(true);
    expect(calls[0]?.args).toEqual(["choco", "install", "tmux", "-y"]);
  });

  test("returns manual guidance when no supported package manager is found", async () => {
    const deps = mockDeps({
      platform: "linux",
      which: () => null,
    });

    const result = await applyFix(makeItem("tmux-installed"), deps);

    expect(result.success).toBe(false);
    expect(result.nextActions?.length).toBeGreaterThan(0);
    expect(result.category).toBe("manual-needed");
  });

  test("reports failure when install command exits non-zero", async () => {
    const deps = brewDeps({
      spawn: (() => ({ exited: Promise.resolve(1) })) as unknown as typeof Bun.spawn,
    });

    const result = await applyFix(makeItem("tmux-installed"), deps);

    expect(result.success).toBe(false);
    expect(result.message).toContain("exited with code 1");
    expect(result.nextActions).toContain("Run: brew install tmux");
  });

  test("reports failure when tmux install command throws", async () => {
    const deps = brewDeps({
      spawn: (() => {
        throw new Error("spawn failed");
      }) as unknown as typeof Bun.spawn,
    });

    const result = await applyFix(makeItem("tmux-installed"), deps);

    expect(result.success).toBe(false);
    expect(result.category).toBe("manual-needed");
    expect(result.message).toContain("Failed to install tmux");
    expect(result.attemptedCommand).toBe("brew install tmux");
    expect(result.nextActions).toContain("Run: brew install tmux");
  });

  test("fixes config-missing by spawning rr init", async () => {
    const { calls, result } = await applyFixWithRecordedSpawn(makeItem("config-missing"));

    expect(result.success).toBe(true);
    expect(result.id).toBe("config-missing");
    expect(calls[0]?.args).toEqual(["/usr/bin/bun", "/path/to/cli.ts", "init"]);
  });

  test("fixes config-invalid by spawning rr init", async () => {
    const deps = mockDeps();
    const result = await applyFix(makeItem("config-invalid"), deps);

    expect(result.success).toBe(true);
    expect(result.id).toBe("config-invalid");
  });

  test("uses rr init for repo-local config issues", async () => {
    const { calls, result } = await applyFixWithRecordedSpawn(
      makeItem("config-invalid", "error", { configScope: "local" })
    );

    expect(result.success).toBe(true);
    expect(calls[0]?.args).toEqual(["/usr/bin/bun", "/path/to/cli.ts", "init", "--local"]);
  });

  test("uses rr init --global for global config issues", async () => {
    const { calls, result } = await applyFixWithRecordedSpawn(
      makeItem("config-invalid", "error", { configScope: "global" })
    );

    expect(result.success).toBe(true);
    expect(calls[0]?.args).toEqual(["/usr/bin/bun", "/path/to/cli.ts", "init", "--global"]);
  });

  test("does not report mixed config repairs as auto-fixed", async () => {
    let spawnCalls = 0;
    const deps = mockDeps({
      spawn: ((_args: string[]) => {
        spawnCalls++;
        return { exited: Promise.resolve(0) };
      }) as unknown as typeof Bun.spawn,
    });

    const result = await applyFix(
      makeItem("config-invalid", "error", { configScope: "mixed" }),
      deps
    );

    expect(result.success).toBe(false);
    expect(result.category).toBe("manual-needed");
    expect(result.message).toContain("both the global and repo-local config");
    expect(result.nextActions).toEqual([
      "Run: rr init --global",
      "Run: rr init --local",
      "Then run: rr doctor --fix",
    ]);
    expect(spawnCalls).toBe(0);
  });

  test("reports failure when rr init exits non-zero", async () => {
    const deps = mockDeps({
      spawn: (() => ({ exited: Promise.resolve(2) })) as unknown as typeof Bun.spawn,
    });

    const result = await applyFix(makeItem("config-missing"), deps);

    expect(result.success).toBe(false);
    expect(result.category).toBe("manual-needed");
    expect(result.message).toContain("rr init exited with code 2");
    expect(result.attemptedCommand).toBe("rr init");
    expect(result.nextActions).toContain("Run: rr init");
  });

  test("reports failure when rr init throws", async () => {
    const deps = mockDeps({
      spawn: (() => {
        throw new Error("init crash");
      }) as unknown as typeof Bun.spawn,
    });

    const result = await applyFix(makeItem("config-invalid"), deps);

    expect(result.success).toBe(false);
    expect(result.category).toBe("manual-needed");
    expect(result.message).toContain("Failed to run rr init");
    expect(result.attemptedCommand).toBe("rr init");
    expect(result.nextActions).toContain("Then run: rr doctor --fix");
  });

  test("routes config pattern IDs to rr init remediation", async () => {
    const { calls, result } = await applyFixWithRecordedSpawn(
      makeItem("config-reviewer-model-missing")
    );

    expect(result.success).toBe(true);
    expect(result.id).toBe("config-reviewer-model-missing");
    expect(calls[0]?.args).toEqual(["/usr/bin/bun", "/path/to/cli.ts", "init"]);
  });

  test("returns failure for unknown fix ID", async () => {
    const deps = mockDeps();
    const result = await applyFix(makeItem("git-repo"), deps);

    expect(result.success).toBe(false);
    expect(result.message).toContain("No fix available");
  });
});

describe("applyFixes", () => {
  test("skips items with ok severity", async () => {
    const items = [makeItem("tmux-installed", "ok"), makeItem("config-missing", "ok")];

    const results = await applyFixes(items, mockDeps());

    expect(results).toEqual([]);
  });

  test("skips non-fixable items", async () => {
    const items = [makeItem("git-repo", "error"), makeItem("agent-codex-binary", "error")];

    const results = await applyFixes(items, mockDeps());

    expect(results).toEqual([]);
  });

  test("applies fixes to fixable error items", async () => {
    const items = [makeItem("tmux-installed", "error"), makeItem("config-missing", "error")];
    const deps = brewDeps();

    const results = await applyFixes(items, deps);

    expect(results).toHaveLength(2);
    expect(results).toMatchObject([
      { id: "tmux-installed", success: true },
      { id: "config-missing", success: true },
    ]);
  });

  test("coalesces config remediations to a single rr init per pass", async () => {
    const items = [
      makeItem("config-reviewer-model-missing", "error"),
      makeItem("config-fixer-agent-missing", "error"),
    ];
    let spawnCalls = 0;
    const deps = mockDeps({
      spawn: ((args: string[]) => {
        if (args[2] === "init") {
          spawnCalls++;
        }
        return { exited: Promise.resolve(0) };
      }) as unknown as typeof Bun.spawn,
    });

    const results = await applyFixes(items, deps);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: "config-reviewer-model-missing", success: true });
    expect(spawnCalls).toBe(1);
  });

  test("applies fixes to fixable warning items", async () => {
    const items = [makeItem("tmux-installed", "warning")];
    const deps = brewDeps();
    const results = await applyFixes(items, deps);

    expect(results).toHaveLength(1);
    expect(results).toMatchObject([{ success: true }]);
  });
});
