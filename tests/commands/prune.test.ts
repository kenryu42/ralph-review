import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCommandDef } from "@/cli";
import { runPrune } from "@/commands/prune";
import { parseCommand } from "@/lib/cli-parser";
import { getProjectWorktreesDir } from "@/lib/logger";
import {
  getFindingsArtifactPath,
  saveFindingsArtifact,
} from "@/lib/review-workflow/findings/artifact";
import type { FindingsArtifact, StoredFinding } from "@/lib/review-workflow/findings/types";
import type { LogEntry, PendingHandoffArtifact } from "@/lib/types";

function runGitIn(repoPath: string, args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: repoPath,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  }
}

function gitExitCode(repoPath: string, args: string[]): number {
  return Bun.spawnSync(["git", ...args], {
    cwd: repoPath,
    stdout: "ignore",
    stderr: "ignore",
  }).exitCode;
}

function initTestRepo(repoPath: string): void {
  runGitIn(repoPath, ["init", "--initial-branch=main"]);
  runGitIn(repoPath, ["config", "core.autocrlf", "false"]);
  runGitIn(repoPath, ["config", "user.name", "Tester"]);
  runGitIn(repoPath, ["config", "user.email", "test@example.com"]);
  runGitIn(repoPath, ["config", "commit.gpgsign", "false"]);
}

function createFinding(id: StoredFinding["id"]): StoredFinding {
  return {
    id,
    fingerprint: `fp-${id}`,
    locationKey: `src/file-${id}.ts:1:1`,
    title: `Finding ${id}`,
    body: `Body for ${id}`,
    priority: "P1",
    confidenceScore: 0.5,
    filePath: `src/file-${id}.ts`,
    startLine: 1,
    endLine: 1,
  };
}

function createArtifact(repoPath: string, sessionId: string, updatedAt: string): FindingsArtifact {
  const normalizedSessionId = sessionId.replace(/[^a-zA-Z0-9_.-]/g, "-");

  return {
    artifactVersion: 1,
    sessionId,
    projectPath: repoPath,
    logPath: join(repoPath, ".ralph-review", "logs", `${sessionId}.jsonl`),
    baselineRef: `refs/ralph-review/sessions/${normalizedSessionId}/baseline`,
    baselineCommitSha: "baseline-sha-123",
    sourceBaselineRef: `refs/ralph-review/sessions/${normalizedSessionId}/source`,
    sourceBaselineCommitSha: "source-baseline-sha-123",
    sourceBaselineFingerprint: "tracked-fingerprint-1",
    findings: [createFinding("F001")],
    selectedFindingIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt,
  };
}

async function saveFindingsArtifactWithUpdatedAt(
  storageRoot: string,
  artifact: FindingsArtifact,
  updatedAt: number
): Promise<void> {
  const saved = await saveFindingsArtifact(storageRoot, artifact);
  await Bun.write(
    getFindingsArtifactPath(storageRoot, saved.projectPath, saved.sessionId),
    JSON.stringify({ ...saved, updatedAt: new Date(updatedAt).toISOString() }, null, 2)
  );
}

async function listPendingFromStorage(): Promise<[]> {
  return [];
}

