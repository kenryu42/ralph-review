import { describe, expect, test } from "bun:test";
import type { RemediationDependencies } from "@/lib/diagnostics/remediation";
import { applyFix, applyFixes, isFixable } from "@/lib/diagnostics/remediation";
import type { DiagnosticItem } from "@/lib/diagnostics/types";

function makeItem(id: string, severity: "ok" | "warning" | "error" = "error"): DiagnosticItem {
  return {
    id,
    category: "config",
    title: id,
    severity,
    summary: `Issue: ${id}`,
    remediation: [],
  };
}

function mockDeps(overrides: Partial<RemediationDependencies> = {}): RemediationDependencies {
  return {
    spawn: (() => ({ exited: Promise.resolve(0) })) as unknown as typeof Bun.spawn,
    cleanupStaleLockfile: async () => true,
    execPath: "/usr/bin/bun",
    cliPath: "/path/to/cli.ts",
    projectPath: "/project",
    which: () => null,
    platform: "darwin",
    ...overrides,
  };
}

describe("isFixable", () => {
  test("returns true for fixable IDs", () => {
    expect(isFixable("tmux-installed")).toBe(true);
    expect(isFixable("config-missing")).toBe(true);
    expect(isFixable("config-invalid")).toBe(true);
    expect(isFixable("run-lockfile")).toBe(true);
    expect(isFixable("config-reviewer-agent-invalid")).toBe(true);
    expect(isFixable("config-fixer-agent-missing")).toBe(true);
    expect(isFixable("config-code-simplifier-pi-invalid")).toBe(true);
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
    let spawnedArgs: string[] = [];
    const deps = mockDeps({
      spawn: ((args: string[]) => {
        spawnedArgs = args;
        return { exited: Promise.resolve(0) };
      }) as unknown as typeof Bun.spawn,
      platform: "darwin",
      which: (command: string) => (command === "brew" ? "/opt/homebrew/bin/brew" : null),
    });

    const result = await applyFix(makeItem("tmux-installed"), deps);

    expect(result.success).toBe(true);
    expect(result.id).toBe("tmux-installed");
    expect(spawnedArgs).toEqual(["brew", "install", "tmux"]);
  });

  test("uses apt-get with sudo on linux when both are available", async () => {
    let spawnedArgs: string[] = [];
    let spawnedStdin: string | null | undefined;
    const deps = mockDeps({
      spawn: ((args: string[], options?: { stdin?: string | null }) => {
        spawnedArgs = args;
        spawnedStdin = options?.stdin;
        return { exited: Promise.resolve(0) };
      }) as unknown as typeof Bun.spawn,
      platform: "linux",
      which: (command: string) => {
        if (command === "apt-get") return "/usr/bin/apt-get";
        if (command === "sudo") return "/usr/bin/sudo";
        return null;
      },
    });

    const result = await applyFix(makeItem("tmux-installed"), deps);

    expect(result.success).toBe(true);
    expect(spawnedArgs).toEqual(["sudo", "apt-get", "install", "-y", "tmux"]);
    expect(spawnedStdin).toBe("inherit");
  });

  test("uses apt-get without sudo on linux when sudo is unavailable", async () => {
    let spawnedArgs: string[] = [];
    const deps = mockDeps({
      spawn: ((args: string[]) => {
        spawnedArgs = args;
        return { exited: Promise.resolve(0) };
      }) as unknown as typeof Bun.spawn,
      platform: "linux",
      which: (command: string) => (command === "apt-get" ? "/usr/bin/apt-get" : null),
    });

    const result = await applyFix(makeItem("tmux-installed"), deps);

    expect(result.success).toBe(true);
    expect(spawnedArgs).toEqual(["apt-get", "install", "-y", "tmux"]);
  });

  test("falls back to choco on windows when winget is unavailable", async () => {
    let spawnedArgs: string[] = [];
    const deps = mockDeps({
      spawn: ((args: string[]) => {
        spawnedArgs = args;
        return { exited: Promise.resolve(0) };
      }) as unknown as typeof Bun.spawn,
      platform: "win32",
      which: (command: string) => (command === "choco" ? "C:\\choco\\bin\\choco" : null),
    });

    const result = await applyFix(makeItem("tmux-installed"), deps);

    expect(result.success).toBe(true);
    expect(spawnedArgs).toEqual(["choco", "install", "tmux", "-y"]);
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
    const deps = mockDeps({
      spawn: (() => ({ exited: Promise.resolve(1) })) as unknown as typeof Bun.spawn,
      platform: "darwin",
      which: (command: string) => (command === "brew" ? "/opt/homebrew/bin/brew" : null),
    });

    const result = await applyFix(makeItem("tmux-installed"), deps);

    expect(result.success).toBe(false);
    expect(result.message).toContain("exited with code 1");
    expect(result.nextActions).toContain("Run: brew install tmux");
  });

  test("reports failure when tmux install command throws", async () => {
    const deps = mockDeps({
      spawn: (() => {
        throw new Error("spawn failed");
      }) as unknown as typeof Bun.spawn,
      platform: "darwin",
      which: (command: string) => (command === "brew" ? "/opt/homebrew/bin/brew" : null),
    });

    const result = await applyFix(makeItem("tmux-installed"), deps);

    expect(result.success).toBe(false);
    expect(result.category).toBe("manual-needed");
    expect(result.message).toContain("Failed to install tmux");
    expect(result.attemptedCommand).toBe("brew install tmux");
    expect(result.nextActions).toContain("Run: brew install tmux");
  });

  test("fixes config-missing by spawning rr init", async () => {
    let spawnedArgs: string[] = [];
    const deps = mockDeps({
      spawn: ((args: string[]) => {
        spawnedArgs = args;
        return { exited: Promise.resolve(0) };
      }) as unknown as typeof Bun.spawn,
    });

    const result = await applyFix(makeItem("config-missing"), deps);

    expect(result.success).toBe(true);
    expect(result.id).toBe("config-missing");
    expect(spawnedArgs).toEqual(["/usr/bin/bun", "/path/to/cli.ts", "init"]);
  });

  test("fixes config-invalid by spawning rr init", async () => {
    const deps = mockDeps();
    const result = await applyFix(makeItem("config-invalid"), deps);

    expect(result.success).toBe(true);
    expect(result.id).toBe("config-invalid");
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
    let spawnedArgs: string[] = [];
    const deps = mockDeps({
      spawn: ((args: string[]) => {
        spawnedArgs = args;
        return { exited: Promise.resolve(0) };
      }) as unknown as typeof Bun.spawn,
    });

    const result = await applyFix(makeItem("config-reviewer-model-missing"), deps);

    expect(result.success).toBe(true);
    expect(result.id).toBe("config-reviewer-model-missing");
    expect(spawnedArgs).toEqual(["/usr/bin/bun", "/path/to/cli.ts", "init"]);
  });

  test("fixes run-lockfile by cleaning up stale lockfile", async () => {
    let cleanupCalled = false;
    const deps = mockDeps({
      cleanupStaleLockfile: async () => {
        cleanupCalled = true;
        return true;
      },
    });

    const result = await applyFix(makeItem("run-lockfile"), deps);

    expect(result.success).toBe(true);
    expect(cleanupCalled).toBe(true);
  });

  test("reports failure when lockfile is not stale", async () => {
    const deps = mockDeps({
      cleanupStaleLockfile: async () => false,
    });

    const result = await applyFix(makeItem("run-lockfile"), deps);

    expect(result.success).toBe(false);
    expect(result.message).toContain("still active");
    expect(result.nextActions).toContain("Run: rr status");
    expect(result.nextActions).toContain("Then run: rr run");
  });

  test("reports failure when lockfile cleanup throws", async () => {
    const deps = mockDeps({
      cleanupStaleLockfile: async () => {
        throw new Error("cleanup failed");
      },
    });

    const result = await applyFix(makeItem("run-lockfile"), deps);

    expect(result.success).toBe(false);
    expect(result.category).toBe("manual-needed");
    expect(result.message).toContain("Failed to clean lockfile");
    expect(result.nextActions).toContain("Run: rr status");
    expect(result.nextActions).toContain("Then run: rr run");
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
    const deps = mockDeps({
      which: (command: string) => (command === "brew" ? "/opt/homebrew/bin/brew" : null),
      platform: "darwin",
    });

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
    const deps = mockDeps({
      which: (command: string) => (command === "brew" ? "/opt/homebrew/bin/brew" : null),
      platform: "darwin",
    });
    const results = await applyFixes(items, deps);

    expect(results).toHaveLength(1);
    expect(results).toMatchObject([{ success: true }]);
  });
});
