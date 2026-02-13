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
    ...overrides,
  };
}

describe("isFixable", () => {
  test("returns true for fixable IDs", () => {
    expect(isFixable("tmux-installed")).toBe(true);
    expect(isFixable("config-missing")).toBe(true);
    expect(isFixable("config-invalid")).toBe(true);
    expect(isFixable("run-lockfile")).toBe(true);
  });

  test("returns false for non-fixable IDs", () => {
    expect(isFixable("git-repo")).toBe(false);
    expect(isFixable("agent-codex-binary")).toBe(false);
    expect(isFixable("config-reviewer-agent-missing")).toBe(false);
    expect(isFixable("unknown-id")).toBe(false);
  });
});

describe("applyFix", () => {
  test("fixes tmux-installed by spawning brew install", async () => {
    let spawnedArgs: string[] = [];
    const deps = mockDeps({
      spawn: ((args: string[]) => {
        spawnedArgs = args;
        return { exited: Promise.resolve(0) };
      }) as unknown as typeof Bun.spawn,
    });

    const result = await applyFix(makeItem("tmux-installed"), deps);

    expect(result.success).toBe(true);
    expect(result.id).toBe("tmux-installed");
    expect(spawnedArgs).toEqual(["brew", "install", "tmux"]);
  });

  test("reports failure when brew exits non-zero", async () => {
    const deps = mockDeps({
      spawn: (() => ({
        exited: Promise.resolve(1),
      })) as unknown as typeof Bun.spawn,
    });

    const result = await applyFix(makeItem("tmux-installed"), deps);

    expect(result.success).toBe(false);
    expect(result.message).toContain("exited with code 1");
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

    const results = await applyFixes(items, mockDeps());

    expect(results).toHaveLength(2);
    expect(results).toMatchObject([
      { id: "tmux-installed", success: true },
      { id: "config-missing", success: true },
    ]);
  });

  test("applies fixes to fixable warning items", async () => {
    const items = [makeItem("tmux-installed", "warning")];
    const results = await applyFixes(items, mockDeps());

    expect(results).toHaveLength(1);
    expect(results).toMatchObject([{ success: true }]);
  });
});