function createPendingHandoff(
  repoPath: string,
  overrides: Partial<PendingHandoffArtifact> = {}
): PendingHandoffArtifact {
  return {
    handoffId: overrides.handoffId ?? overrides.sessionId ?? "session-id",
    sessionId: overrides.sessionId ?? "session-id",
    projectPath: repoPath,
    sourceRepoPath: repoPath,
    logPath: join(repoPath, ".ralph-review", "logs", "session.jsonl"),
    hiddenRef: "refs/ralph-review/sessions/session-id/final",
    patchPath: join(repoPath, ".ralph-review", "handoffs", "session-id.patch"),
    sourceBaselineFingerprint: "fingerprint-1",
    commitSha: "commit-sha-1",
    state: "pending-apply",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("prune command", () => {
  let storageRoot: string;
  let repoPath: string;

  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "ralph-prune-storage-"));
    repoPath = await mkdtemp(join(tmpdir(), "ralph-prune-repo-"));
    initTestRepo(repoPath);
    await Bun.write(join(repoPath, "app.txt"), "base\n");
    runGitIn(repoPath, ["add", "app.txt"]);
    runGitIn(repoPath, ["commit", "-m", "initial commit"]);
  });

  afterEach(async () => {
    await rm(storageRoot, { recursive: true, force: true });
    await rm(repoPath, { recursive: true, force: true });
  });

  test("dry-run lists prunable sessions without deleting files", async () => {
    const sessionId = "session-applied";
    const infos: string[] = [];
    const successes: string[] = [];
    const artifact = createArtifact(repoPath, sessionId, "2026-01-01T00:00:00.000Z");
    await saveFindingsArtifact(storageRoot, artifact);
    await Bun.write(artifact.logPath, "session log\n", { createPath: true });

    await runPrune(["--dry-run"], {
      getCommandDef,
      parseCommand,
      cwd: () => repoPath,
      storageRoot,
      listProjectPendingHandoffs: listPendingFromStorage,
      logInfo: (message) => infos.push(message),
      logSuccess: (message) => successes.push(message),
      logWarn: () => {},
      logError: () => {},
      exit: () => {},
      now: () => 1_800_000_000_000,
    });

    expect(infos).toContain("Found 1 prunable review session.");
    expect(infos.some((message) => message.includes(sessionId))).toBe(true);
    expect(infos.at(-1)).toBe("Run rr prune to delete these artifacts.");
    expect(await Bun.file(getFindingsArtifactPath(storageRoot, repoPath, sessionId)).exists()).toBe(
      true
    );
    expect(await Bun.file(artifact.logPath).exists()).toBe(true);
    expect(successes).toEqual([]);
  });

  test("bare prune removes prunable session files and refs after TTY confirmation", async () => {
    const sessionId = "session-applied";
    const confirms: string[] = [];
    const successes: string[] = [];
    const artifact = createArtifact(repoPath, sessionId, "2026-01-01T00:00:00.000Z");
    await saveFindingsArtifact(storageRoot, artifact);
    await Bun.write(artifact.logPath, "session log\n", { createPath: true });
    runGitIn(repoPath, ["update-ref", artifact.baselineRef, "HEAD"]);
    runGitIn(repoPath, ["update-ref", "refs/ralph-review/sessions/session-applied/final", "HEAD"]);

    await runPrune([], {
      getCommandDef,
      parseCommand,
      cwd: () => repoPath,
      storageRoot,
      listProjectPendingHandoffs: listPendingFromStorage,
      logInfo: () => {},
      logSuccess: (message) => successes.push(message),
      logWarn: () => {},
      logError: () => {},
      exit: () => {},
      isTTY: () => true,
      confirm: async (input) => {
        confirms.push(input.message);
        return true;
      },
      now: () => 1_800_000_000_000,
    });

    expect(await Bun.file(getFindingsArtifactPath(storageRoot, repoPath, sessionId)).exists()).toBe(
      false
    );
    expect(await Bun.file(artifact.logPath).exists()).toBe(false);
    expect(gitExitCode(repoPath, ["show-ref", "--verify", artifact.baselineRef])).not.toBe(0);
    expect(
      gitExitCode(repoPath, [
        "show-ref",
        "--verify",
        "refs/ralph-review/sessions/session-applied/final",
      ])
    ).not.toBe(0);
    expect(confirms).toEqual(["Delete 1 prunable review session artifact set?"]);
    expect(successes.at(-1)).toContain("Pruned 1 review session");
  });

  test("bare prune requires --yes or --dry-run in non-interactive terminals", async () => {
    const sessionId = "session-applied";
    const artifact = createArtifact(repoPath, sessionId, "2026-01-01T00:00:00.000Z");
    const errors: string[] = [];
    const exits: number[] = [];
    await saveFindingsArtifact(storageRoot, artifact);

    await runPrune([], {
      getCommandDef,
      parseCommand,
      cwd: () => repoPath,
      storageRoot,
      listProjectPendingHandoffs: listPendingFromStorage,
      logInfo: () => {},
      logSuccess: () => {},
      logWarn: () => {},
      logError: (message) => errors.push(message),
      exit: (code) => exits.push(code),
      isTTY: () => false,
      now: () => 1_800_000_000_000,
    });

    expect(await Bun.file(getFindingsArtifactPath(storageRoot, repoPath, sessionId)).exists()).toBe(
      true
    );
    expect(errors).toEqual([
      "Cannot prune without confirmation in a non-interactive terminal. Re-run with --yes to delete or --dry-run to preview.",
    ]);
    expect(exits).toEqual([1]);
  });

  test("yes removes prunable sessions without prompting", async () => {
    const sessionId = "session-applied";
    const artifact = createArtifact(repoPath, sessionId, "2026-01-01T00:00:00.000Z");
    const successes: string[] = [];
    const confirms: string[] = [];
    await saveFindingsArtifact(storageRoot, artifact);

    await runPrune(["--yes"], {
      getCommandDef,
      parseCommand,
      cwd: () => repoPath,
      storageRoot,
      listProjectPendingHandoffs: listPendingFromStorage,
      logInfo: () => {},
      logSuccess: (message) => successes.push(message),
      logWarn: () => {},
      logError: () => {},
      exit: () => {},
      isTTY: () => true,
      confirm: async (input) => {
        confirms.push(input.message);
        return true;
      },
      now: () => 1_800_000_000_000,
    });

    expect(await Bun.file(getFindingsArtifactPath(storageRoot, repoPath, sessionId)).exists()).toBe(
      false
    );
    expect(confirms).toEqual([]);
    expect(successes.at(-1)).toContain("Pruned 1 review session");
  });

  test("short yes alias removes prunable sessions without prompting", async () => {
    const sessionId = "session-applied";
    const artifact = createArtifact(repoPath, sessionId, "2026-01-01T00:00:00.000Z");
    const successes: string[] = [];
    const confirms: string[] = [];
    await saveFindingsArtifact(storageRoot, artifact);

    await runPrune(["-y"], {
      getCommandDef,
      parseCommand,
      cwd: () => repoPath,
      storageRoot,
      listProjectPendingHandoffs: listPendingFromStorage,
      logInfo: () => {},
      logSuccess: (message) => successes.push(message),
      logWarn: () => {},
      logError: () => {},
      exit: () => {},
      isTTY: () => true,
      confirm: async (input) => {
        confirms.push(input.message);
        return true;
      },
      now: () => 1_800_000_000_000,
    });

    expect(await Bun.file(getFindingsArtifactPath(storageRoot, repoPath, sessionId)).exists()).toBe(
      false
    );
    expect(confirms).toEqual([]);
    expect(successes.at(-1)).toContain("Pruned 1 review session");
  });

  test("declining confirmation cancels prune without deleting files", async () => {
    const sessionId = "session-applied";
    const artifact = createArtifact(repoPath, sessionId, "2026-01-01T00:00:00.000Z");
    const infos: string[] = [];
    await saveFindingsArtifact(storageRoot, artifact);

    await runPrune([], {
      getCommandDef,
      parseCommand,
      cwd: () => repoPath,
      storageRoot,
      listProjectPendingHandoffs: listPendingFromStorage,
      logInfo: (message) => infos.push(message),
      logSuccess: () => {},
      logWarn: () => {},
      logError: () => {},
      exit: () => {},
      isTTY: () => true,
      confirm: async () => false,
      now: () => 1_800_000_000_000,
    });

    expect(await Bun.file(getFindingsArtifactPath(storageRoot, repoPath, sessionId)).exists()).toBe(
      true
    );
    expect(infos.at(-1)).toBe("Prune cancelled. No artifacts were deleted.");
  });

  test("older-than filters the prunable set", async () => {
    const oldSessionId = "session-old";
    const newSessionId = "session-new";
    await saveFindingsArtifactWithUpdatedAt(
      storageRoot,
      createArtifact(repoPath, oldSessionId, "2026-01-01T00:00:00.000Z"),
      1_700_000_000_000
    );
    await saveFindingsArtifactWithUpdatedAt(
      storageRoot,
      createArtifact(repoPath, newSessionId, "2026-04-10T00:00:00.000Z"),
      1_799_000_000_000
    );

    const infos: string[] = [];
    await runPrune(["--older-than", "14d", "--dry-run"], {
      getCommandDef,
      parseCommand,
      cwd: () => repoPath,
      storageRoot,
      listProjectPendingHandoffs: listPendingFromStorage,
      logInfo: (message) => infos.push(message),
      logSuccess: () => {},
      logWarn: () => {},
      logError: () => {},
      exit: () => {},
      now: () => 1_800_000_000_000,
    });

    expect(infos.some((message) => message.includes(oldSessionId))).toBe(true);
    expect(infos.some((message) => message.includes(newSessionId))).toBe(false);
  });

  test("force session prune removes the targeted session", async () => {
    const sessionId = "session-force";
    const artifact = createArtifact(repoPath, sessionId, "2026-01-01T00:00:00.000Z");
    await saveFindingsArtifact(storageRoot, artifact);
    await Bun.write(artifact.logPath, "session log\n", { createPath: true });

    await runPrune(["--session", sessionId, "--force", "--yes"], {
      getCommandDef,
      parseCommand,
      cwd: () => repoPath,
      storageRoot,
      listProjectPendingHandoffs: listPendingFromStorage,
      logInfo: () => {},
      logSuccess: () => {},
      logWarn: () => {},
      logError: () => {},
      exit: () => {},
      now: () => 1_800_000_000_000,
    });

    expect(await Bun.file(getFindingsArtifactPath(storageRoot, repoPath, sessionId)).exists()).toBe(
      false
    );
    expect(await Bun.file(artifact.logPath).exists()).toBe(false);
  });

  test("force session prune removes orphaned worktree-only sessions", async () => {
    const sessionId = "session-orphan";
    const worktreesDir = getProjectWorktreesDir(storageRoot, repoPath);
    const worktreeEntry = `${sessionId}-1700000000000-deadbeef`;
    const orphanWorktreeDir = join(worktreesDir, worktreeEntry);
    await Bun.write(join(orphanWorktreeDir, ".keep"), "orphan\n", { createPath: true });

    const errors: string[] = [];
    const exits: number[] = [];
    const successes: string[] = [];

    await runPrune(["--session", sessionId, "--force", "--yes"], {
      getCommandDef,
      parseCommand,
      cwd: () => repoPath,
      storageRoot,
      listProjectPendingHandoffs: listPendingFromStorage,
      logInfo: () => {},
      logSuccess: (message) => successes.push(message),
      logWarn: () => {},
      logError: (message) => errors.push(message),
      exit: (code) => exits.push(code),
      now: () => 1_800_000_000_000,
    });

    const remainingEntries = await readdir(worktreesDir).catch(() => []);
    expect(remainingEntries.some((entry) => entry.startsWith(sessionId))).toBe(false);
    expect(errors).toEqual([]);
    expect(exits).toEqual([]);
    expect(successes.at(-1)).toContain("Pruned 1 review session");
  });

  test("all-projects skips missing project directories instead of aborting", async () => {
    const missingProjectPath = await mkdtemp(join(tmpdir(), "ralph-prune-missing-project-"));
    await rm(missingProjectPath, { recursive: true, force: true });

    const sessionId = "session-missing-project";
    await saveFindingsArtifact(
      storageRoot,
      createArtifact(missingProjectPath, sessionId, "2026-01-01T00:00:00.000Z")
    );

    const infos: string[] = [];
    const successes: string[] = [];
    await expect(
      runPrune(["--all-projects", "--dry-run"], {
        getCommandDef,
        parseCommand,
        cwd: () => repoPath,
        storageRoot,
        listProjectPendingHandoffs: listPendingFromStorage,
        logInfo: (message) => infos.push(message),
        logSuccess: (message) => successes.push(message),
        logWarn: () => {},
        logError: () => {},
        exit: () => {},
        now: () => 1_800_000_000_000,
      })
    ).resolves.toBeUndefined();

    expect(infos.some((message) => message.includes(sessionId))).toBe(true);
    expect(successes).toEqual([]);
  });

  test("prune continues cleanup when a recorded project path is no longer a git repository", async () => {
    const nonGitProjectPath = await mkdtemp(join(tmpdir(), "ralph-prune-nongit-project-"));
    const sessionId = "session-non-git";
    const artifact = createArtifact(nonGitProjectPath, sessionId, "2026-01-01T00:00:00.000Z");
    const artifactPath = getFindingsArtifactPath(storageRoot, nonGitProjectPath, sessionId);
    await saveFindingsArtifact(storageRoot, artifact);

    const successes: string[] = [];
    await expect(
      runPrune(["--all-projects", "--yes"], {
        getCommandDef,
        parseCommand,
        cwd: () => repoPath,
        storageRoot,
        listProjectPendingHandoffs: listPendingFromStorage,
        logInfo: () => {},
        logSuccess: (message) => successes.push(message),
        logWarn: () => {},
        logError: () => {},
        exit: () => {},
        now: () => 1_800_000_000_000,
      })
    ).resolves.toBeUndefined();

    expect(await Bun.file(artifactPath).exists()).toBe(false);
    expect(successes.at(-1)).toContain("Pruned 1 review session");
    await rm(nonGitProjectPath, { recursive: true, force: true });
  });

  describe("discard mode", () => {
    test("rejects conflicting dry-run and yes options", async () => {
      const errors: string[] = [];
      const exits: number[] = [];

      await runPrune(["--dry-run", "--yes"], {
        getCommandDef,
        parseCommand,
        cwd: () => repoPath,
        storageRoot,
        listProjectPendingHandoffs: listPendingFromStorage,
        logInfo: () => {},
        logSuccess: () => {},
        logWarn: () => {},
        logError: (message) => errors.push(message),
        logStep: () => {},
        exit: (code) => exits.push(code),
        isTTY: () => true,
        now: () => 1_800_000_000_000,
      });

      expect(errors).toEqual([
        "Cannot combine --dry-run and --yes. Choose one mode and try again.",
      ]);
      expect(exits).toEqual([1]);
    });

    test("prints info when there are no pending handoffs", async () => {
      const infos: string[] = [];
      const discardCalls: Array<{ projectPath: string; handoffId: string }> = [];

      await runPrune(["--discard"], {
        getCommandDef,
        parseCommand,
        cwd: () => repoPath,
        storageRoot,
        listProjectPendingHandoffs: listPendingFromStorage,
        discardPendingHandoff: async (_storageRoot, projectPath, handoffId) => {
          discardCalls.push({ projectPath, handoffId });
          throw new Error("discardPendingHandoff should not be called");
        },
        appendLog: async () => {},
        logInfo: (message) => infos.push(message),
        logSuccess: () => {},
        logWarn: () => {},
        logError: () => {},
        logStep: () => {},
        exit: () => {},
        isTTY: () => true,
        now: () => 1_800_000_000_000,
      });

      expect(infos).toEqual(["No pending review handoffs for current working directory."]);
      expect(discardCalls).toEqual([]);
    });

    test("discards the selected pending handoff", async () => {
      const handoff = createPendingHandoff(repoPath);
      const discardCalls: Array<{ projectPath: string; handoffId: string }> = [];
      const appendCalls: Array<{ logPath: string; entry: LogEntry }> = [];
      const steps: string[] = [];
      const successes: string[] = [];

      await runPrune(["--discard"], {
        getCommandDef,
        parseCommand,
        cwd: () => repoPath,
        storageRoot,
        listProjectPendingHandoffs: async () => [handoff],
        discardPendingHandoff: async (_storageRoot, projectPath, handoffId) => {
          discardCalls.push({ projectPath, handoffId });
          return handoff;
        },
        appendLog: async (logPath, entry) => {
          appendCalls.push({ logPath, entry });
        },
        logInfo: () => {},
        logSuccess: (message) => successes.push(message),
        logWarn: () => {},
        logError: () => {},
        logStep: (message) => steps.push(message),
        exit: () => {},
        isTTY: () => true,
        now: () => 1_800_000_000_000,
      });

      expect(discardCalls).toEqual([{ projectPath: repoPath, handoffId: "session-id" }]);
      expect(steps).toEqual(["Discarding handoff: session-id"]);
      expect(successes).toEqual(["Review handoff discarded."]);
      expect(appendCalls).toHaveLength(1);
      expect(appendCalls[0]?.logPath).toBe(handoff.logPath);
      expect(appendCalls[0]?.entry).toMatchObject({
        type: "handoff",
        timestamp: 1_800_000_000_000,
        handoffId: "session-id",
        handoffStatus: "discarded",
        commitSha: "commit-sha-1",
      });
    });

    test("accepts a unique session id prefix", async () => {
      const handoffs = [
        createPendingHandoff(repoPath, { handoffId: "handoff-a", sessionId: "session-alpha" }),
        createPendingHandoff(repoPath, { handoffId: "handoff-b", sessionId: "session-beta" }),
      ];
      const discardCalls: Array<{ projectPath: string; handoffId: string }> = [];

      await runPrune(["--discard", "--session", "session-a"], {
        getCommandDef,
        parseCommand,
        cwd: () => repoPath,
        storageRoot,
        listProjectPendingHandoffs: async () => handoffs,
        discardPendingHandoff: async (_storageRoot, projectPath, handoffId) => {
          discardCalls.push({ projectPath, handoffId });
          const matched = handoffs.find((handoff) => handoff.handoffId === handoffId);
          if (!matched) {
            throw new Error(`Unknown handoff ${handoffId}`);
          }
          return matched;
        },
        appendLog: async () => {},
        logInfo: () => {},
        logSuccess: () => {},
        logWarn: () => {},
        logError: () => {},
        logStep: () => {},
        exit: () => {},
        isTTY: () => false,
        now: () => 1_800_000_000_000,
      });

      expect(discardCalls).toEqual([{ projectPath: repoPath, handoffId: "handoff-a" }]);
    });

    test("errors when the session selector is blank", async () => {
      const errors: string[] = [];
      const exits: number[] = [];

      await runPrune(["--discard", "--session", "   "], {
        getCommandDef,
        parseCommand,
        cwd: () => repoPath,
        storageRoot,
        listProjectPendingHandoffs: async () => [createPendingHandoff(repoPath)],
        logInfo: () => {},
        logSuccess: () => {},
        logWarn: () => {},
        logError: (message) => errors.push(message),
        logStep: () => {},
        exit: (code) => exits.push(code),
        isTTY: () => true,
        now: () => 1_800_000_000_000,
      });

      expect(errors).toEqual(["Session selector cannot be empty."]);
      expect(exits).toEqual([1]);
    });

    test("errors when the session selector does not match any pending handoff", async () => {
      const errors: string[] = [];
      const exits: number[] = [];

      await runPrune(["--discard", "--session", "session-z"], {
        getCommandDef,
        parseCommand,
        cwd: () => repoPath,
        storageRoot,
        listProjectPendingHandoffs: async () => [
          createPendingHandoff(repoPath, { sessionId: "session-alpha" }),
        ],
        logInfo: () => {},
        logSuccess: () => {},
        logWarn: () => {},
        logError: (message) => errors.push(message),
        logStep: () => {},
        exit: (code) => exits.push(code),
        isTTY: () => true,
        now: () => 1_800_000_000_000,
      });

      expect(errors).toEqual([
        'No pending review handoff matches "session-z" in the current project.',
      ]);
      expect(exits).toEqual([1]);
    });

    test("errors when the session selector matches multiple prefixes", async () => {
      const errors: string[] = [];
      const exits: number[] = [];

      await runPrune(["--discard", "--session", "session-a"], {
        getCommandDef,
        parseCommand,
        cwd: () => repoPath,
        storageRoot,
        listProjectPendingHandoffs: async () => [
          createPendingHandoff(repoPath, { sessionId: "session-alpha" }),
          createPendingHandoff(repoPath, { sessionId: "session-atom" }),
        ],
        logInfo: () => {},
        logSuccess: () => {},
        logWarn: () => {},
        logError: (message) => errors.push(message),
        logStep: () => {},
        exit: (code) => exits.push(code),
        isTTY: () => true,
        now: () => 1_800_000_000_000,
      });

      expect(errors).toEqual([
        'Session selector "session-a" is ambiguous for the current project.',
      ]);
      expect(exits).toEqual([1]);
    });

    test("prompts when multiple pending handoffs exist in an interactive terminal", async () => {
      const handoffs = [
        createPendingHandoff(repoPath, { handoffId: "handoff-alpha", sessionId: "session-alpha" }),
        createPendingHandoff(repoPath, { handoffId: "handoff-beta", sessionId: "session-beta" }),
      ];
      const selectMessages: string[] = [];
      const discardCalls: Array<{ projectPath: string; handoffId: string }> = [];

      await runPrune(["--discard"], {
        getCommandDef,
        parseCommand,
        cwd: () => repoPath,
        storageRoot,
        listProjectPendingHandoffs: async () => handoffs,
        discardPendingHandoff: async (_storageRoot, projectPath, handoffId) => {
          discardCalls.push({ projectPath, handoffId });
          const matched = handoffs.find((handoff) => handoff.handoffId === handoffId);
          if (!matched) {
            throw new Error(`Unknown handoff ${handoffId}`);
          }
          return matched;
        },
        appendLog: async () => {},
        logInfo: () => {},
        logSuccess: () => {},
        logWarn: () => {},
        logError: () => {},
        logStep: () => {},
        exit: () => {},
        isTTY: () => true,
        select: async (input) => {
          selectMessages.push(input.message);
          return "handoff-beta";
        },
        isCancel: () => false,
        now: () => 1_800_000_000_000,
      });

      expect(selectMessages).toEqual(["Choose a review handoff to discard"]);
      expect(discardCalls).toEqual([{ projectPath: repoPath, handoffId: "handoff-beta" }]);
    });

    test("returns without discarding when interactive selection is cancelled", async () => {
      const discardCalls: Array<{ projectPath: string; handoffId: string }> = [];
      const successes: string[] = [];

      await runPrune(["--discard"], {
        getCommandDef,
        parseCommand,
        cwd: () => repoPath,
        storageRoot,
        listProjectPendingHandoffs: async () => [
          createPendingHandoff(repoPath, { handoffId: "handoff-alpha" }),
          createPendingHandoff(repoPath, { handoffId: "handoff-beta" }),
        ],
        discardPendingHandoff: async (_storageRoot, projectPath, handoffId) => {
          discardCalls.push({ projectPath, handoffId });
          return createPendingHandoff(repoPath);
        },
        appendLog: async () => {},
        logInfo: () => {},
        logSuccess: (message) => successes.push(message),
        logWarn: () => {},
        logError: () => {},
        logStep: () => {},
        exit: () => {},
        isTTY: () => true,
        select: async () => "__CANCEL__",
        isCancel: (value) => value === "__CANCEL__",
        now: () => 1_800_000_000_000,
      });

      expect(discardCalls).toEqual([]);
      expect(successes).toEqual([]);
    });

    test("errors when multiple pending handoffs exist in a non-interactive terminal", async () => {
      const errors: string[] = [];
      const exits: number[] = [];

      await runPrune(["--discard"], {
        getCommandDef,
        parseCommand,
        cwd: () => repoPath,
        storageRoot,
        listProjectPendingHandoffs: async () => [
          createPendingHandoff(repoPath, { handoffId: "handoff-alpha" }),
          createPendingHandoff(repoPath, { handoffId: "handoff-beta" }),
        ],
        logInfo: () => {},
        logSuccess: () => {},
        logWarn: () => {},
        logError: (message) => errors.push(message),
        logStep: () => {},
        exit: (code) => exits.push(code),
        isTTY: () => false,
        now: () => 1_800_000_000_000,
      });

      expect(errors).toEqual([
        "Multiple pending review handoffs exist for this project. Re-run with --session <id|name>.",
      ]);
      expect(exits).toEqual([1]);
    });

    test("rejects cleanup options in discard mode", async () => {
      const scenarios = [
        ["--discard", "--dry-run"],
        ["--discard", "--yes"],
        ["--discard", "--force"],
        ["--discard", "--older-than", "14d"],
        ["--discard", "--all-projects"],
      ];

      for (const args of scenarios) {
        const errors: string[] = [];
        const exits: number[] = [];

        await runPrune(args, {
          getCommandDef,
          parseCommand,
          cwd: () => repoPath,
          storageRoot,
          listProjectPendingHandoffs: listPendingFromStorage,
          logInfo: () => {},
          logSuccess: () => {},
          logWarn: () => {},
          logError: (message) => errors.push(message),
          logStep: () => {},
          exit: (code) => exits.push(code),
          isTTY: () => true,
          now: () => 1_800_000_000_000,
        });

        expect(errors).toEqual([
          "--discard can only be combined with --session. Remove cleanup options and try again.",
        ]);
        expect(exits).toEqual([1]);
      }
    });
  });
});
